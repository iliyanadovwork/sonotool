import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { OAUTH_STATE_COOKIE, OAUTH_STATE_MAX_AGE_SEC, OAUTH_APP_COOKIE } from '@/lib/video-reels/oauth-state';
import { getInstagramApp, getDefaultInstagramApp } from '@/lib/video-reels/instagram-apps';
import { isUnlocked } from '@/lib/video-reels/meta-unlock';

export const runtime = 'nodejs';
// Never let this be statically optimized/cached — the OAuth URL must reflect current env.
export const dynamic = 'force-dynamic';

// Scopes for the Instagram API with Instagram Login (Content Publishing +
// account-level Insights). instagram_business_manage_insights is required for the
// analytics panel (graph.instagram.com/{ig-user-id}/insights); it is the
// Instagram-Login permission, NOT the old Facebook-Login 'instagram_manage_insights'.
// Adding a scope invalidates prior consent, so every already-connected page must
// reconnect once to mint an insights-capable token (a token refresh does NOT add
// scopes) — until then the analytics panel shows profile counts + a reconnect prompt.
const SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_insights',
];

export async function GET(request: NextRequest) {
  try {
    // Connecting an account is a "managing" action — requires the team password.
    if (!(await isUnlocked())) {
      return NextResponse.json(
        { error: 'Enter the team password to connect an Instagram account.', locked: true },
        { status: 403 },
      );
    }
    const redirectUri = process.env.INSTAGRAM_REDIRECT_URI;

    // Pick which app (profile) to connect through. ?app=<key> selects from the
    // registry; absent/unknown falls back to the first configured app. The app
    // only matters here + in the callback (the code→token exchange).
    const requestedKey = request.nextUrl.searchParams.get('app');
    const app = getInstagramApp(requestedKey) ?? getDefaultInstagramApp();

    if (!app) {
      return NextResponse.json(
        { error: 'No Instagram app configured (set INSTAGRAM_APPS or INSTAGRAM_APP_ID)' },
        { status: 500 }
      );
    }

    if (!redirectUri) {
      return NextResponse.json(
        { error: 'INSTAGRAM_REDIRECT_URI not configured' },
        { status: 500 }
      );
    }

    // Generate a random state and persist it (CSRF), alongside the chosen app
    // key so the callback exchanges the code against the right app's secret.
    // Both are httpOnly and sent on the top-level redirect back (sameSite lax).
    const state = crypto.randomUUID();

    const cookieStore = await cookies();
    const cookieBase = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
      maxAge: OAUTH_STATE_MAX_AGE_SEC,
    };
    cookieStore.set({ name: OAUTH_STATE_COOKIE, value: state, ...cookieBase });
    cookieStore.set({ name: OAUTH_APP_COOKIE, value: app.key, ...cookieBase });

    // Build the Instagram OAuth authorize URL
    const params = new URLSearchParams({
      client_id: app.appId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(','),
      state: state,
    });

    // Instagram's OAuth authorize endpoint
    const authUrl = `https://www.instagram.com/oauth/authorize?${params.toString()}`;

    console.log('[Instagram Auth] Generated OAuth URL for app:', app.key);

    return NextResponse.json({
      url: authUrl,
      state,
      app: app.key,
    });
  } catch (error) {
    console.error('[Instagram Auth] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate OAuth URL' },
      { status: 500 }
    );
  }
}
