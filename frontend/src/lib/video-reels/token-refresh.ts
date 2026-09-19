// Pure helpers for Instagram long-lived token refresh. Kept free of next/headers
// (no cookie access) so they're unit-testable and can be imported anywhere.
//
// Instagram long-lived user tokens last ~60 days and CAN be refreshed via
// `ig_refresh_token` — but only while still valid and at least 24h old. We
// refresh proactively once a token enters its final window, which also
// guarantees it's well past the 24h minimum age.

// Refresh once the token has less than this long until it expires. A 60-day
// token that's inside a 10-day window is ~50 days old, so the ≥24h-age rule is
// always satisfied by the time we attempt a refresh.
export const REFRESH_WINDOW_MS = 10 * 24 * 60 * 60 * 1000; // 10 days

// Meta's default long-lived token lifetime, used when a response omits expires_in.
export const DEFAULT_TOKEN_TTL_SEC = 60 * 60 * 24 * 60; // 60 days

/**
 * Should we refresh this token now? True only when the token is still valid
 * (not already expired) AND within REFRESH_WINDOW_MS of expiring. An absent /
 * zero / non-finite expiry never triggers a refresh.
 */
export function shouldRefreshToken(
  expiresAtSec: number | undefined | null,
  nowMs: number,
  windowMs: number = REFRESH_WINDOW_MS,
): boolean {
  if (typeof expiresAtSec !== 'number' || !Number.isFinite(expiresAtSec) || expiresAtSec <= 0) {
    return false;
  }
  const expMs = expiresAtSec * 1000;
  return expMs > nowMs && expMs - nowMs < windowMs;
}

/** Unix-seconds expiry from a refresh response's expires_in (seconds), with a 60-day fallback. */
export function computeExpiresAtSec(nowMs: number, expiresInSec: number | undefined | null): number {
  const ttl = typeof expiresInSec === 'number' && Number.isFinite(expiresInSec) && expiresInSec > 0
    ? expiresInSec
    : DEFAULT_TOKEN_TTL_SEC;
  return Math.floor(nowMs / 1000) + ttl;
}

/** Build the Graph API refresh URL. Separated out so tests can assert its shape. */
export function buildRefreshUrl(accessToken: string, host = 'https://graph.instagram.com'): string {
  const url = new URL(`${host}/refresh_access_token`);
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', accessToken);
  return url.toString();
}
