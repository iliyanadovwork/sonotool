import { describe, it, expect } from 'vitest';
import {
  shouldRefreshToken,
  computeExpiresAtSec,
  buildRefreshUrl,
  REFRESH_WINDOW_MS,
  DEFAULT_TOKEN_TTL_SEC,
} from './token-refresh';

const NOW = 1_000_000_000_000; // fixed "now" in ms
const DAY = 24 * 60 * 60 * 1000;
const atOffsetSec = (ms: number) => Math.round((NOW + ms) / 1000); // expiry as unix seconds

describe('shouldRefreshToken', () => {
  it('refreshes when the token is valid but inside the refresh window', () => {
    expect(shouldRefreshToken(atOffsetSec(5 * DAY), NOW)).toBe(true);
  });

  it('does NOT refresh a token with plenty of life left', () => {
    expect(shouldRefreshToken(atOffsetSec(30 * DAY), NOW)).toBe(false);
  });

  it('does NOT refresh an already-expired token (must reconnect instead)', () => {
    expect(shouldRefreshToken(atOffsetSec(-1 * DAY), NOW)).toBe(false);
    expect(shouldRefreshToken(atOffsetSec(0), NOW)).toBe(false); // exactly now = expired
  });

  it('treats the window edge as strictly less-than', () => {
    // Exactly REFRESH_WINDOW_MS away → not yet (strict <).
    expect(shouldRefreshToken(Math.round((NOW + REFRESH_WINDOW_MS) / 1000), NOW)).toBe(false);
    // One second inside the window → yes.
    expect(shouldRefreshToken(Math.round((NOW + REFRESH_WINDOW_MS - 1000) / 1000), NOW)).toBe(true);
  });

  it('respects a custom window', () => {
    const twoDays = 2 * DAY;
    expect(shouldRefreshToken(atOffsetSec(5 * DAY), NOW, twoDays)).toBe(false);
    expect(shouldRefreshToken(atOffsetSec(1 * DAY), NOW, twoDays)).toBe(true);
  });

  it('never refreshes on a missing / invalid expiry', () => {
    expect(shouldRefreshToken(0, NOW)).toBe(false);
    expect(shouldRefreshToken(-100, NOW)).toBe(false);
    expect(shouldRefreshToken(undefined, NOW)).toBe(false);
    expect(shouldRefreshToken(null, NOW)).toBe(false);
    expect(shouldRefreshToken(Number.NaN, NOW)).toBe(false);
  });
});

describe('computeExpiresAtSec', () => {
  it('adds expires_in (seconds) to now', () => {
    expect(computeExpiresAtSec(NOW, 3600)).toBe(Math.floor(NOW / 1000) + 3600);
  });

  it('falls back to the 60-day default for a missing/invalid expires_in', () => {
    const expected = Math.floor(NOW / 1000) + DEFAULT_TOKEN_TTL_SEC;
    expect(computeExpiresAtSec(NOW, undefined)).toBe(expected);
    expect(computeExpiresAtSec(NOW, null)).toBe(expected);
    expect(computeExpiresAtSec(NOW, 0)).toBe(expected);
    expect(computeExpiresAtSec(NOW, -10)).toBe(expected);
    expect(computeExpiresAtSec(NOW, Number.NaN)).toBe(expected);
  });
});

describe('buildRefreshUrl', () => {
  it('builds the ig_refresh_token URL with the token', () => {
    const u = new URL(buildRefreshUrl('TOKEN123'));
    expect(u.origin + u.pathname).toBe('https://graph.instagram.com/refresh_access_token');
    expect(u.searchParams.get('grant_type')).toBe('ig_refresh_token');
    expect(u.searchParams.get('access_token')).toBe('TOKEN123');
  });

  it('url-encodes a token with special characters', () => {
    const u = new URL(buildRefreshUrl('a b&c=d'));
    expect(u.searchParams.get('access_token')).toBe('a b&c=d'); // decoded back correctly
    expect(buildRefreshUrl('a b&c=d')).not.toContain('a b&c=d'); // encoded on the wire
  });

  it('honors a host override', () => {
    expect(buildRefreshUrl('t', 'https://example.test')).toContain('https://example.test/refresh_access_token');
  });
});
