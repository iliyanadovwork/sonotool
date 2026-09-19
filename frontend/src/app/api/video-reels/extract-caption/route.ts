import { NextRequest, NextResponse } from 'next/server';
import { extractCaptionFromFrames } from '@/lib/video-reels/caption-extraction';

export const runtime = 'nodejs';
// Vision calls are usually fast, but give headroom for a slow model response.
export const maxDuration = 60;

// POST { frames: string[] (JPEG data URLs, 1-3), spread?: number }
// → { caption: string | null, keyUsed: number }
export async function POST(request: NextRequest) {
  let frames: string[];
  let spread = 0;
  try {
    const body = await request.json();
    frames = Array.isArray(body.frames) ? body.frames : [];
    spread = Number.isFinite(Number(body.spread)) ? Math.abs(Math.trunc(Number(body.spread))) : 0;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Strip the data-URL prefix down to raw base64; validate size and count.
  const b64Frames = frames
    .slice(0, 3)
    .map((f) => (typeof f === 'string' ? f.replace(/^data:image\/[a-z]+;base64,/i, '') : ''))
    .filter((f) => f.length > 0 && f.length < 3_000_000); // ~2 MB per frame max

  if (!b64Frames.length) {
    return NextResponse.json({ error: 'No valid frames provided' }, { status: 400 });
  }

  const result = await extractCaptionFromFrames(b64Frames, spread);
  if (!result.ok) {
    // Pool-wide rate limiting surfaces as 429 so clients can back off long
    // enough for the per-minute quota window to roll over (same contract as
    // generate-caption).
    return NextResponse.json({ error: result.message }, { status: result.rateLimited ? 429 : result.status >= 500 ? 502 : result.status });
  }
  return NextResponse.json({ caption: result.caption, keyUsed: result.keyUsed });
}
