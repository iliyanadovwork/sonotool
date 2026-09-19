import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { deepseekChat, parseJson } from '@/lib/deepseek';

function getChartsClient() {
  return createClient(
    process.env.NEXT_PUBLIC_CHARTS_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_CHARTS_SUPABASE_KEY!,
  );
}

type ArtistRow = {
  spotify_id: string;
  artist_name: string;
  spotify_img: string | null;
};

export async function GET() {
  try {
    const sb = getChartsClient();
    const { data, error } = await sb
      .from('artists_with_history')
      .select('spotify_id,artist_name,spotify_img')
      .not('current_index_value', 'is', null)
      .order('current_index_value', { ascending: false })
      .limit(200);

    if (error) throw new Error(error.message);
    if (!data?.length) return NextResponse.json({ groups: [] });

    const rows = data as ArtistRow[];
    // Use numeric indices so the model never has to copy complex IDs
    const list = rows.map((r, i) => `${i}|${r.artist_name}`).join('\n');

    const prompt = `You are given a list of the top 200 music artists from a streaming platform.
Each line: index|artist_name

Group them into head-to-head comparison pairs. Good pairs are rivals, peers in the same genre, or artists fans love to compare (e.g. Drake vs Kendrick, Taylor Swift vs Beyoncé, The Weeknd vs Frank Ocean).

Rules:
- Each artist appears at most ONCE across all pairs
- Only pair artists who are genuinely comparable — same genre or well-known rivalry
- Create as many meaningful pairs as you can from the full list
- "reason" must be 4–7 words, e.g. "Hip-hop rivals", "Pop music queens", "R&B heavyweights"
- Use ONLY integer indices from the list below — valid range is 0 to ${rows.length - 1}
- Do NOT invent or guess indices outside that range

Artists:
${list}

Return ONLY valid JSON, no explanation:
{ "groups": [ { "a_idx": 0, "b_idx": 3, "reason": "..." } ] }`;

    const raw = await deepseekChat(
      [{ role: 'user', content: prompt }],
      { json: true, temperature: 0.4 },
    );

    const parsed = parseJson<{ groups: Array<{ a_idx: number; b_idx: number; reason: string }> }>(raw);

    const groups = (parsed?.groups ?? [])
      .filter(g => {
        const ai = Number(g.a_idx), bi = Number(g.b_idx);
        return Number.isInteger(ai) && Number.isInteger(bi) && ai !== bi && rows[ai] != null && rows[bi] != null;
      })
      .map(g => {
        const a = rows[Number(g.a_idx)];
        const b = rows[Number(g.b_idx)];
        return {
          a: { id: a.spotify_id, name: a.artist_name, ticker: a.spotify_id, photo_url: a.spotify_img, industry: null },
          b: { id: b.spotify_id, name: b.artist_name, ticker: b.spotify_id, photo_url: b.spotify_img, industry: null },
          reason: g.reason,
        };
      });

    return NextResponse.json({ groups });
  } catch (err) {
    console.error('[charts-groups]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
