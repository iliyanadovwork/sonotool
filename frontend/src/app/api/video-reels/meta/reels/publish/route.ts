import { NextRequest, NextResponse } from 'next/server';
import { getFreshMetaToken } from '@/lib/video-reels/meta-token-storage';
import { claimIdempotencyKey, completeIdempotencyKey, releaseIdempotencyKey } from '@/lib/video-reels/idempotency';
import { fetchWithTimeout, isAbortError } from '@/lib/video-reels/fetch-timeout';
import { isUnlocked } from '@/lib/video-reels/meta-unlock';

export const runtime = 'nodejs';
// The flow creates a container, polls up to ~5 minutes, then publishes — all in
// one request. Without this it would be killed at the platform default timeout,
// which both fails slow publishes AND drives the duplicate-Reel retries.
export const maxDuration = 300;

// Using graph.instagram.com for Instagram Login flow (not Facebook Login)
const GRAPH_HOST = 'https://graph.instagram.com';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';
const MAX_POLL_ATTEMPTS = 60; // ~5 minutes at 5s intervals
const POLL_INTERVAL = 5000; // 5 seconds

interface PublishRequest {
  caption?: string;
  shareToFeed?: boolean;
  videoUrl: string;
  idempotencyKey?: string;
}

interface PublishResponse {
  containerId: string;
  mediaId: string;
  permalink?: string;
}

/**
 * An Error carrying the diagnostic context the failure handler reports back
 * (attached at the throw site, read once in the route's catch block).
 */
interface PublishError extends Error {
  probe?: Record<string, unknown>;
  videoUrl?: string;
  containerId?: string;
  containerResponse?: unknown;
}

/**
 * Probe the video URL with a HEAD request so we can see what IG would see.
 * Returns a small diagnostic object; never throws — failures here are part of the diagnostic.
 */
async function probeVideoUrl(videoUrl: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetchWithTimeout(videoUrl, { method: 'HEAD', redirect: 'follow' }, 10000);
    const diag = {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      finalUrl: res.url,
      contentType: res.headers.get('content-type'),
      contentLength: res.headers.get('content-length'),
      acceptRanges: res.headers.get('accept-ranges'),
      cacheControl: res.headers.get('cache-control'),
    };
    console.log('[Reels Publish] Video URL probe:', JSON.stringify(diag));
    return diag;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '';
    const diag = { ok: false, error: message || String(err) };
    console.log('[Reels Publish] Video URL probe failed:', JSON.stringify(diag));
    return diag;
  }
}

/**
 * Step 1: Create a media container for the Instagram Reel
 * POST https://graph.instagram.com/{api-version}/{ig-user-id}/media
 */
async function createContainer(
  igUserId: string,
  videoUrl: string,
  caption: string,
  shareToFeed: boolean,
  igAccessToken: string
): Promise<string> {
  const url = new URL(`${GRAPH_HOST}/${GRAPH_VERSION}/${igUserId}/media`);
  url.searchParams.set('media_type', 'REELS');
  url.searchParams.set('video_url', videoUrl);
  if (caption) url.searchParams.set('caption', caption);
  url.searchParams.set('share_to_feed', shareToFeed ? 'true' : 'false');
  url.searchParams.set('access_token', igAccessToken);

  console.log('[Reels Publish] Step 1: Creating container...');
  console.log('[Reels Publish] URL:', url.toString().replace(igAccessToken, 'REDACTED'));

  const response = await fetchWithTimeout(url.toString(), { method: 'POST' }, 30000);

  if (!response.ok) {
    const error = await response.text();
    console.error('[Reels Publish] Container creation failed:', error);
    throw new Error(`Failed to create container: ${error}`);
  }

  const data = await response.json();

  if (data.error) {
    console.error('[Reels Publish] Container creation error:', data.error);
    throw new Error(`Container creation error: ${data.error.message || data.error.type || JSON.stringify(data.error)}`);
  }

  const containerId = data.id;
  console.log('[Reels Publish] Container created:', containerId);

  return containerId;
}

/**
 * Step 2: Poll the container status until it's FINISHED
 * GET https://graph.instagram.com/{container-id}?fields=status_code
 */
