import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { google } from 'googleapis';
import { GoogleAuthError } from '@/lib/video-reels/google-token-storage';
import { isAbortError } from '@/lib/video-reels/fetch-timeout';
import { isUnlocked } from '@/lib/video-reels/meta-unlock';
import { GOOGLE_OAUTH_STATE_COOKIE, OAUTH_STATE_MAX_AGE_SEC } from '@/lib/video-reels/oauth-state';

export const runtime = 'nodejs';
// Never let this be statically optimized/cached — the OAuth URL must reflect current env.
export const dynamic = 'force-dynamic';

// OAuth2 configuration
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/video-reels/google/callback`
);

// Scopes for Google Sheets access (read/write to update status)
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

export async function GET(request: NextRequest) {
  try {
    // Connecting the shared Google account is a managing action → team password.
    if (!(await isUnlocked())) {
      return NextResponse.json(
        { error: 'Enter the team password to connect a Google account.', locked: true },
        { status: 403 },
      );
    }

    // CSRF: random state persisted in an httpOnly cookie, verified on callback.
    const state = crypto.randomUUID();
    const cookieStore = await cookies();
    cookieStore.set({
      name: GOOGLE_OAUTH_STATE_COOKIE,
      value: state,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: OAUTH_STATE_MAX_AGE_SEC,
    });

    // Generate the OAuth URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
      state,
    });

    return NextResponse.json({ authUrl });
  } catch (error) {
    console.error('OAuth error:', error);

    // Refresh failed definitively — tell the client to reconnect Google.
    if (error instanceof GoogleAuthError) {
      return NextResponse.json(
        { error: 'Please reconnect your Google account.' },
        { status: 401 }
      );
    }
    // Upstream timed out — surface as a gateway timeout.
    if (isAbortError(error)) {
      return NextResponse.json(
        { error: 'Google request timed out. Please try again.' },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to generate OAuth URL' },
      { status: 500 }
    );
  }
}
