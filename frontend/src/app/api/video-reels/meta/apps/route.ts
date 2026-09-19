import { NextResponse } from 'next/server';
import { getPublicInstagramApps } from '@/lib/video-reels/instagram-apps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/video-reels/meta/apps → { apps: [{ key, label }] }
// The connect picker uses this to list which Instagram apps (profiles) are
// wired up. Secret-free by construction (getPublicInstagramApps strips them).
export async function GET() {
  return NextResponse.json({ apps: getPublicInstagramApps() });
}
