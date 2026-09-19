import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Service-role Supabase client for the team-shared connection store
// (public.shared_connections). Uses SUPABASE_SECRET_KEY, so it bypasses RLS — the
// table has RLS enabled with no policies, so ONLY this client can read/write it.
// Returns null when unconfigured so the shared layer degrades to a no-op (the app
// keeps working cookie-only).

let cached: SupabaseClient | null = null;

export function getMetaDb(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  if (!cached) {
    cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return cached;
}

// Generic team-shared connection store (public.shared_connections): one row per
// connection type holding its token blob, shared by the whole team. The row is
// written/read ONLY by server routes via the service role (RLS deny-all). The
// gated restore route then hydrates these tokens into the caller's per-user cookie
// so the team's connections follow every logged-in member. Accepted trade-off:
// app login is the real trust boundary; the shared password is a soft posting
// gate, not a hard wall against a logged-in teammate who reads their own cookie.
export const SHARED_CONNECTIONS_TABLE = 'shared_connections';
export const SHARED_IG_KEY = 'ig_accounts';       // { accounts, activeIndex }
export const SHARED_GOOGLE_KEY = 'google_token';  // { accessToken, refreshToken }

/** Read a shared connection blob, or null (unconfigured DB / missing row / error). */
export async function getSharedConnection(key: string): Promise<unknown | null> {
  const db = getMetaDb();
  if (!db) return null;
  try {
    const { data, error } = await db
      .from(SHARED_CONNECTIONS_TABLE)
      .select('data')
      .eq('key', key)
      .maybeSingle();
    if (error) {
      console.error('[SharedConn] read failed:', key, error.message);
      return null;
    }
    return data?.data ?? null;
  } catch (e) {
    console.error('[SharedConn] read error:', key, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Upsert a shared connection blob. Returns false on unconfigured DB / error. */
export async function setSharedConnection(key: string, data: unknown): Promise<boolean> {
  const db = getMetaDb();
  if (!db) return false;
  try {
    const { error } = await db
      .from(SHARED_CONNECTIONS_TABLE)
      .upsert({ key, data, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) {
      console.error('[SharedConn] write failed:', key, error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[SharedConn] write error:', key, e instanceof Error ? e.message : e);
    return false;
  }
}

// ----- Keyed IG-account mutations (trusted sources only) -----
// The shared IG row is written ONLY via these keyed read-modify-writes from
// trusted server-side sources (the OAuth token on connect, a refreshed token, an
// explicit disconnect) — never mirrored from the forgeable/stale meta_token
// cookie. Each touches exactly one account by igUserId, so a caller can't drop or
// replace a teammate's account or inject a forged one.

interface SharedIgAccount { igUserId?: string; userAccessToken?: string; expiresAt?: number; igUsername?: string }
interface SharedIgBlob { accounts?: SharedIgAccount[]; activeIndex?: number }

/** Insert/replace one account (by igUserId) in the shared IG row. */
export async function upsertSharedIgAccount(account: SharedIgAccount): Promise<void> {
  if (!account || typeof account.igUserId !== 'string' || !account.igUserId) return;
  const shared = (await getSharedConnection(SHARED_IG_KEY)) as SharedIgBlob | null;
  const accounts = Array.isArray(shared?.accounts) ? [...shared!.accounts] : [];
  const idx = accounts.findIndex((a) => a?.igUserId === account.igUserId);
  if (idx >= 0) accounts[idx] = account;
  else accounts.push(account);
  await setSharedConnection(SHARED_IG_KEY, { accounts, activeIndex: shared?.activeIndex ?? 0 });
}

/** Remove one account (by igUserId) from the shared IG row; delete the row if it empties. */
export async function removeSharedIgAccount(igUserId: string): Promise<void> {
  if (!igUserId) return;
  const shared = (await getSharedConnection(SHARED_IG_KEY)) as SharedIgBlob | null;
  if (!shared || !Array.isArray(shared.accounts)) return;
  const accounts = shared.accounts.filter((a) => a?.igUserId !== igUserId);
  if (accounts.length === 0) {
    await deleteSharedConnection(SHARED_IG_KEY);
    return;
  }
  await setSharedConnection(SHARED_IG_KEY, { accounts, activeIndex: 0 });
}

/** Delete a shared connection row (explicit disconnect). */
export async function deleteSharedConnection(key: string): Promise<boolean> {
  const db = getMetaDb();
  if (!db) return false;
  try {
    const { error } = await db.from(SHARED_CONNECTIONS_TABLE).delete().eq('key', key);
    return !error;
  } catch {
    return false;
  }
}
