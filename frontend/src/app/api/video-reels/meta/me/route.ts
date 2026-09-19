import { NextRequest, NextResponse } from 'next/server';
import { getMetaToken, updateMetaToken } from '@/lib/video-reels/meta-token-storage';
import { fetchWithTimeout, isAbortError } from '@/lib/video-reels/fetch-timeout';
import { upsertSharedIgAccount } from '@/lib/video-reels/meta-db';
import { isUnlocked } from '@/lib/video-reels/meta-unlock';

export const runtime = 'nodejs';

interface InstagramUser {
  id: string;
  username: string;
  account_type?: string;
}

/**
 * Fetch the authenticated Instagram user's info
 * Uses Instagram Graph API (not Facebook)
 */
async function getInstagramUser(accessToken: string): Promise<InstagramUser> {
  // Use Instagram's Graph API to fetch user info
  const url = new URL('https://graph.instagram.com/me');
  url.searchParams.set('fields', 'id,username,account_type');
  url.searchParams.set('access_token', accessToken);

  // Redact the access_token before logging the full Graph URL.
  const redactedUrl = url.toString().replace(
    encodeURIComponent(accessToken),
    'REDACTED'
  );
  console.log('[Instagram Me] Fetching from:', redactedUrl);

  // 12s upstream timeout so a hung Graph API call can't consume the whole budget.
  const response = await fetchWithTimeout(url.toString(), {}, 12000);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch user: ${error}`);
  }

  const data = await response.json();

  console.log('[Instagram Me] Response:', JSON.stringify(data));

  if (data.error) {
    throw new Error(`API error: ${data.error.message || data.error.type || JSON.stringify(data.error)}`);
  }

  if (!data.id) {
    throw new Error('No user ID in response');
  }

  return data;
}

export async function GET(request: NextRequest) {
  try {
    // Get the stored token
    const token = await getMetaToken();

    if (!token) {
      return NextResponse.json(
        { error: 'Not connected to Instagram. Please connect your account first.' },
        { status: 401 }
      );
    }

    console.log('[Instagram Me] Token exists, fetching user info...');

    const user = await getInstagramUser(token.userAccessToken);

    console.log('[Instagram Me] Found user:', user.username);

    // Store the igUserId in the token for later use
    await updateMetaToken({
      igUserId: user.id,
      igUsername: user.username,
    });

    // The connect callback pushes this account to the team-shared store, but only
    // when its own inline /me fetch resolved igUserId. If that fetch timed out the
    // account was stored cookie-only and never reached the team row — and since a
    // fresh token is ~60 days from expiry, the near-expiry refresh re-sync won't
    // fire for weeks. This backfill is where igUserId first becomes known in that
    // case, so mirror it up to the shared store now. Gated on the same unlock the
    // connect flow already required, so a mere viewer can't seed the team store.
    // Best-effort — never block the response on it.
    if (await isUnlocked()) {
      try {
        await upsertSharedIgAccount({
          userAccessToken: token.userAccessToken,
          expiresAt: token.expiresAt,
          igUserId: user.id,
          igUsername: user.username,
        });
      } catch {
        /* best-effort */
      }
    }

    return NextResponse.json({
      id: user.id,
      username: user.username,
      accountType: user.account_type,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : undefined;
    console.error('[Instagram Me] Error:', message || error);

    if (isAbortError(error)) {
      return NextResponse.json(
        { error: 'Upstream timed out. Please try again.' },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { error: message || 'Failed to fetch Instagram user info' },
      { status: 500 }
    );
  }
}
