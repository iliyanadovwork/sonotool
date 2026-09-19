import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

interface SerpImage {
  original?: string;
  thumbnail?: string;
  title?: string;
  source?: string;
}
type Photo = { url: string; thumbnail: string; title?: string };

// SerpAPI returns up to ~100 images per "ijn" page (often fewer). We cache each mapped
// page so repeat searches (and paging within already-fetched pages) cost zero credits.
// Non-empty pages are cached for 30 days; EMPTY pages only briefly, so a transient
// SerpAPI hiccup (or the page just past the end of results) can't poison a query for
// weeks but also isn't re-fetched on every click. Cache lives in sonotooldev.
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EMPTY_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_PAGE = 9; // SerpAPI ijn safety cap (~1000 images)

type Db = ReturnType<typeof admin>;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
}

async function fetchSerpPage(query: string, page: number): Promise<Photo[]> {
  const key = process.env.SERPAPI_KEY ?? '';
  if (!key) throw new Error('SERPAPI_KEY not set');

  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google_images');
  url.searchParams.set('q', query);
  url.searchParams.set('api_key', key);
  url.searchParams.set('ijn', String(page));

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`serpapi ${res.status}: ${await res.text()}`);
  const json = await res.json() as { images_results?: SerpImage[]; error?: string };
  if (json.error) throw new Error(`serpapi: ${json.error}`);

  return (json.images_results ?? [])
    .filter(i => i.original)
    .map(i => ({ url: i.original!, thumbnail: i.thumbnail ?? i.original!, title: i.title }));
}

type PageResult = { images: Photo[]; state: 'hit' | 'miss' | 'stale' };

// Cache-first fetch of a single SerpAPI page. Throws only when SerpAPI fails AND there
// is no usable cached copy to fall back on.
async function getPage(db: Db, query: string, page: number): Promise<PageResult> {
  const cacheKey = `${query.trim().toLowerCase()}::${page}`;

  // 1. Cache hit (empty pages expire quickly so they can't poison the query)
  try {
    const { data } = await db
      .from('photo_search_cache')
      .select('results, updated_at')
      .eq('cache_key', cacheKey)
      .maybeSingle();
    if (data && Array.isArray(data.results)) {
      const age = Date.now() - new Date(data.updated_at).getTime();
      const ttl = data.results.length > 0 ? TTL_MS : EMPTY_TTL_MS;
      if (age < ttl) return { images: data.results as Photo[], state: 'hit' };
    }
  } catch { /* cache read is best-effort */ }

  // 2. Live fetch + store
  try {
    const images = await fetchSerpPage(query, page);
    try {
      await db.from('photo_search_cache').upsert({
        cache_key: cacheKey, results: images, updated_at: new Date().toISOString(),
      });
    } catch { /* cache write is best-effort */ }
    return { images, state: 'miss' };
  } catch (err) {
    // 3. SerpAPI failed -> serve a stale, non-empty cached page if we have one
    try {
      const { data } = await db
        .from('photo_search_cache')
        .select('results')
        .eq('cache_key', cacheKey)
        .maybeSingle();
      if (data && Array.isArray(data.results) && data.results.length > 0) {
        return { images: data.results as Photo[], state: 'stale' };
      }
    } catch { /* ignore */ }
    throw err;
  }
}

export async function POST(req: NextRequest) {
  try {
    const Schema = z.object({
      query: z.string().min(1),
      count: z.number().int().min(1).max(50).default(9),
      offset: z.number().int().min(0).default(0),
    });
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'query required' }, { status: 400 });
    const { query, count, offset } = parsed.data;

    const db = admin();
    const need = offset + count;

    // Accumulate images across SerpAPI pages until we can satisfy [offset, offset+count).
    // Pages are often shorter than PAGE_SIZE, so we cannot assume a fixed page width —
    // we keep pulling (cache-first) pages until we have enough or hit the end of results.
    const all: Photo[] = [];
    let state: 'hit' | 'miss' | 'stale' = 'hit';
    let firstErr: unknown = null;
    for (let page = 0; all.length < need && page <= MAX_PAGE; page++) {
      let res: PageResult;
      try {
        res = await getPage(db, query, page);
      } catch (err) {
        firstErr = err;
        break;
      }
      if (res.state === 'stale') state = 'stale';
      else if (res.state === 'miss' && state !== 'stale') state = 'miss';
      all.push(...res.images);
      // Pages are commonly shorter than PAGE_SIZE while MORE pages still exist, so a
      // short page is NOT the end — only a truly empty page means no more results.
      if (res.images.length === 0) break;
    }

    // Only a hard failure with zero data should surface an error.
    if (all.length === 0 && firstErr) throw firstErr;

    const slice = all.slice(offset, offset + count);
    return NextResponse.json(slice, { headers: { 'X-Cache': state } });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
