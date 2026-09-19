import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// Generative expand can take several seconds; allow the function to hold the connection.
export const maxDuration = 60;

// BRIA "Image Expansion" (generative outpaint). Built to the documented contract
// (docs.bria.ai → Image Editing → Expand): native field `image` (URL/base64) + flag `sync`,
// header `api_token`, response `result.image_url`. VERIFY the path/fields against your live
// BRIA dashboard if a call fails — the response parsing below is intentionally tolerant.
const BRIA_EXPAND_URL = 'https://engine.prod.bria-api.com/v2/image/edit/expand';

// Pixel-placement expand: BRIA outpaints the source image to fill `canvasSize`, with the
// original placed at `originalImageLocation` (top-left, px) at `originalImageSize` — i.e. it
// fills the gap between the image's current spot on the slide and the rest of the canvas.
const Pair = z.tuple([z.number(), z.number()]);
const Schema = z.object({
  imageUrl: z.string().url(),
  canvasSize: Pair,
  originalImageSize: Pair,
  originalImageLocation: Pair,
  seed: z.number().int().optional(),
  prompt: z.string().optional(),
});

type BriaResp = {
  result?: { image_url?: string; seed?: number; prompt?: string };
  result_url?: string;
  image_url?: string;
  urls?: string[];
  status_url?: string;
  status?: string;
  request_id?: string;
  error?: { message?: string } | string;
};

function extractImageUrl(j: BriaResp | null): string | null {
  if (!j) return null;
  return j.result?.image_url ?? j.result_url ?? j.image_url ?? (Array.isArray(j.urls) ? j.urls[0] ?? null : null) ?? null;
}
function briaError(j: BriaResp | null, fallback: string): string {
  const e = j?.error;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && e.message) return e.message;
  return fallback;
}

export async function POST(req: NextRequest) {
  try {
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'imageUrl, canvasSize, originalImageSize, originalImageLocation are required' }, { status: 400 });
    }
    const { imageUrl, canvasSize, originalImageSize, originalImageLocation, seed, prompt } = parsed.data;

    const token = process.env.BRIA_API_TOKEN ?? '';
    if (!token) return NextResponse.json({ error: 'BRIA_API_TOKEN not set' }, { status: 500 });

    const body: Record<string, unknown> = {
      image: imageUrl,                                       // BRIA fetches our public post-images URL directly
      canvas_size: canvasSize.map(n => Math.round(n)),
      original_image_size: originalImageSize.map(n => Math.round(n)),
      original_image_location: originalImageLocation.map(n => Math.round(n)),
      sync: true,                                            // return result.image_url inline (HTTP 200)
    };
    if (seed != null) body.seed = seed;
    if (prompt) body.prompt = prompt;

    const res = await fetch(BRIA_EXPAND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', api_token: token },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: BriaResp | null = null;
    try { json = JSON.parse(text) as BriaResp; } catch { /* non-JSON body */ }

    if (res.status === 429) return NextResponse.json({ error: 'BRIA rate limit reached — wait a moment and try again.' }, { status: 429 });
    if (!res.ok && res.status !== 202) {
      return NextResponse.json({ error: briaError(json, `BRIA ${res.status}: ${text.slice(0, 300)}`) }, { status: 502 });
    }

    let url = extractImageUrl(json);

    // Async fallback: if sync didn't return the image inline, poll the status URL (bounded).
    if (!url && json?.status_url) {
      const statusUrl = json.status_url;
      const deadline = Date.now() + 50_000;
      while (!url && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2000));
        const sres = await fetch(statusUrl, { headers: { api_token: token } });
        const stext = await sres.text();
        let sjson: BriaResp | null = null;
        try { sjson = JSON.parse(stext) as BriaResp; } catch { /* ignore */ }
        const status = (sjson?.status ?? '').toString().toUpperCase();
        if (status === 'FAILED' || status === 'ERROR') {
          return NextResponse.json({ error: briaError(sjson, 'BRIA expand failed') }, { status: 502 });
        }
        url = extractImageUrl(sjson);
      }
    }

    if (!url) return NextResponse.json({ error: 'BRIA returned no image (timed out or unexpected response).' }, { status: 504 });

    // Fetch the result server-side and return the bytes. BRIA's result URL is not guaranteed to
    // be CORS-accessible from the browser, so proxying here lets the client read it same-origin
    // and re-host it in our post-images bucket (CORS-safe for canvas draw + export).
    const imgRes = await fetch(url);
    if (!imgRes.ok) return NextResponse.json({ error: `Failed to fetch BRIA result (${imgRes.status}).` }, { status: 502 });
    const buf = await imgRes.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: { 'Content-Type': imgRes.headers.get('content-type') || 'image/png', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
