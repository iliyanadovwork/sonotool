import { NextRequest, NextResponse } from 'next/server';
import { getFreshMetaToken } from '@/lib/video-reels/meta-token-storage';
import { claimIdempotencyKey, completeIdempotencyKey, releaseIdempotencyKey } from '@/lib/video-reels/idempotency';
import { fetchWithTimeout, isAbortError } from '@/lib/video-reels/fetch-timeout';
import { isUnlocked } from '@/lib/video-reels/meta-unlock';

export const runtime = 'nodejs';
// One request creates every child container, polls each to FINISHED, builds the carousel
// parent, polls it, then publishes — so it must outlive the platform default timeout.
// Note: a carousel of several long videos could still approach this ceiling.
export const maxDuration = 300;

// Instagram API with Instagram Login → graph.instagram.com (the same connection Video Reels uses).
const GRAPH_HOST = 'https://graph.instagram.com';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';
const MAX_POLL_ATTEMPTS = 60; // ~5 minutes at 5s intervals
const POLL_INTERVAL = 5000;   // 5 seconds
const MAX_ITEMS = 10;         // IG carousels are limited to 10 items

type ItemKind = 'image' | 'video';
interface PublishItem { kind: ItemKind; url: string }
interface PublishRequest {
  items: PublishItem[];
  caption?: string;
  idempotencyKey?: string;
}
interface PublishResponse {
  mediaId: string;
  permalink?: string;
}

function redact(url: string, token: string): string {
  return url.replace(token, 'REDACTED');
}

