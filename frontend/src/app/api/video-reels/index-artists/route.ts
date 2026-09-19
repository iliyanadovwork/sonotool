import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { mapIndexArtists, INDEX_ARTIST_COLUMNS, type ArtistHistoryRow } from '@/lib/video-reels/index-artists';

export const runtime = 'nodejs';

// POST { ids: string[] } → { artists: IndexArtistDTO[] }
// Batch-fetch the `index` carousel's hero artists in ONE query against the charts
// Supabase project (the indextrading artist index) — replacing 16 round-trips to
// a now-dead backend. Best-effort: any failure returns { artists: [] } so the
// carousel simply no-ops (its draw already handles an empty list).
export async function POST(request: NextRequest) {
  let ids: string[] = [];
  try {
    const body = await request.json();
    ids = Array.isArray(body?.ids)
      ? body.ids.filter((x: unknown): x is string => typeof x === 'string' && x.length > 0).slice(0, 100)
      : [];
  } catch {
    return NextResponse.json({ artists: [] });
  }
  if (!ids.length) return NextResponse.json({ artists: [] });

  const url = process.env.NEXT_PUBLIC_CHARTS_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_CHARTS_SUPABASE_KEY;
  if (!url || !key) return NextResponse.json({ artists: [] });

  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await sb
      .from('artists_with_history')
      .select(INDEX_ARTIST_COLUMNS)
      .in('spotify_id', ids);
    if (error || !data) return NextResponse.json({ artists: [] });
    return NextResponse.json({ artists: mapIndexArtists(data as ArtistHistoryRow[], ids) });
  } catch (e) {
    console.error('[index-artists] charts query failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ artists: [] });
  }
}
