import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { clearMetaToken } from '@/lib/video-reels/meta-token-storage';
import { clearGoogleToken } from '@/lib/video-reels/google-token-storage';
import { META_UNLOCK_COOKIE } from '@/lib/video-reels/meta-unlock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/video-reels/meta/logout
// Clears this browser's local connection cookies (Instagram + Google tokens and
// the password unlock) on sign-out. The TEAM-SHARED copies in
// public.shared_connections are untouched — they restore on the next login. No
// auth needed: it only clears the current browser's own cookies.
export async function POST() {
  await clearMetaToken();
  await clearGoogleToken();
  const cookieStore = await cookies();
  cookieStore.delete(META_UNLOCK_COOKIE);
  return NextResponse.json({ ok: true });
}
