// Constant-time comparison of the OAuth `state` parameter for CSRF protection.
// The value we generate is a random UUID, so a plain === would already be safe;
// constant-time is belt-and-suspenders and keeps the intent explicit. Both sides
// must be non-empty strings of equal length to match — an absent cookie or a
// forged/blank state never validates.
export function statesMatch(received: string | null | undefined, expected: string | null | undefined): boolean {
  if (typeof received !== 'string' || typeof expected !== 'string') return false;
  if (received.length === 0 || expected.length === 0) return false;
  if (received.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < received.length; i++) {
    diff |= received.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

// Cookie the authorize step sets and the callback validates. Short-lived: the
// user should complete the Instagram consent screen within minutes.
export const OAUTH_STATE_COOKIE = 'meta_oauth_state';
export const OAUTH_STATE_MAX_AGE_SEC = 600; // 10 minutes

// Cookie carrying which Instagram app (registry key) the connect was started
// with, so the callback exchanges the code against the right app's credentials.
// Same lifetime as the state cookie; consumed once.
export const OAUTH_APP_COOKIE = 'meta_oauth_app';

// CSRF state cookie for the Google OAuth connect (separate flow from Instagram).
export const GOOGLE_OAUTH_STATE_COOKIE = 'google_oauth_state';
