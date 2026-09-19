import { cookies } from 'next/headers';
import { fetchWithTimeout, isAbortError } from '@/lib/video-reels/fetch-timeout';
import { getSharedConnection, setSharedConnection, SHARED_GOOGLE_KEY } from '@/lib/video-reels/meta-db';

export interface GoogleToken {
  accessToken: string;
  refreshToken?: string;
}

/**
 * Thrown when refreshing the Google access token fails definitively (revoked
 * access, invalid/expired refresh token, missing credentials). Routes can catch
 * this and return a 401 so the client knows to trigger a reconnect flow.
 */
export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

/**
 * Dedupe concurrent token refreshes: when several requests hit a 401 at once,
 * they all share this single in-flight refresh promise so only ONE network
 * refresh runs. Set at the start of the network work and cleared in a finally.
 */
let inFlightRefresh: Promise<string> | null = null;

const COOKIE_NAME = 'google_token';
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

/**
 * Encode data for storage in cookie (base64 encode)
 */
function encode(data: GoogleToken): string {
  const json = JSON.stringify(data);
  return Buffer.from(json).toString('base64');
}

/**
 * Decode data from cookie
 */
function decode(encoded: string): GoogleToken {
  try {
    const json = Buffer.from(encoded, 'base64').toString('utf-8');
    return JSON.parse(json) as GoogleToken;
  } catch (error) {
    console.error('[GoogleTokenStorage] Failed to decode token:', error);
    throw new Error('Invalid token data');
  }
}

/**
 * Store Google token in httpOnly cookie
 */
export async function setGoogleToken(token: GoogleToken): Promise<void> {
  const cookieStore = await cookies();

  const encoded = encode(token);

  cookieStore.set({
    name: COOKIE_NAME,
    value: encoded,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: MAX_AGE,
    path: '/',
  });

  console.log('[GoogleTokenStorage] Token stored in cookie');
}

/**
 * Get Google token from cookie
 */
export async function getGoogleToken(): Promise<GoogleToken | null> {
  try {
    const cookieStore = await cookies();
    const encoded = cookieStore.get(COOKIE_NAME)?.value;

    if (!encoded) {
      return null;
    }

    return decode(encoded);
  } catch (error) {
    console.error('[GoogleTokenStorage] Error getting token:', error);
    return null;
  }
}

/**
 * Clear Google token from cookie
 */
export async function clearGoogleToken(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  console.log('[GoogleTokenStorage] Token cleared from cookie');
}

/**
 * Check if user has a valid Google token
 */
export async function hasGoogleToken(): Promise<boolean> {
  const token = await getGoogleToken();
  return token !== null;
}

/**
 * Exchange a refresh token for a fresh access token. Updates the stored
 * cookie with the new access token. Throws a {@link GoogleAuthError} if the
 * refresh fails definitively (e.g., the user revoked access or the refresh
 * token is invalid) and clears the stored cookie so the client reconnects.
 *
 * Concurrent callers are deduped via the module-level `inFlightRefresh`
 * promise: only ONE network refresh runs; the rest await the same promise.
 */
