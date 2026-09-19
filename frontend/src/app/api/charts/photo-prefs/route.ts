import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

export const runtime = 'nodejs';

// Per-artist "last photo used" + circular-frame crop for Chart Reels, keyed by spotify_id.
// Read/written only here via the service key (RLS-locked table). Lives in sonotooldev.
function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
}

// GET -> { [spotify_id]: { photo_url, frame } } for every artist that has a saved preference.
export async function GET() {
  try {
    const { data, error } = await admin().from('artist_photo_pref').select('spotify_id, photo_url, frame');
    if (error) throw new Error(error.message);
    const map: Record<string, { photo_url: string; frame: unknown }> = {};
    for (const row of data ?? []) map[row.spotify_id] = { photo_url: row.photo_url, frame: row.frame ?? null };
    return NextResponse.json(map);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST { spotify_id, photo_url, frame? } -> remember the artist's last-used photo + framing.
export async function POST(req: NextRequest) {
  try {
    const Schema = z.object({
      spotify_id: z.string().min(1),
      photo_url: z.string().min(1),
      frame: z.object({ zoom: z.number(), panX: z.number(), panY: z.number() }).nullable().optional(),
    });
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'spotify_id and photo_url required' }, { status: 400 });
    const { spotify_id, photo_url, frame } = parsed.data;

    const { error } = await admin()
      .from('artist_photo_pref')
      .upsert({ spotify_id, photo_url, frame: frame ?? null, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
