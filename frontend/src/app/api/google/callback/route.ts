import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';

export const runtime = 'nodejs';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/google/callback`
);

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(
      new URL(`/?google_error=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/?google_error=no_code', request.url)
    );
  }

  try {
    console.log('Exchanging code for tokens...');

    // Exchange code for tokens using getToken (not getAccessToken)
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;

    if (!accessToken) {
      throw new Error('No access token received');
    }

    console.log('Token exchange successful');

    // Redirect back to app with tokens (in practice, you'd store these securely)
    const redirectUrl = new URL('/', request.url);
    redirectUrl.searchParams.set('google_access_token', accessToken);
    if (refreshToken) {
      redirectUrl.searchParams.set('google_refresh_token', refreshToken);
    }

    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : undefined;
    console.error('Token exchange error:', message || error);
    console.error('Error details:', error);
    return NextResponse.redirect(
      new URL(`/?google_error=${encodeURIComponent(message || 'token_exchange_failed')}`, request.url)
    );
  }
}
