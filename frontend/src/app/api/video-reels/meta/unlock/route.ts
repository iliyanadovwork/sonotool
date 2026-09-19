import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  verifyPassword,
  makeUnlockToken,
  accessGateConfigured,
  isUnlocked,
  META_UNLOCK_COOKIE,
  UNLOCK_TTL_MS,
  UNLOCK_TTL_SEC,
} from '@/lib/video-reels/meta-unlock';
import { getRequestUserId } from '@/lib/video-reels/meta-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/video-reels/meta/unlock → { configured, unlocked }
// Lets the client decide whether to show the password prompt.
export async function GET() {
  return NextResponse.json({
    configured: accessGateConfigured(),
    unlocked: await isUnlocked(),
  });
}

// POST /api/video-reels/meta/unlock  { password }
// Verifies the shared password and, on success, sets a signed 12h unlock cookie.
export async function POST(request: NextRequest) {
  // Require login so only authenticated team members can attempt the password
  // (shrinks brute-force surface; scrypt already makes each guess expensive).
  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 });
  }

  let password: unknown;
  try {
    password = (await request.json())?.password;
  } catch {
    password = undefined;
  }

  if (!accessGateConfigured()) {
    // Match isUnlocked()'s fail-closed-in-production policy: returning a false
    // "unlocked" here while isUnlocked() reports locked drives an unrecoverable
    // prompt loop. In prod a misconfigured gate is an explicit error.
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { ok: false, error: 'The team password isn\'t configured. Contact the administrator.' },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, unlocked: true, reason: 'not-configured' });
  }

  if (!verifyPassword(password)) {
    return NextResponse.json({ ok: false, error: 'Incorrect password.' }, { status: 401 });
  }

  const cookieStore = await cookies();
  cookieStore.set({
    name: META_UNLOCK_COOKIE,
    value: makeUnlockToken(Date.now(), UNLOCK_TTL_MS),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: UNLOCK_TTL_SEC,
  });
  return NextResponse.json({ ok: true, unlocked: true });
}

// DELETE /api/video-reels/meta/unlock → clears the unlock (re-lock).
export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(META_UNLOCK_COOKIE);
  return NextResponse.json({ ok: true, unlocked: false });
}
