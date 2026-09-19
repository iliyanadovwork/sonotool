import { NextRequest, NextResponse } from 'next/server';
// @ts-expect-error — no @types package for google-trends-api
import googleTrends from 'google-trends-api';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

interface TimelinePoint {
  time: string;
  value: number[];
  formattedTime: string;
}
type Point = { timestamp: number; value: number };

// Google Trends interest changes slowly — cache per term and refresh at most weekly,
// so we don't hit Google (and get rate-limited) on every load. Cache lives in sonotoolv3.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function GET(req: NextRequest) {
  const term = req.nextUrl.searchParams.get('term')?.trim();
  if (!term) return NextResponse.json({ error: 'term required' }, { status: 400 });

  const db = admin();

  // 1) Serve from cache if fresh.
  try {
    const { data } = await db.from('trends_cache').select('points, updated_at').eq('term', term).maybeSingle();
    if (data && Date.now() - new Date(data.updated_at as string).getTime() < TTL_MS) {
      return NextResponse.json(data.points, { headers: { 'X-Cache': 'hit' } });
    }
  } catch { /* cache read failed — fall through to a live fetch */ }

  // 2) Miss/stale → fetch from Google Trends, then store.
  try {
    const raw: string = await googleTrends.interestOverTime({
      keyword: term,
      startTime: new Date('2004-01-01'),
      endTime:   new Date(),
    });
    const parsed = JSON.parse(raw) as { default: { timelineData: TimelinePoint[] } };
    const timeline = parsed?.default?.timelineData ?? [];
    if (!timeline.length) return NextResponse.json({ error: 'no data returned' }, { status: 404 });

    const points: Point[] = timeline.map((p) => ({ timestamp: parseInt(p.time, 10) * 1000, value: p.value[0] }));
    try { await db.from('trends_cache').upsert({ term, points, updated_at: new Date().toISOString() }); } catch { /* store is best-effort */ }
    return NextResponse.json(points, { headers: { 'X-Cache': 'miss' } });
  } catch (err: unknown) {
    // 3) On failure (e.g. rate limit), serve a stale cached copy if we have one.
    try {
      const { data } = await db.from('trends_cache').select('points').eq('term', term).maybeSingle();
      if (data) return NextResponse.json(data.points, { headers: { 'X-Cache': 'stale' } });
    } catch { /* ignore */ }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('429') || msg.includes('Too Many')) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
