import { NextRequest, NextResponse } from 'next/server';
import { fetchTopComments, hasCommentsProvider } from '@/lib/video-reels/comments-provider';

export const runtime = 'nodejs';
// One HikerAPI call + local decode — fast, but give headroom for a slow upstream.
export const maxDuration = 30;

// POST { url: string, limit?: number } → { comments: ReelComment[] }
// Fetches the top comments (by like count) of an Instagram reel. Comments are a
// best-effort add-on: the client treats any error as "no comments", never fatal.
export async function POST(request: NextRequest) {
  if (!hasCommentsProvider()) {
    return NextResponse.json({ error: 'Comments provider not configured (set HIKERAPI_KEY).' }, { status: 500 });
  }

  let url: string;
  let limit = 12;
  try {
    const body = await request.json();
    url = typeof body.url === 'string' ? body.url.trim() : '';
    if (Number.isFinite(Number(body.limit))) limit = Math.min(50, Math.max(1, Math.trunc(Number(body.limit))));
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (!url) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }

  const result = await fetchTopComments(url, limit);
  if (!result.ok) {
    // Preserve rate-limit as 429 so the client can back off; otherwise pass the
    // provider's status (400 for non-IG URL, 402/5xx upstream, etc.).
    const status = result.rateLimited ? 429 : result.status >= 400 ? result.status : 502;
    return NextResponse.json({ error: result.detail }, { status });
  }
  return NextResponse.json({ comments: result.comments });
}
