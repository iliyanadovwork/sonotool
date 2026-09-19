import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Chart data source: the Sonotrade Supabase (artists_with_history view, readable with the
// publishable key — same thing the trading site's own /api/search does). The deployed trading
// API made data_points opt-in and dropped releases, so we read the view directly; the API
// stays as a fallback when the Supabase env isn't set.
const TRADING_SUPABASE_URL = process.env.TRADING_SUPABASE_URL;
const TRADING_SUPABASE_KEY = process.env.TRADING_SUPABASE_KEY;
const TRADING_API_URL = process.env.TRADING_API_URL || 'https://indextrading-one.vercel.app';

// GET /api/posts/charts/search?q=<name> → { results: [{ id, name, image_url, index_price, change_1m, volume }] }
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim();
  if (!q) return NextResponse.json({ results: [] });

  try {
    if (TRADING_SUPABASE_URL && TRADING_SUPABASE_KEY) {
      const url = new URL(`${TRADING_SUPABASE_URL}/rest/v1/artists_with_history`);
      url.searchParams.set('select', 'spotify_id,artist_name,spotify_img,current_index_value,change_1m,volume');
      url.searchParams.set('artist_name', `ilike.*${q.replaceAll('*', '')}*`);
      url.searchParams.set('limit', '8');
      const res = await fetch(url.toString(), {
        headers: { apikey: TRADING_SUPABASE_KEY, Authorization: `Bearer ${TRADING_SUPABASE_KEY}` },
        next: { revalidate: 300 },
      });
      if (!res.ok) {
        return NextResponse.json({ error: `Search failed (${res.status})`, results: [] }, { status: 502 });
      }
      const rows: {
        spotify_id: string; artist_name: string; spotify_img: string | null;
        current_index_value: number | null; change_1m: number | null; volume: number | null;
      }[] = await res.json();
      const results = rows
        .map(r => ({
          id: r.spotify_id,
          name: r.artist_name,
          image_url: r.spotify_img,
          index_price: r.current_index_value,
          change_1m: r.change_1m,
          volume: r.volume,
        }))
        .sort((a, b) => (b.index_price ?? 0) - (a.index_price ?? 0));
      return NextResponse.json({ results });
    }

    const res = await fetch(`${TRADING_API_URL}/api/search?q=${encodeURIComponent(q)}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Search failed (${res.status})`, results: [] }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('[Posts Charts Search] error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Search request failed', results: [] }, { status: 502 });
  }
}
