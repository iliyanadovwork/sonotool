import { NextRequest, NextResponse } from 'next/server';
import { getGoogleToken, clearGoogleToken, GoogleAuthError } from '@/lib/video-reels/google-token-storage';
import { isAbortError } from '@/lib/video-reels/fetch-timeout';
import { isUnlocked } from '@/lib/video-reels/meta-unlock';
import { deleteSharedConnection, SHARED_GOOGLE_KEY } from '@/lib/video-reels/meta-db';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const token = await getGoogleToken();

    if (!token) {
      return NextResponse.json(
        { error: 'Not connected to Google. Please connect your account first.' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      connected: true,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : undefined;
    console.error('[Google Me] Error:', message || error);

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
      { error: message || 'Failed to check Google connection' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  // ?shared=1 → a real team disconnect (deletes the shared Google row): managing
  // action, requires the password. No param → just clear THIS browser's cookie
  // (used by connect's pre-auth reset), which needs no gate.
  const shared = request.nextUrl.searchParams.get('shared') === '1';
  if (shared && !(await isUnlocked())) {
    return NextResponse.json(
      { error: 'Enter the team password to disconnect Google.', locked: true },
      { status: 403 },
    );
  }
  try {
    await clearGoogleToken();
    if (shared) await deleteSharedConnection(SHARED_GOOGLE_KEY);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: (error instanceof Error ? error.message : undefined) || 'Failed to disconnect' },
      { status: 500 }
    );
  }
}
