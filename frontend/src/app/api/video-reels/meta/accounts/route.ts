import { NextRequest, NextResponse } from 'next/server';
import { getAllAccounts } from '@/lib/video-reels/meta-token-storage';

export const runtime = 'nodejs';

/**
 * GET /api/video-reels/meta/accounts
 *
 * Returns list of all connected Instagram accounts for the account switcher UI
 * Does NOT include access tokens (security)
 */
export async function GET(request: NextRequest) {
  try {
    const accounts = await getAllAccounts();

    return NextResponse.json({
      accounts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : undefined;
    console.error('[Meta Accounts] Error:', message || error);
    return NextResponse.json(
      { error: message || 'Failed to fetch accounts' },
      { status: 500 }
    );
  }
}