async function waitForContainerReady(
  containerId: string,
  igAccessToken: string
): Promise<void> {
  console.log('[Reels Publish] Step 2: Waiting for container to be ready...');

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const url = new URL(`${GRAPH_HOST}/${GRAPH_VERSION}/${containerId}`);
    url.searchParams.set('fields', 'status_code,status');
    url.searchParams.set('access_token', igAccessToken);

    const response = await fetchWithTimeout(url.toString(), {}, 15000);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to check container status: ${error}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(`Status check error: ${data.error.message || data.error.type || JSON.stringify(data.error)}`);
    }

    const statusCode = data.status_code;
    console.log(`[Reels Publish] Container status: ${statusCode} (attempt ${attempt + 1}/${MAX_POLL_ATTEMPTS})`);

    if (statusCode === 'FINISHED') {
      console.log('[Reels Publish] Container is ready!');
      return;
    }

    if (statusCode === 'ERROR') {
      console.error('[Reels Publish] Container failed - full response:', JSON.stringify(data, null, 2));
      const detail = data.status || data.status_code || 'Unknown error';
      const err: PublishError = new Error(`Container processing failed: ${detail}`);
      err.containerResponse = data;
      throw err;
    }

    if (statusCode === 'EXPIRED') {
      throw new Error('Container has expired. Please try uploading again.');
    }

    // Still processing - wait before polling again
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }

  throw new Error('Container processing timed out. Please try again.');
}

/**
 * Step 3: Publish the container to Instagram
 * POST https://graph.instagram.com/{ig-user-id}/media_publish
 */
async function publishContainer(
  igUserId: string,
  containerId: string,
  igAccessToken: string
): Promise<string> {
  const url = new URL(`${GRAPH_HOST}/${GRAPH_VERSION}/${igUserId}/media_publish`);
  url.searchParams.set('creation_id', containerId);
  url.searchParams.set('access_token', igAccessToken);

  console.log('[Reels Publish] Step 3: Publishing container...');

  const response = await fetchWithTimeout(url.toString(), { method: 'POST' }, 30000);

  if (!response.ok) {
    const error = await response.text();
    console.error('[Reels Publish] Publish failed:', error);
    throw new Error(`Failed to publish: ${error}`);
  }

  const data = await response.json();

  if (data.error) {
    console.error('[Reels Publish] Publish error:', data.error);
    throw new Error(`Publish error: ${data.error.message || data.error.type || JSON.stringify(data.error)}`);
  }

  const mediaId = data.id;
  console.log('[Reels Publish] Published successfully! Media ID:', mediaId);

  return mediaId;
}

/**
 * Step 4: Get the permalink for the published media
 * GET https://graph.instagram.com/{api-version}/{media-id}?fields=permalink&access_token={access-token}
 */
