import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { google } from 'googleapis';
import { setGoogleToken, GoogleAuthError } from '@/lib/video-reels/google-token-storage';
import { isAbortError } from '@/lib/video-reels/fetch-timeout';
import { isUnlocked } from '@/lib/video-reels/meta-unlock';
import { statesMatch, GOOGLE_OAUTH_STATE_COOKIE } from '@/lib/video-reels/oauth-state';
import { setSharedConnection, SHARED_GOOGLE_KEY } from '@/lib/video-reels/meta-db';

export const runtime = 'nodejs';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/video-reels/google/callback`
);

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const state = searchParams.get('state');

  if (error) {
    return errorPage(`OAuth denied: ${error}`);
  }

  if (!code) {
    return errorPage('No authorization code received from Google');
  }

  // CSRF: the returned state must match the cookie set at /google/auth. Consume
  // the cookie either way (one-time use).
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(GOOGLE_OAUTH_STATE_COOKIE);
  if (!statesMatch(state, expectedState)) {
    return errorPage('Security check failed (invalid state). Please start the connection again.');
  }

  // Connecting the shared Google account is a managing action → team password.
  if (!(await isUnlocked())) {
    return errorPage('Enter the team password before connecting a Google account.');
  }

  try {
    console.log('[Google Callback] Exchanging code for tokens...');

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;

    if (!accessToken) {
      throw new Error('No access token received');
    }

    console.log('[Google Callback] Token exchange successful');

    // Store token in cookie
    await setGoogleToken({
      accessToken,
      refreshToken: refreshToken || undefined,
    });

    // Persist to the TEAM-SHARED store from the trusted OAuth token, so teammates
    // get it on restore. (Refresh + disconnect are the only other writers.)
    try {
      await setSharedConnection(SHARED_GOOGLE_KEY, { accessToken, refreshToken: refreshToken || undefined });
    } catch {
      /* best-effort */
    }

    // Show success page with auto-redirect
    return successPage();

  } catch (error) {
    const message = error instanceof Error ? error.message : undefined;
    console.error('[Google Callback] Token exchange error:', message || error);

    // This route renders a user-facing HTML page (it is the OAuth redirect
    // target, not a JSON API the client parses), so we keep returning an error
    // page but tailor the message for the auth/timeout cases.
    if (error instanceof GoogleAuthError) {
      return errorPage('Please reconnect your Google account.');
    }
    if (isAbortError(error)) {
      return errorPage('Google request timed out. Please try again.');
    }

    return errorPage(message || 'Token exchange failed');
  }
}

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
    <head><title>Google Connection Error</title></head>
    <body style="font-family: sans-serif; padding: 40px; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #e11d48;">❌ Google Connection Failed</h1>
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
    <head><title>Google Connected</title></head>
    <body style="font-family: sans-serif; padding: 40px; max-width: 600px; margin: 0 auto; text-align: center;">
      <h1 style="color: #10b981;">✅ Google Connected!</h1>
      <p style="font-size: 18px;">Your Google account has been connected successfully.</p>
      <p>Redirecting you back...</p>
      <script>
        setTimeout(() => { window.location.href = '/?google=connected'; }, 1500);
      </script>
    </body>
    </html>
  `;
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' }
  });
}