async function refreshAccessToken(token: GoogleToken): Promise<string> {
  // If a refresh is already running, share it instead of starting another.
  if (inFlightRefresh) {
    return inFlightRefresh;
  }

  if (!token.refreshToken) {
    // No refresh token to work with — definitively unauthenticated.
    await clearGoogleToken();
    throw new GoogleAuthError('No refresh token available — please reconnect Google.');
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    // Server misconfiguration, not an auth/credentials problem — surface as a
    // plain error (callers map this to a 500, not a reconnect prompt).
    throw new Error('Google OAuth client credentials are not configured.');
  }

  // Start the single shared network refresh and clear the slot when it settles.
  inFlightRefresh = (async (): Promise<string> => {
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: token.refreshToken!,
      grant_type: 'refresh_token',
    });

    let res: Response;
    try {
      res = await fetchWithTimeout(
        'https://oauth2.googleapis.com/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        },
        15000
      );
    } catch (error) {
      // A timeout is NOT a definitive auth failure — do NOT clear the cookie and
      // do NOT surface as a GoogleAuthError (which would prompt a reconnect).
      // Rethrow as a plain Error so routes map it to a generic 500/504.
      if (isAbortError(error)) {
        throw new Error('Google token refresh timed out');
      }
      throw error;
    }

    if (!res.ok) {
      const body = await res.text();
      console.error('[GoogleTokenStorage] Refresh failed:', res.status, body);
      // Definitive auth failure: drop the stored cookie so the client reconnects.
      await clearGoogleToken();
      throw new GoogleAuthError(`Token refresh failed (${res.status}). Please reconnect Google.`);
    }

    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) {
      await clearGoogleToken();
      throw new GoogleAuthError('Refresh response missing access_token.');
    }

    // Persist the new access token; keep the existing refresh token (Google does
    // not return a new one on refresh).
    await setGoogleToken({
      accessToken: data.access_token,
      refreshToken: token.refreshToken,
    });
    // Keep the team-shared Google copy fresh too — but ONLY if a shared row still
    // exists, so a refresh can't resurrect a token a teammate disconnected.
    try {
      const existing = await getSharedConnection(SHARED_GOOGLE_KEY);
      if (existing) {
        await setSharedConnection(SHARED_GOOGLE_KEY, {
          accessToken: data.access_token,
          refreshToken: token.refreshToken,
        });
      }
    } catch {
      /* best-effort */
    }
    console.log('[GoogleTokenStorage] Access token refreshed');
    return data.access_token;
  })().finally(() => {
    // Always release the slot so a later expiry can refresh again.
    inFlightRefresh = null;
  });

  return inFlightRefresh;
}

/**
 * Fetch a Google API with the stored access token. On 401 we transparently
 * refresh the access token using the stored refresh token and retry once.
 *
 * Callers should pass `init` exactly as they would to `fetch` — do NOT set an
 * Authorization header; this helper adds it.
 */
export async function googleFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getGoogleToken();
  if (!token) {
    throw new Error('Not connected to Google. Please connect your account first.');
  }

  const buildHeaders = (accessToken: string): HeadersInit => ({
    ...(init.headers || {}),
    Authorization: `Bearer ${accessToken}`,
  });

  // A response status is transient (worth one quick retry) when Google is rate
  // limiting (429) or returning a server-side error (>= 500).
  const isTransient = (status: number) => status === 429 || status >= 500;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Bounded attempt loop (max 3 total network attempts). On each response:
  //  - 401  -> refresh the access token (deduped) and retry with the new token.
  //  - 429/5xx -> back off briefly and retry with the current stored token.
  //  - otherwise -> return the response.
  // This ensures a 401 surfaced AFTER a transient retry still triggers a refresh
  // (e.g. first response is 5xx, the retry then returns 401).
  const MAX_ATTEMPTS = 3;
  let accessToken = token.accessToken;
  let response = await fetchWithTimeout(
    url,
    { ...init, headers: buildHeaders(accessToken) },
    15000
  );

  for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
    if (response.status === 401) {
      // The stored access token has expired. Use the refresh token to mint a
      // new one (concurrent callers are deduped) and retry with it.
      console.log('[GoogleTokenStorage] Access token expired, refreshing...');
      accessToken = await refreshAccessToken(token);
    } else if (isTransient(response.status)) {
      // Transient upstream failure (rate limit / 5xx) — wait briefly, then
      // retry. Re-read the (possibly refreshed) token so the retry stays valid.
      console.log(`[GoogleTokenStorage] Transient ${response.status} from Google, retrying once...`);
      await sleep(400);
      const current = await getGoogleToken();
      accessToken = current?.accessToken ?? accessToken;
    } else {
      break;
    }

    response = await fetchWithTimeout(
      url,
      { ...init, headers: buildHeaders(accessToken) },
      15000
    );
  }

  return response;
}
