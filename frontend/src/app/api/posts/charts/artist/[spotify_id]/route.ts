import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Chart data source: the Sonotrade Supabase (artists_with_history view, readable with the
// publishable key). The deployed trading API made data_points opt-in (capped at 240) and
// dropped releases entirely, so we read the view directly for the FULL series + releases —
// the chart box snapshots both. The API stays as a fallback when the Supabase env isn't set.
const TRADING_SUPABASE_URL = process.env.TRADING_SUPABASE_URL;
const TRADING_SUPABASE_KEY = process.env.TRADING_SUPABASE_KEY;
const TRADING_API_URL = process.env.TRADING_API_URL || 'https://indextrading-one.vercel.app';

// data_points / releases are jsonb that PostgREST may hand back as a string.
function parseJsonArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

// GET /api/posts/charts/artist/<spotify_id> → { artist: { name, spotify_id, image_url, data_points:
// {index,timestamp}[], releases: {date,name,image,...}[], change_*, ... } } (shape passed through).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ spotify_id: string }> },
) {
  const { spotify_id } = await params;
  if (!spotify_id) return NextResponse.json({ error: 'spotify_id is required' }, { status: 400 });

  try {
    if (TRADING_SUPABASE_URL && TRADING_SUPABASE_KEY) {
      const url = new URL(`${TRADING_SUPABASE_URL}/rest/v1/artists_with_history`);
      url.searchParams.set('select', 'spotify_id,artist_name,spotify_img,current_index_value,change_1d,change_1m,data_points,releases');
      url.searchParams.set('spotify_id', `eq.${spotify_id}`);
      url.searchParams.set('limit', '1');
      const res = await fetch(url.toString(), {
        headers: { apikey: TRADING_SUPABASE_KEY, Authorization: `Bearer ${TRADING_SUPABASE_KEY}` },
        next: { revalidate: 3600 },
      });
      if (!res.ok) {
        return NextResponse.json({ error: `Artist fetch failed (${res.status})` }, { status: 502 });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any[] = await res.json();
      const r = rows[0];
      if (!r) return NextResponse.json({ error: 'Artist not found' }, { status: 404 });

      return NextResponse.json({
        artist: {
          name: r.artist_name,
          spotify_id: r.spotify_id,
          index_price: r.current_index_value ?? null,
          mark_price: r.current_index_value ?? null,
          image_url: r.spotify_img ?? null,
          change_1d: r.change_1d ?? null,
          change_1m: r.change_1m ?? null,
          data_points: parseJsonArray(r.data_points),
          releases: parseJsonArray(r.releases),
        },
      });
    }

    const res = await fetch(`${TRADING_API_URL}/api/artist/${encodeURIComponent(spotify_id)}?history=true`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Artist fetch failed (${res.status})` }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('[Posts Charts Artist] error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Artist request failed' }, { status: 502 });
  }
}
