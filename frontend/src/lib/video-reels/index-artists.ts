// Maps `artists_with_history` rows (from the charts Supabase project) into the
// shape the video-reels `index` CTA carousel draws. Kept pure + separate from the
// route so it's unit-testable and there's one definition of the field mapping.

/** A row as selected from artists_with_history. All fields are best-effort. */
export interface ArtistHistoryRow {
  spotify_id?: unknown;
  artist_name?: unknown;
  spotify_img?: unknown;
  current_index_value?: unknown;
  change_1m?: unknown;
  data_points?: unknown;
}

export interface IndexArtistDTO {
  name: string;
  image_url: string | null;
  index_price: number | null;
  change_1m: number | null;
  data_points: { index: number; timestamp: string }[];
}

/** The columns to SELECT — kept next to the mapper so they can't drift apart. */
export const INDEX_ARTIST_COLUMNS =
  'spotify_id,artist_name,spotify_img,current_index_value,change_1m,data_points';

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// The carousel's sparkline (idxBuildChart in TikTokCanvas) sorts points by time
// and downsamples to this many — so a full multi-year daily history (~1,200+ pts)
// ships as ~6× more bytes than it can ever draw. Pre-applying the same sort +
// even-spacing here keeps the sparkline pixel-identical while shrinking the
// payload from ~1.1MB to ~170KB for 16 heroes.
export const MAX_DATA_POINTS = 300;

function normalizeDataPoints(v: unknown): { index: number; timestamp: string }[] {
  if (!Array.isArray(v)) return [];
  const pts: { index: number; timestamp: string; t: number }[] = [];
  for (const p of v) {
    if (!p || typeof p !== 'object') continue;
    const rec = p as Record<string, unknown>;
    const index = Number(rec.index);
    const timestamp = rec.timestamp;
    if (!Number.isFinite(index) || typeof timestamp !== 'string' || !timestamp) continue;
    const t = Date.parse(timestamp);
    if (Number.isNaN(t)) continue;
    pts.push({ index, timestamp, t });
  }
  pts.sort((a, b) => a.t - b.t);
  const capped =
    pts.length > MAX_DATA_POINTS
      ? Array.from({ length: MAX_DATA_POINTS }, (_, i) =>
          pts[Math.min(Math.round((i * (pts.length - 1)) / (MAX_DATA_POINTS - 1)), pts.length - 1)],
        )
      : pts;
  return capped.map(({ index, timestamp }) => ({ index, timestamp }));
}

// Map rows → carousel artists, returned in the ORDER of `ids` (so the carousel's
// hero order is stable before it shuffles). Rows without a usable name are
// dropped; everything else is best-effort so a missing field never breaks a card.
export function mapIndexArtists(rows: ArtistHistoryRow[] | null | undefined, ids: string[]): IndexArtistDTO[] {
  if (!Array.isArray(rows)) return [];
  const byId = new Map<string, ArtistHistoryRow>();
  for (const r of rows) {
    const id = typeof r?.spotify_id === 'string' ? r.spotify_id : '';
    if (id && !byId.has(id)) byId.set(id, r);
  }
  const out: IndexArtistDTO[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) continue;
    const name = typeof r.artist_name === 'string' ? r.artist_name.trim() : '';
    if (!name) continue;
    out.push({
      name,
      image_url: typeof r.spotify_img === 'string' && r.spotify_img.trim() ? r.spotify_img : null,
      index_price: num(r.current_index_value),
      change_1m: num(r.change_1m),
      data_points: normalizeDataPoints(r.data_points),
    });
  }
  return out;
}
