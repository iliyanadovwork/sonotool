import { NextRequest, NextResponse } from 'next/server';
import { clearMetaToken, removeAccount, getAllAccounts } from '@/lib/video-reels/meta-token-storage';
import { isUnlocked } from '@/lib/video-reels/meta-unlock';
import { removeSharedIgAccount, deleteSharedConnection, SHARED_IG_KEY } from '@/lib/video-reels/meta-db';

export const runtime = 'nodejs';

interface DisconnectRequestBody {
  igUserId?: string;
  all?: boolean;
}

/**
 * POST /api/video-reels/meta/disconnect
 *
 * Supports two modes:
 * 1. Disconnect a specific account: { "igUserId": "123" }
 * 2. Disconnect all accounts: {} or { "all": true }
 *
 * Response: { "success": true, "remainingAccounts": number }
 */
export async function POST(request: NextRequest) {
  if (!(await isUnlocked())) {
    return NextResponse.json(
      { error: 'Enter the team password to manage Instagram accounts.', locked: true },
      { status: 403 },
    );
  }
  try {
    // Parse body, handling empty body case
    let body: DisconnectRequestBody = {};
    try {
      body = await request.json();
    } catch {
      // Empty body - treat as disconnect all
      body = {};
    }

    const { igUserId } = body;

    if (igUserId) {
      // Disconnect a specific account — from this browser AND the shared store
      // (by igUserId, so teammates' other accounts are untouched).
      await removeAccount(igUserId);
      await removeSharedIgAccount(igUserId);

      // Get remaining count
      const accounts = await getAllAccounts();
      return NextResponse.json({
        success: true,
        remainingAccounts: accounts.length,
      });
    }

    // Disconnect all accounts — clear the cookie AND the shared IG row.
    await clearMetaToken();
    await deleteSharedConnection(SHARED_IG_KEY);
    return NextResponse.json({
      success: true,
      remainingAccounts: 0,
    });
  } catch (error) {
    console.error('[Meta Disconnect] Error:', error);
    return NextResponse.json(
      { error: (error instanceof Error ? error.message : undefined) || 'Failed to disconnect' },
      { status: 500 }
    );
  }
}