/** HEAD-probe a media URL the way IG would, for diagnostics. Never throws. */
async function probeUrl(url: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetchWithTimeout(url, { method: 'HEAD', redirect: 'follow' }, 10000);
    return {
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get('content-type'),
      contentLength: res.headers.get('content-length'),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * POST /{ig-user-id}/media with arbitrary params → returns the new container id.
 * Throws an Error (with a `.graph` payload) on any Graph error.
 */
async function createContainer(
  igUserId: string,
  params: Record<string, string>,
  token: string,
): Promise<string> {
  const url = new URL(`${GRAPH_HOST}/${GRAPH_VERSION}/${igUserId}/media`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('access_token', token);

  console.log('[Posts Publish] Create container:', redact(url.toString(), token));
  const res = await fetchWithTimeout(url.toString(), { method: 'POST' }, 30000);
  const text = await res.text();
  let data: { id?: string; error?: { message?: string; type?: string } } & Record<string, unknown>;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok || data?.error) {
    const msg = data?.error?.message || data?.error?.type || text || `HTTP ${res.status}`;
    const err = new Error(msg) as Error & { graph?: unknown };
    err.graph = data?.error ?? data;
    throw err;
  }
  if (!data.id) throw new Error('Graph returned no container id');
  return data.id;
}

/** Image carousel child: image_url + is_carousel_item, no media_type (images omit it). */
function createImageChild(igUserId: string, imageUrl: string, token: string): Promise<string> {
  return createContainer(igUserId, { image_url: imageUrl, is_carousel_item: 'true' }, token);
}

/**
 * Video carousel child. The media_type for a carousel video item is officially ambiguous
 * (Meta's example sends media_type=VIDEO; the enum list omits it — never REELS for a child).
 * Try VIDEO first; if it's rejected as an unsupported media_type, retry with none.
 */
async function createVideoChild(igUserId: string, videoUrl: string, token: string): Promise<string> {
  try {
    return await createContainer(igUserId, { video_url: videoUrl, media_type: 'VIDEO', is_carousel_item: 'true' }, token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (/media_type/i.test(msg)) {
      console.warn('[Posts Publish] media_type=VIDEO rejected for carousel child — retrying without media_type');
      return createContainer(igUserId, { video_url: videoUrl, is_carousel_item: 'true' }, token);
    }
    throw err;
  }
}

/** Single (non-carousel) image post. */
function createSingleImage(igUserId: string, imageUrl: string, caption: string, token: string): Promise<string> {
  const params: Record<string, string> = { image_url: imageUrl };
  if (caption) params.caption = caption;
  return createContainer(igUserId, params, token);
}

/** Single (non-carousel) video → a Reel. */
function createSingleReel(igUserId: string, videoUrl: string, caption: string, token: string): Promise<string> {
  const params: Record<string, string> = { video_url: videoUrl, media_type: 'REELS', share_to_feed: 'true' };
  if (caption) params.caption = caption;
  return createContainer(igUserId, params, token);
}

/** Parent CAROUSEL container; caption lives here, children in display order. */
function createCarouselParent(igUserId: string, childIds: string[], caption: string, token: string): Promise<string> {
  const params: Record<string, string> = { media_type: 'CAROUSEL', children: childIds.join(',') };
  if (caption) params.caption = caption;
  return createContainer(igUserId, params, token);
}

/** Poll a container's status_code until FINISHED (or ERROR/EXPIRED/timeout). */
async function pollContainer(containerId: string, token: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const url = new URL(`${GRAPH_HOST}/${GRAPH_VERSION}/${containerId}`);
    url.searchParams.set('fields', 'status_code,status');
    url.searchParams.set('access_token', token);

    const res = await fetchWithTimeout(url.toString(), {}, 15000);
    const text = await res.text();
    let data: { status_code?: string; status?: string; error?: { message?: string; type?: string } };
    try { data = JSON.parse(text); } catch { data = {}; }

    if (!res.ok || data?.error) {
      throw new Error(`Status check failed: ${data?.error?.message || text || `HTTP ${res.status}`}`);
    }

    const status = data.status_code;
    console.log(`[Posts Publish] Container ${containerId} status: ${status} (${attempt + 1}/${MAX_POLL_ATTEMPTS})`);

    if (status === 'FINISHED') return;
    if (status === 'ERROR') {
      const err = new Error(`Container processing failed: ${data.status || 'Unknown error'}`) as Error & { graph?: unknown };
      err.graph = data;
      throw err;
    }
    if (status === 'EXPIRED') throw new Error('Container expired before publishing. Please try again.');

    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
  throw new Error('Container processing timed out. Please try again.');
}

/** Publish a finished container → returns the published media id. */
async function publishContainer(igUserId: string, creationId: string, token: string): Promise<string> {
  const url = new URL(`${GRAPH_HOST}/${GRAPH_VERSION}/${igUserId}/media_publish`);
  url.searchParams.set('creation_id', creationId);
  url.searchParams.set('access_token', token);

  const res = await fetchWithTimeout(url.toString(), { method: 'POST' }, 30000);
  const text = await res.text();
  let data: { id?: string; error?: { message?: string; type?: string } };
  try { data = JSON.parse(text); } catch { data = {}; }

  if (!res.ok || data?.error) {
    throw new Error(`Publish failed: ${data?.error?.message || text || `HTTP ${res.status}`}`);
  }
  if (!data.id) throw new Error('Publish returned no media id');
  return data.id;
}

/** Best-effort permalink fetch (never throws). */
async function getPermalink(mediaId: string, token: string): Promise<string | null> {
  try {
    const url = new URL(`${GRAPH_HOST}/${GRAPH_VERSION}/${mediaId}`);
    url.searchParams.set('fields', 'permalink');
    url.searchParams.set('access_token', token);
    const res = await fetchWithTimeout(url.toString(), {}, 15000);
    if (!res.ok) return null;
    const data = await res.json();
    return data.permalink || null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  if (!(await isUnlocked())) {
    return NextResponse.json(
      { error: 'Enter the team password to publish to Instagram.', locked: true },
      { status: 403 },
    );
  }
  let idempotencyKey: string | undefined;
  try {
    // Auto-refreshes the long-lived token when near expiry (shared with Video Reels).
    const account = await getFreshMetaToken();
    const igUserId = account?.igUserId;
    const token = account?.userAccessToken;
    if (!igUserId || !token) {
      return NextResponse.json(
        { error: 'No Instagram account connected. Please connect your account first.' },
        { status: 401 },
      );
    }

    const body = await request.json() as PublishRequest;
    const caption = body.caption ?? '';
    idempotencyKey = body.idempotencyKey;
    const items = Array.isArray(body.items) ? body.items : [];

    // Validate the item list.
    if (items.length === 0) {
      return NextResponse.json({ error: 'No slides to publish.' }, { status: 400 });
    }
    if (items.length > MAX_ITEMS) {
      return NextResponse.json(
        { error: `Instagram carousels support at most ${MAX_ITEMS} slides (this post has ${items.length}).` },
        { status: 400 },
      );
    }
    for (const it of items) {
      if (!it || (it.kind !== 'image' && it.kind !== 'video') || typeof it.url !== 'string' || !it.url) {
        return NextResponse.json({ error: 'Each slide must have a kind ("image"|"video") and a url.' }, { status: 400 });
      }
    }

    // Exactly-once guard: a retry/replay of the same key returns the prior result
    // (or 409 while still in flight) instead of double-posting.
    if (idempotencyKey) {
      const claim = await claimIdempotencyKey(idempotencyKey);
      if (claim.state === 'done') {
        console.log('[Posts Publish] Idempotent replay — returning cached result');
        return NextResponse.json(claim.result);
      }
      if (claim.state === 'in_progress') {
        return NextResponse.json(
          { error: 'This post is already being published. Please wait a moment.' },
          { status: 409 },
        );
      }
    }

    console.log(`[Posts Publish] Publishing ${items.length} item(s) for IG user ${igUserId}`);
    const probes = await Promise.all(items.map(it => probeUrl(it.url)));
    console.log('[Posts Publish] URL probes:', JSON.stringify(probes));

    let mediaId: string;

    if (items.length === 1) {
      // Single slide → a normal image post or a Reel (a carousel needs ≥2 items).
      const it = items[0];
      const containerId = it.kind === 'video'
        ? await createSingleReel(igUserId, it.url, caption, token)
        : await createSingleImage(igUserId, it.url, caption, token);
      await pollContainer(containerId, token);
      mediaId = await publishContainer(igUserId, containerId, token);
    } else {
      // Carousel: child container per slide → poll each → CAROUSEL parent → poll → publish.
      const childIds: string[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        console.log(`[Posts Publish] Creating ${it.kind} child ${i + 1}/${items.length}`);
        childIds.push(it.kind === 'video'
          ? await createVideoChild(igUserId, it.url, token)
          : await createImageChild(igUserId, it.url, token));
      }
      // Video children transcode asynchronously; every child must reach FINISHED first.
      for (const id of childIds) await pollContainer(id, token);

      const parentId = await createCarouselParent(igUserId, childIds, caption, token);
      await pollContainer(parentId, token);
      mediaId = await publishContainer(igUserId, parentId, token);
    }

    const permalink = await getPermalink(mediaId, token);
    const result: PublishResponse = { mediaId, permalink: permalink ?? undefined };

    if (idempotencyKey) await completeIdempotencyKey(idempotencyKey, result);
    console.log('[Posts Publish] Published! Media ID:', mediaId);
    return NextResponse.json(result);
  } catch (error) {
    const err = error as Error & { graph?: unknown };
    console.error('[Posts Publish] Error:', err?.message || error);

    // Release the claim so a legitimate retry isn't blocked (no path reaches here
    // after a successful media_publish, so this can't wipe a real success).
    if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey);

    // A per-call timeout surfaces as an AbortError → treat as a gateway timeout.
    if (isAbortError(error)) {
      return NextResponse.json(
        { error: 'Instagram took too long to respond. Please try again.' },
        { status: 504 },
      );
    }

    const msg = err?.message || '';
    const low = msg.toLowerCase();

    if (low.includes('rate limit') || low.includes('quota') || low.includes('limit exceeded') ||
        msg.includes('Application request limit') || msg.includes('#4') || msg.includes('2001')) {
      return NextResponse.json(
        { error: 'You have reached Instagram\'s publishing limit (50 posts per 24 hours). Please wait before posting more.' },
        { status: 429 },
      );
    }
    if (msg.includes('Invalid OAuth') || msg.includes('190') || msg.includes('Invalid access token') ||
        msg.includes('Not authorized') || msg.includes('Authentication required')) {
      return NextResponse.json(
        { error: 'Authentication failed. Please reconnect your Instagram account.' },
        { status: 401 },
      );
    }

    return NextResponse.json(
      { error: err?.message || 'Failed to publish post', diagnostic: { graph: err?.graph } },
      { status: 500 },
    );
  }
}
