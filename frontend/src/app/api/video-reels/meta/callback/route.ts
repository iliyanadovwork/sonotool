import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { setMetaToken } from '@/lib/video-reels/meta-token-storage';
import { fetchWithTimeout, isAbortError } from '@/lib/video-reels/fetch-timeout';
import { statesMatch, OAUTH_STATE_COOKIE, OAUTH_APP_COOKIE } from '@/lib/video-reels/oauth-state';
import { getInstagramApp, getDefaultInstagramApp, InstagramAppConfig } from '@/lib/video-reels/instagram-apps';
import { isUnlocked } from '@/lib/video-reels/meta-unlock';
import { upsertSharedIgAccount } from '@/lib/video-reels/meta-db';

export const runtime = 'nodejs';

/**
 * Exchange authorization code for a short-lived Instagram User Access Token
 */
async function exchangeCodeForToken(code: string, app: InstagramAppConfig): Promise<{ access_token: string; expires_in: number }> {
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI;

  console.log('[Instagram Callback] Step 1: Exchange code for token');
  console.log('[Instagram Callback] redirectUri:', JSON.stringify(redirectUri));
  console.log('[Instagram Callback] app:', app.key, 'appId:', app.appId);

  if (!redirectUri) {
    throw new Error('Missing INSTAGRAM_REDIRECT_URI');
  }

  const url = new URL('https://api.instagram.com/oauth/access_token');

  const body = new URLSearchParams({
    client_id: app.appId,
    client_secret: app.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code: code,
  });

  // 12s upstream timeout on the OAuth token exchange.
  const response = await fetchWithTimeout(
    url.toString(),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
    12000
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('[Instagram Callback] Token exchange error:', error);
    throw new Error(`Step 1 failed: ${error}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`Step 1 error: ${data.error_message || data.error.type || data.error}`);
  }

  console.log('[Instagram Callback] Step 1 success: Got short-lived token');
  return data;
}

/**
 * Exchange short-lived Instagram User Access Token for a long-lived one
 * Uses Instagram's Graph API endpoint
 */
async function getLongLivedToken(shortLivedToken: string, app: InstagramAppConfig): Promise<{ access_token: string; expires_in: number }> {
  console.log('[Instagram Callback] Step 2: Exchange for long-lived token');

  const url = new URL('https://graph.instagram.com/access_token');
  url.searchParams.set('grant_type', 'ig_exchange_token');
  url.searchParams.set('client_secret', app.appSecret);
  url.searchParams.set('access_token', shortLivedToken);

  console.log('[Instagram Callback] Calling:', 'https://graph.instagram.com/access_token');

  // 12s upstream timeout on the long-lived token exchange.
  const response = await fetchWithTimeout(url.toString(), { method: 'GET' }, 12000);

  if (!response.ok) {
    const error = await response.text();
    console.error('[Instagram Callback] Long-lived token error:', error);
    throw new Error(`Step 2 failed: ${error}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`Step 2 error: ${data.error.message || data.error.type || JSON.stringify(data.error)}`);
  }

  console.log('[Instagram Callback] Step 2 success: Got long-lived token');
  return data;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const errorReason = searchParams.get('error_reason');
  const state = searchParams.get('state');

  console.log('[Instagram Callback] Called with code:', !!code, 'error:', error);

  // Handle OAuth errors from Instagram
  if (error) {
    console.error('[Instagram Callback] OAuth error:', error, errorReason);
    return errorPage(`OAuth denied: ${errorReason || error}`);
  }

  if (!code) {
    return errorPage('No authorization code received from Instagram');
  }

  // CSRF check: the state returned by Instagram must match the one we stored in
  // an httpOnly cookie at /auth. Read the chosen app key too, then consume both
  // cookies (one-time use) regardless of outcome.
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  const appKey = cookieStore.get(OAUTH_APP_COOKIE)?.value;
  cookieStore.delete(OAUTH_STATE_COOKIE);
  cookieStore.delete(OAUTH_APP_COOKIE);
  if (!statesMatch(state, expectedState)) {
    console.error('[Instagram Callback] State mismatch — possible CSRF. Rejecting.');
    return errorPage('Security check failed (invalid state). Please start the connection again.');
  }

  // Connecting writes a shared account — require the team password here too, in
  // case the callback is hit directly without going through the gated /auth.
  if (!(await isUnlocked())) {
    return errorPage('Enter the team password before connecting an Instagram account.');
  }

  // Resolve which app this connect was started with (falls back to the default).
  const app = getInstagramApp(appKey) ?? getDefaultInstagramApp();
  if (!app) {
    return errorPage('No Instagram app configured. Please contact the administrator.');
  }

  try {
    // Step 1: Exchange code for short-lived token
    const { access_token: shortLivedToken } = await exchangeCodeForToken(code, app);

    // Step 2: Exchange for long-lived token
    const { access_token, expires_in } = await getLongLivedToken(shortLivedToken, app);

    // Step 3: Store the token
    const expiresAt = Math.floor(Date.now() / 1000) + (expires_in || 5184000);

    // Resolve the IG user id up front so the stored account is fully identified.
    // (A token-keyed placeholder would later duplicate when merged into the
    // shared store; the /me client call still backfills this if the fetch fails.)
    let igUserId: string | undefined;
    let igUsername: string | undefined;
    try {
      const gv = process.env.META_GRAPH_VERSION || 'v22.0';
      const meUrl = new URL(`https://graph.instagram.com/${gv}/me`);
      meUrl.searchParams.set('fields', 'id,username');
      meUrl.searchParams.set('access_token', access_token);
      const meRes = await fetchWithTimeout(meUrl.toString(), {}, 12000);
      if (meRes.ok) {
        const me = await meRes.json();
        if (typeof me?.id === 'string') igUserId = me.id;
        if (typeof me?.username === 'string') igUsername = me.username;
      }
    } catch {
      /* best-effort */
    }

    await setMetaToken({
      userAccessToken: access_token,
      expiresAt,
      igUserId,
      igUsername,
    });

    // Push the just-connected account to the TEAM-SHARED store from the trusted
    // OAuth token (keyed by igUserId), so teammates see it. This — plus refresh
    // and disconnect — are the ONLY writers of the shared IG row; it is never
    // mirrored from the forgeable/stale cookie.
    if (igUserId) {
      try {
        await upsertSharedIgAccount({ userAccessToken: access_token, expiresAt, igUserId, igUsername });
      } catch {
        /* best-effort */
      }
    }

    console.log('[Instagram Callback] Success! Token stored.');

    // Show success page with auto-redirect
    return successPage();

  } catch (error) {
    console.error('[Instagram Callback] Error:', error);

    if (isAbortError(error)) {
      return NextResponse.json(
        { error: 'Upstream timed out. Please try again.' },
        { status: 504 }
      );
    }

    return errorPage((error instanceof Error ? error.message : undefined) || 'Unknown error');
  }
}

