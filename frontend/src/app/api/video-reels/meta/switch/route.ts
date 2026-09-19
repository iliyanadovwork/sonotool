import { NextRequest, NextResponse } from 'next/server';
import { setActiveAccount, getIgUsername } from '@/lib/video-reels/meta-token-storage';
import { isUnlocked } from '@/lib/video-reels/meta-unlock';

export const runtime = 'nodejs';

// 403 body for a gated action attempted while locked. A function (not a shared
// instance) so each request gets its own Response.
const locked = () =>
  NextResponse.json(
    { error: 'Enter the team password to manage Instagram accounts.', locked: true },
    { status: 403 },
  );

/**
 * POST /api/video-reels/meta/switch
 *
 * Switches the active Instagram account
 *
 * Body: { "igUserId": "123" }
 *
 * Response (success):
 *   { "success": true, "igUserId": "123", "igUsername": "account_two" }
 *
 * Response (not found):
 *   { "error": "Account not found" }
 */
export async function POST(request: NextRequest) {
  if (!(await isUnlocked())) return locked();
  try {
    const body = await request.json();
    const { igUserId } = body;

    if (!igUserId) {
      return NextResponse.json(
        { error: 'igUserId is required' },
        { status: 400 }
      );
    }

    const switched = await setActiveAccount(igUserId);

    if (!switched) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      );
    }

    // Get the new active account's username
    const username = await getIgUsername();

    return NextResponse.json({
      success: true,
      igUserId,
      igUsername: username || '',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '';
    console.error('[Meta Switch] Error:', message || error);
    return NextResponse.json(
      { error: message || 'Failed to switch account' },
      { status: 500 }
    );
  }
}