async function getPermalink(mediaId: string, igAccessToken: string): Promise<string | null> {
  // Best-effort and MUST NOT throw: this runs AFTER media_publish already
  // succeeded (the Reel is live). A throw here would skip completeIdempotencyKey
  // and release the claim, letting a retry publish a duplicate. So any failure —
  // including the 15s timeout's AbortError — degrades to a null permalink.
  try {
    const url = new URL(`${GRAPH_HOST}/${GRAPH_VERSION}/${mediaId}`);
    url.searchParams.set('fields', 'permalink');
    url.searchParams.set('access_token', igAccessToken);

    console.log('[Reels Publish] Step 4: Fetching permalink...');

    const response = await fetchWithTimeout(url.toString(), {}, 15000);

    if (!response.ok) {
      const error = await response.text();
      console.error('[Reels Publish] Permalink fetch failed:', error);
      return null;
    }

    const data = await response.json();
    const permalink = data.permalink;
    console.log('[Reels Publish] Permalink:', permalink);

    return permalink || null;
  } catch (err) {
    console.error('[Reels Publish] Permalink fetch threw (post-publish, non-fatal):', err);
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
  // Hoisted so the catch block can release the idempotency claim on failure.
  let idempotencyKey: string | undefined;
  try {
    // Get the stored Instagram user access token, auto-refreshing it if it's
    // near expiry so a long-idle account can still publish without reconnecting.
    const account = await getFreshMetaToken();
    const igUserId = account?.igUserId;
    const igAccessToken = account?.userAccessToken;

    if (!igUserId || !igAccessToken) {
      return NextResponse.json(
        { error: 'No Instagram account connected. Please connect your account first.' },
        { status: 401 }
      );
    }

    const body = await request.json() as PublishRequest;

    const { caption = '', shareToFeed = false, videoUrl } = body;
    idempotencyKey = body.idempotencyKey;

    if (!videoUrl) {
      return NextResponse.json(
        { error: 'videoUrl is required' },
        { status: 400 }
      );
    }

    // Exactly-once guard: claim the key before any work. A retry or platform
    // replay of the same key returns the prior result (or a 409 while still
    // publishing) instead of creating a second Reel.
    if (idempotencyKey) {
      const claim = await claimIdempotencyKey(idempotencyKey);
      if (claim.state === 'done') {
        console.log('[Reels Publish] Idempotent replay — returning cached result');
        return NextResponse.json(claim.result);
      }
      if (claim.state === 'in_progress') {
        return NextResponse.json(
          { error: 'This video is already being published. Please wait a moment.' },
          { status: 409 }
        );
      }
      // 'claimed' or 'disabled' → proceed with the publish.
    }

    console.log('[Reels Publish] Starting publish workflow...');
    console.log('[Reels Publish] IG User ID:', igUserId);
    console.log('[Reels Publish] Video URL:', videoUrl);
    console.log('[Reels Publish] Caption:', caption.substring(0, 50) + (caption.length > 50 ? '...' : ''));
    console.log('[Reels Publish] Share to feed:', shareToFeed);

    // Step 0: Probe the video URL the way IG would, so we can diagnose blob/CDN issues
    const probe = await probeVideoUrl(videoUrl);

    // Step 1: Create container
    let containerId: string;
    try {
      containerId = await createContainer(
        igUserId,
        videoUrl,
        caption,
        shareToFeed,
        igAccessToken
      );
    } catch (err: unknown) {
      const e = err as PublishError;
      e.probe = probe;
      e.videoUrl = videoUrl;
      throw e;
    }

    // Step 2: Wait for container to be ready
    try {
      await waitForContainerReady(containerId, igAccessToken);
    } catch (err: unknown) {
      const e = err as PublishError;
      e.probe = probe;
      e.videoUrl = videoUrl;
      e.containerId = containerId;
      throw e;
    }

    // Step 3: Publish the reel
    const mediaId = await publishContainer(igUserId, containerId, igAccessToken);

    // Step 4: Get the permalink
    const permalink = await getPermalink(mediaId, igAccessToken);

    const result: PublishResponse = {
      containerId,
      mediaId,
      permalink: permalink ?? undefined,
    };

    if (idempotencyKey) await completeIdempotencyKey(idempotencyKey, result);

    return NextResponse.json(result);
  } catch (error: unknown) {
    // Diagnostics (probe/videoUrl/containerId/containerResponse) are only ever
    // attached to Error instances thrown above, so read them off that shape.
    const err: PublishError | null = error instanceof Error ? (error as PublishError) : null;
    console.error('[Reels Publish] Error:', err?.message || error);

    // Publishing failed before completion — release the claim so a legitimate
    // retry isn't permanently blocked. (No code path reaches here after a
    // successful media_publish, so this can't wipe a real success.)
    if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey);

    // A per-call timeout surfaces as an AbortError → treat as a gateway timeout.
    if (isAbortError(error)) {
      return NextResponse.json(
        { error: 'Instagram took too long to respond. Please try again.' },
        { status: 504 }
      );
    }

    const errorMessage = err?.message || String(error ?? '');

    // Check for rate limit/quota errors FIRST (before checking for auth errors)
    if (errorMessage.toLowerCase().includes('rate limit') ||
        errorMessage.toLowerCase().includes('quota') ||
        errorMessage.toLowerCase().includes('limit exceeded') ||
        errorMessage.includes('Application request limit') ||
        errorMessage.includes('#4') || // Rate limit error code
        errorMessage.includes('2001') || // App rate limit error code for Instagram
        errorMessage.includes('feed_application_block')) { // Rate limit blocking
      return NextResponse.json(
        { error: 'You have reached Instagram\'s daily upload limit (50 reels per 24 hours). Please wait before uploading more.' },
        { status: 429 }
      );
    }

    // Check for authentication errors (more specific check)
    if (errorMessage.includes('Invalid OAuth') ||
        errorMessage.includes('190') || // OAuth error code
        errorMessage.includes('Invalid access token') ||
        errorMessage.includes('Not authorized') ||
        errorMessage.includes('Authentication required')) {
      return NextResponse.json(
        { error: 'Authentication failed. Please reconnect your Instagram account.' },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        error: err?.message || 'Failed to publish reel',
        diagnostic: {
          videoUrl: err?.videoUrl,
          probe: err?.probe,
          containerId: err?.containerId,
          containerResponse: err?.containerResponse,
        },
      },
      { status: 500 }
    );
  }
}