// Escape before interpolating into HTML. errorPage messages can include
// attacker-controlled OAuth query params (error/error_reason), and this page is
// served as text/html on a top-level GET before any auth — so an unescaped
// message is a reflected-XSS sink.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function errorPage(message: string) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head><title>Instagram Connection Error</title></head>
    <body style="font-family: sans-serif; padding: 40px; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #e11d48;">❌ Instagram Connection Failed</h1>
      <p style="font-size: 16px;"><strong>Error:</strong></p>
      <pre style="background: #fee2e2; padding: 16px; border-radius: 8px; overflow-x: auto;">${escapeHtml(message)}</pre>
      <p><a href="/" style="color: #3b82f6;">← Go back to Video Reels</a></p>
    </body>
    </html>
  `;
  return new NextResponse(html, {
    status: 400,
    headers: { 'Content-Type': 'text/html' }
  });
}

function successPage() {
  const html = `
    <!DOCTYPE html>
    <html>
    <head><title>Instagram Connected</title></head>
    <body style="font-family: sans-serif; padding: 40px; max-width: 600px; margin: 0 auto; text-align: center;">
      <h1 style="color: #10b981;">✅ Instagram Connected!</h1>
      <p style="font-size: 18px;">Your Instagram account has been connected successfully.</p>
      <p>Redirecting you back...</p>
      <script>
        setTimeout(() => { window.location.href = '/?meta=connected'; }, 1500);
      </script>
    </body>
    </html>
  `;
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' }
  });
}
