import { createHmac, scryptSync, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';

// Shared-password gate for the team's Instagram accounts. Viewing is open;
// posting / connecting / switching / disconnecting require a valid unlock.
//
// - Password stored ONLY as a scrypt hash: META_ACCESS_PASSWORD_HASH =
//   "<saltHex>:<hashHex>". verifyPasswordHash re-derives + compares constant-time.
// - A successful unlock issues a short-lived signed cookie: meta_unlock =
//   "<expiresMs>.<hmac>", HMAC-SHA256 over the expiry with META_UNLOCK_SECRET.
//   Nothing secret is in the cookie; it can't be forged without the secret.
// - If the gate isn't configured (env unset), it is OPEN — the feature degrades
//   to today's behaviour rather than blocking everyone. Set the env to enforce.

export const META_UNLOCK_COOKIE = 'meta_unlock';
export const UNLOCK_TTL_MS = 12 * 60 * 60 * 1000; // 12h
export const UNLOCK_TTL_SEC = UNLOCK_TTL_MS / 1000;

const PASSWORD_HASH = process.env.META_ACCESS_PASSWORD_HASH;
const UNLOCK_SECRET = process.env.META_UNLOCK_SECRET;

// ===== Pure helpers (no env / no cookies) — unit-testable =====

/** Constant-time check of a password against a "<saltHex>:<hashHex>" scrypt hash. */
export function verifyPasswordHash(password: unknown, storedHash: string | undefined | null): boolean {
  if (!storedHash || typeof password !== 'string' || !password) return false;
  const sep = storedHash.indexOf(':');
  if (sep <= 0) return false;
  const salt = storedHash.slice(0, sep);
  const hashHex = storedHash.slice(sep + 1);
  if (!salt || !hashHex || !/^[0-9a-fA-F]+$/.test(hashHex) || hashHex.length % 2 !== 0) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const derived = scryptSync(password, salt, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Sign an unlock token valid until `expMs`: "<expMs>.<hmac>". */
export function signUnlockToken(expMs: number, secret: string): string {
  const exp = String(expMs);
  return `${exp}.${createHmac('sha256', secret).update(exp).digest('hex')}`;
}

/** Verify a signed unlock token: valid signature AND not expired at nowMs. */
export function checkUnlockToken(token: unknown, secret: string | undefined | null, nowMs: number): boolean {
  if (!secret || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < nowMs) return false;
  const expected = createHmac('sha256', secret).update(expStr).digest('hex');
  if (sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ===== Env-bound wrappers =====

export function accessGateConfigured(): boolean {
  return !!(PASSWORD_HASH && UNLOCK_SECRET);
}

export function verifyPassword(password: unknown): boolean {
  return verifyPasswordHash(password, PASSWORD_HASH);
}

export function makeUnlockToken(nowMs: number, ttlMs: number = UNLOCK_TTL_MS): string {
  return signUnlockToken(nowMs + ttlMs, UNLOCK_SECRET!);
}

/**
 * Whether the current request may perform gated actions. Fail-OPEN when the gate
 * isn't configured (env unset) so the feature isn't bricked before secrets are
 * provisioned; once configured, requires a valid meta_unlock cookie.
 */
export async function isUnlocked(): Promise<boolean> {
  if (!accessGateConfigured()) {
    // Fail CLOSED in production: a missing/typo'd/partial gate config must not
    // silently disable protection. Dev/preview stay open so the feature isn't
    // bricked before the secrets are provisioned.
    if (process.env.NODE_ENV === 'production') {
      if (PASSWORD_HASH || UNLOCK_SECRET) {
        console.error(
          '[meta-unlock] PARTIAL gate config in production (only one of ' +
          'META_ACCESS_PASSWORD_HASH / META_UNLOCK_SECRET is set) — failing closed.',
        );
      }
      return false;
    }
    return true;
  }
  const cookieStore = await cookies();
  return checkUnlockToken(cookieStore.get(META_UNLOCK_COOKIE)?.value, UNLOCK_SECRET, Date.now());
}
