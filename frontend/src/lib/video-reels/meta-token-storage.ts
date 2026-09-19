import { cookies } from 'next/headers';
import { fetchWithTimeout } from './fetch-timeout';
import { shouldRefreshToken, computeExpiresAtSec, buildRefreshUrl } from './token-refresh';
import { upsertSharedIgAccount } from './meta-db';

// ===== New Multi-Account Types =====

export interface StoredAccount {
  userAccessToken: string;
  igUserId?: string;
  igUsername?: string;
  expiresAt: number;
}

export interface StoredTokenData {
  accounts: StoredAccount[];
  activeIndex: number;
}

// ===== Legacy Type (for migration) =====

interface LegacyStoredToken {
  userAccessToken: string;
  igUserId?: string;
  igUsername?: string;
  expiresAt?: number;
}

// ===== Internal helpers =====

const COOKIE_NAME = 'meta_token';
const MAX_AGE = 60 * 60 * 24 * 60; // 60 days in seconds

/**
 * Check if parsed data is in the old legacy format
 */
function isLegacyFormat(data: unknown): data is LegacyStoredToken {
  return !!data && typeof data === 'object' && 'userAccessToken' in data && !('accounts' in data);
}

/**
 * Encode data for storage in cookie (base64 encode)
 */
function encode(data: StoredTokenData): string {
  const json = JSON.stringify(data);
  return Buffer.from(json).toString('base64');
}

/**
 * Decode data from cookie
 */
