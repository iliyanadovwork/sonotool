import { NextRequest, NextResponse } from 'next/server';
import { getRequestUserId } from '@/lib/video-reels/meta-user';
import { getSharedConnection, SHARED_IG_KEY, SHARED_GOOGLE_KEY } from '@/lib/video-reels/meta-db';
import { importAccounts, exportAccounts, StoredTokenData } from '@/lib/video-reels/meta-token-storage';
import { setGoogleToken, GoogleToken } from '@/lib/video-reels/google-token-storage';
import { mergeIgBlobs, IgBlob } from '@/lib/video-reels/merge-accounts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/video-reels/meta/restore  (Authorization: Bearer <supabase jwt>)
// Pulls the TEAM-SHARED connections (Instagram accounts + Google token) from
// public.shared_connections into this browser's cookies, so every logged-in
// teammate sees the same connected accounts. Requires login; best-effort (any
// DB failure degrades to a no-op). No password needed — this only syncs; the
// password gates the actions (connect/switch/disconnect/publish).
export async function POST(request: NextRequest) {
  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 });
  }

  let ig = 0;
  let google = false;

  // MERGE the shared IG accounts into this browser's cookie (don't overwrite —
  // a just-connected local account that hasn't reached the shared store yet must
  // survive; a stale cookie can only gain teammates' accounts, never lose the
  // fresh one). Removal of an account propagates via the disconnecting browser +
  // a later cookie clear, not by restore stomping local state.
  const shared = await getSharedConnection(SHARED_IG_KEY) as IgBlob | null;
  const local = await exportAccounts() as IgBlob | null;
  const merged = mergeIgBlobs(shared, local);
  if (merged.accounts.length > 0) {
    await importAccounts(merged as unknown as StoredTokenData);
    ig = merged.accounts.length;
  }

  const gBlob = await getSharedConnection(SHARED_GOOGLE_KEY) as GoogleToken | null;
  if (gBlob && typeof gBlob.accessToken === 'string' && gBlob.accessToken) {
    await setGoogleToken(gBlob);
    google = true;
  }

  return NextResponse.json({ ok: true, ig, google });
}