function decode(encoded: string): StoredTokenData | LegacyStoredToken {
  try {
    const json = Buffer.from(encoded, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch (error) {
    console.error('[MetaTokenStorage] Failed to decode token:', error);
    throw new Error('Invalid token data');
  }
}

/**
 * Get raw token data from cookie (handles migration)
 */
async function getRawTokenData(): Promise<StoredTokenData | null> {
  try {
    const cookieStore = await cookies();
    const encoded = cookieStore.get(COOKIE_NAME)?.value;

    if (!encoded) {
      return null;
    }

    const parsed = decode(encoded);

    // Migration: Check if old format and migrate to new format
    if (isLegacyFormat(parsed)) {
      console.log('[MetaTokenStorage] Migrating from old token format to multi-account');
      const migrated: StoredTokenData = {
        accounts: [{
          userAccessToken: parsed.userAccessToken,
          igUserId: parsed.igUserId || '',
          igUsername: parsed.igUsername || '',
          expiresAt: parsed.expiresAt || 0,
        }],
        activeIndex: 0,
      };
      // Save migrated format back to cookie
      await setMetaTokenRaw(migrated);
      return migrated;
    }

    // Validate new format
    if (!parsed.accounts || !Array.isArray(parsed.accounts)) {
      console.error('[MetaTokenStorage] Invalid token format');
      await clearMetaToken();
      return null;
    }

    return parsed as StoredTokenData;
  } catch (error) {
    console.error('[MetaTokenStorage] Error getting token:', error);
    return null;
  }
}

/**
 * Set raw token data to cookie (internal use)
 */
async function setMetaTokenRaw(data: StoredTokenData): Promise<void> {
  const cookieStore = await cookies();

  const encoded = encode(data);

  // Find the latest expiration date among all accounts
  const latestExpiry = data.accounts.reduce((max, account) => {
    return account.expiresAt > max ? account.expiresAt : max;
  }, 0);

  const expiresAt = latestExpiry > 0
    ? new Date(latestExpiry * 1000)
    : new Date(Date.now() + MAX_AGE * 1000);

  cookieStore.set({
    name: COOKIE_NAME,
    value: encoded,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });

  console.log('[MetaTokenStorage] Token data stored in cookie');
}

/**
 * Clean up expired accounts from the list
 */
async function cleanupExpiredAccounts(data: StoredTokenData): Promise<StoredTokenData> {
  const now = Date.now();
  const validAccounts = data.accounts.filter(account => {
    if (!account.expiresAt) return true;
    return account.expiresAt * 1000 > now;
  });

  if (validAccounts.length === 0) {
    await clearMetaToken();
    return { accounts: [], activeIndex: 0 };
  }

  // Adjust activeIndex if needed
  let newActiveIndex = data.activeIndex;
  if (newActiveIndex >= validAccounts.length) {
    newActiveIndex = 0;
  }

  return {
    accounts: validAccounts,
    activeIndex: newActiveIndex,
  };
}

// ===== Public API =====

/**
 * Get the active Instagram account token
 * Returns null if no accounts or active account is expired
 */
export async function getMetaToken(): Promise<StoredAccount | null> {
  try {
    const data = await getRawTokenData();

    if (!data || data.accounts.length === 0) {
      return null;
    }

    // Clean up expired accounts
    const cleanedData = await cleanupExpiredAccounts(data);

    if (cleanedData.accounts.length === 0) {
      return null;
    }

    const activeAccount = cleanedData.accounts[cleanedData.activeIndex];
    return activeAccount;
  } catch (error) {
    console.error('[MetaTokenStorage] Error getting token:', error);
    return null;
  }
}

/**
 * Call the Graph API to refresh a long-lived token. Returns the new token +
 * lifetime, or throws. Bounded by a 12s timeout so a hung upstream can't stall
 * the caller (callers treat a throw as "keep the existing token").
 */
async function refreshLongLivedToken(accessToken: string): Promise<{ access_token: string; expires_in?: number }> {
  const res = await fetchWithTimeout(buildRefreshUrl(accessToken), { method: 'GET' }, 12000);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Refresh failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data?.error) {
    throw new Error(`Refresh error: ${data.error.message || data.error.type || JSON.stringify(data.error)}`);
  }
  if (typeof data?.access_token !== 'string' || !data.access_token) {
    throw new Error('Refresh returned no access_token');
  }
  return data;
}

// Anti-storm guards (per warm instance): a refresh keeps looking "due" until it
// succeeds, and publishing-limit polls this every 60s — so a persistently
// failing refresh would re-hit the Graph API every minute. A cooldown backs off
// after a failure; an in-flight map de-dupes a concurrent publish + limit-poll
// into a single network call. Mirrors google-token-storage's approach.
const REFRESH_COOLDOWN_MS = 15 * 60 * 1000; // back off 15m after a failed refresh
const refreshCooldownUntil = new Map<string, number>();
const inFlightRefresh = new Map<string, Promise<{ access_token: string; expires_in?: number }>>();

/**
 * Refresh ONE account's long-lived token when it's near expiry; best-effort.
 * A refresh failure logs, backs off (per-igUserId cooldown), and returns the
 * (still-valid) existing token rather than breaking the caller. The anti-storm
 * guards are keyed by igUserId, so this is safe to call for ANY account (active
 * or not). MUST be called from a Route Handler / Server Action — it may write
 * the cookie.
 */
async function refreshAccountToken(account: StoredAccount): Promise<StoredAccount> {
  if (!shouldRefreshToken(account.expiresAt, Date.now())) return account;

  // Key the guards by igUserId (the account identity). An account with no
  // igUserId yet is brand-new (60d out) and never reaches here.
  const key = account.igUserId || 'active';
  if (Date.now() < (refreshCooldownUntil.get(key) ?? 0)) return account;

  try {
    // Share a single network refresh across concurrent callers in this instance.
    let pending = inFlightRefresh.get(key);
    if (!pending) {
      pending = refreshLongLivedToken(account.userAccessToken);
      inFlightRefresh.set(key, pending);
    }
    let refreshed: { access_token: string; expires_in?: number };
    try {
      refreshed = await pending;
    } finally {
      inFlightRefresh.delete(key);
    }
    const newExpiresAt = computeExpiresAtSec(Date.now(), refreshed.expires_in);
    refreshCooldownUntil.delete(key);

    // Persist onto the SAME account, matched by igUserId only. Without a positive
    // match we do NOT trust the raw activeIndex (cleanup can drift it) — skip the
    // write and just hand back the fresh token in memory.
    const data = await getRawTokenData();
    if (data && account.igUserId) {
      const idx = data.accounts.findIndex(a => a.igUserId === account.igUserId);
      if (idx >= 0 && data.accounts[idx]) {
        data.accounts[idx] = { ...data.accounts[idx], userAccessToken: refreshed.access_token, expiresAt: newExpiresAt };
        await setMetaTokenRaw(data);
        // Refresh this ONE account in the shared store too (keyed by igUserId,
        // using the trusted just-refreshed token) so the shared row never expires
        // while a valid token exists — never mirror the whole (forgeable) cookie.
        try {
          await upsertSharedIgAccount(data.accounts[idx]);
        } catch {
          /* best-effort */
        }
      }
    }
    console.log('[MetaTokenStorage] Refreshed IG long-lived token (~60d extension)');
    return { ...account, userAccessToken: refreshed.access_token, expiresAt: newExpiresAt };
  } catch (error) {
    refreshCooldownUntil.set(key, Date.now() + REFRESH_COOLDOWN_MS);
    console.error('[MetaTokenStorage] Token refresh failed — backing off 15m, keeping existing token:', error);
    return account;
  }
}

/**
 * Get the active account, transparently refreshing its long-lived token when it
 * is close to expiring. Best-effort (see refreshAccountToken). MUST be called
 * from a Route Handler / Server Action — it may write the cookie. Read-only
 * callers (RSC, etc.) should use getMetaToken instead.
 */
export async function getFreshMetaToken(): Promise<StoredAccount | null> {
  const account = await getMetaToken();
  return account ? refreshAccountToken(account) : null;
}

/**
 * Get a SPECIFIC connected account by igUserId (no refresh), or the active
 * account when igUserId is omitted. Returns null when that account isn't in the
 * store (e.g. a configured page that isn't connected yet). Mirrors getMetaToken's
 * expiry cleanup — do NOT route this through exportAccounts (it skips cleanup).
 */
export async function getMetaTokenForAccount(igUserId?: string): Promise<StoredAccount | null> {
  if (!igUserId) return getMetaToken();
  try {
    const data = await getRawTokenData();
    if (!data || data.accounts.length === 0) return null;
    const cleaned = await cleanupExpiredAccounts(data);
    return cleaned.accounts.find(a => a.igUserId === igUserId) ?? null;
  } catch (error) {
    console.error('[MetaTokenStorage] Error getting token for account:', error);
    return null;
  }
}

/**
 * Like getFreshMetaToken but for a SPECIFIC account by igUserId (the active
 * account when omitted). Lets the insights/media routes serve any account by id
 * without changing which account is active for posting.
 */
export async function getFreshMetaTokenForAccount(igUserId?: string): Promise<StoredAccount | null> {
  const account = await getMetaTokenForAccount(igUserId);
  return account ? refreshAccountToken(account) : null;
}

/**
 * Add or update an Instagram account
 * - If igUserId already exists, update that account's token
 * - If new, add to array and set as active
 */
export async function setMetaToken(account: StoredAccount): Promise<void> {
  const data = await getRawTokenData();

  if (!data) {
    // First account
    await setMetaTokenRaw({
      accounts: [account],
      activeIndex: 0,
    });
    console.log('[MetaTokenStorage] Added first account:', account.igUsername);
    return;
  }

  // Check if this account already exists
  const existingIndex = data.accounts.findIndex(a => a.igUserId === account.igUserId);

  if (existingIndex >= 0) {
    // Update existing account
    data.accounts[existingIndex] = account;
    data.activeIndex = existingIndex;
    console.log('[MetaTokenStorage] Updated existing account:', account.igUsername);
  } else {
    // Add new account
    data.accounts.push(account);
    data.activeIndex = data.accounts.length - 1;
    console.log('[MetaTokenStorage] Added new account:', account.igUsername);
  }

  await setMetaTokenRaw(data);
}

/**
 * Update specific fields on the active account
 * Used by /api/video-reels/meta/me to store igUserId after connection
 */
export async function updateMetaToken(updates: Partial<StoredAccount>): Promise<void> {
  const data = await getRawTokenData();

  if (!data || data.accounts.length === 0) {
    throw new Error('No account found to update');
  }

  // Update the active account
  data.accounts[data.activeIndex] = {
    ...data.accounts[data.activeIndex],
    ...updates,
  };

  await setMetaTokenRaw(data);
}

/**
 * Clear all Instagram accounts from cookie
 */
export async function clearMetaToken(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  console.log('[MetaTokenStorage] All accounts cleared from cookie');
}

// ===== Server-side backup/restore bridge (public.meta_accounts) =====
// The cookie stays the runtime store; these expose it to the DB sync layer.
// exportAccounts reads the current blob (to back up); importAccounts writes a
// blob from the DB back into the cookie (to restore on a fresh browser).

export async function exportAccounts(): Promise<StoredTokenData | null> {
  return getRawTokenData();
}

export async function importAccounts(data: StoredTokenData): Promise<void> {
  if (!data || !Array.isArray(data.accounts)) return;
  await setMetaTokenRaw(data);
}

/**
 * Check if user has at least one valid Instagram account
 */
export async function hasMetaToken(): Promise<boolean> {
  const token = await getMetaToken();
  return token !== null;
}

/**
 * Get the Instagram User ID from the active account
 */
export async function getIgUserId(): Promise<string | null> {
  const token = await getMetaToken();
  return token?.igUserId || null;
}

/**
 * Get the Instagram User Access Token from the active account
 */
export async function getIgAccessToken(): Promise<string | null> {
  const token = await getMetaToken();
  return token?.userAccessToken || null;
}

/**
 * Get the Instagram Username from the active account
 */
export async function getIgUsername(): Promise<string | null> {
  const token = await getMetaToken();
  return token?.igUsername || null;
}

/**
 * Get all connected accounts (without access tokens)
 * Returns array for the account switcher UI
 */
export async function getAllAccounts(): Promise<Array<{ igUserId: string | undefined; igUsername: string | undefined; isActive: boolean }>> {
  const data = await getRawTokenData();

  if (!data || data.accounts.length === 0) {
    return [];
  }

  // Clean up expired accounts first
  const cleanedData = await cleanupExpiredAccounts(data);

  return cleanedData.accounts.map((account, index) => ({
    igUserId: account.igUserId,
    igUsername: account.igUsername,
    isActive: index === cleanedData.activeIndex,
  }));
}

/**
 * Set the active account by igUserId
 * Returns true if found, false if not
 */
export async function setActiveAccount(igUserId: string): Promise<boolean> {
  const data = await getRawTokenData();

  if (!data || data.accounts.length === 0) {
    return false;
  }

  const index = data.accounts.findIndex(a => a.igUserId === igUserId);

  if (index < 0) {
    return false;
  }

  data.activeIndex = index;
  await setMetaTokenRaw(data);
  console.log('[MetaTokenStorage] Switched active account to:', data.accounts[index].igUsername);
  return true;
}

/**
 * Remove a specific account by igUserId
 * If it was the active account, set activeIndex to 0
 * If no accounts remain, clear the cookie entirely
 */
export async function removeAccount(igUserId: string): Promise<void> {
  const data = await getRawTokenData();

  if (!data || data.accounts.length === 0) {
    return;
  }

  const wasActive = data.accounts[data.activeIndex]?.igUserId === igUserId;
  const indexToRemove = data.accounts.findIndex(a => a.igUserId === igUserId);

  if (indexToRemove < 0) {
    return; // Account not found, nothing to do
  }

  // Remove the account
  data.accounts.splice(indexToRemove, 1);

  // Handle activeIndex
  if (data.accounts.length === 0) {
    // No accounts left, clear cookie
    await clearMetaToken();
    return;
  }

  if (wasActive) {
    // Removed the active account, set to first remaining
    data.activeIndex = 0;
  } else if (data.activeIndex > indexToRemove) {
    // Adjust activeIndex if we removed an account before it
    data.activeIndex--;
  }

  await setMetaTokenRaw(data);
  console.log('[MetaTokenStorage] Removed account, remaining:', data.accounts.length);
}
