import { NextRequest, NextResponse } from 'next/server';
import { getMetaTokenForAccount } from '@/lib/video-reels/meta-token-storage';
import { fetchWithTimeout, isAbortError } from '@/lib/video-reels/fetch-timeout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Recent REELS for a specific IG page + per-reel analytics, for the "View more"
// detail view. Reads the account by ?igUserId= (all tokens live in the multi-
// account store), so it never changes the active posting account. VIEWING action:
// intentionally NOT isUnlocked-gated (mirrors meta/insights + meta/me).
//
// likes/comments come from the media node itself (no insights scope needed);
// views/reach are per-media insights that need instagram_business_manage_insights
// and degrade to null per-reel when unavailable.

const GRAPH_HOST = 'https://graph.instagram.com';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';
const UPSTREAM_TIMEOUT_MS = 12000;

/** The bits of a Graph API JSON body this route reads. */
interface GraphError {
  message?: string;
  code?: number;
  type?: string;
}

interface GraphJson {
  error?: GraphError;
  data?: unknown;
  paging?: { cursors?: { after?: string | null } };
}

interface GraphResult {
  ok: boolean;
  status: number;
  json: GraphJson;
}

/** GET a Graph endpoint; never logs the token. Throws only on network/abort. */
async function graphGet(path: string, params: Record<string, string>): Promise<GraphResult> {
  const url = new URL(`${GRAPH_HOST}/${GRAPH_VERSION}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetchWithTimeout(url.toString(), {}, UPSTREAM_TIMEOUT_MS);
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && !json?.error, status: res.status, json };
}

function isPermissionError(json: GraphJson): boolean {
  const err = json?.error;
  if (!err) return false;
  const msg = String(err.message || '');
  return err.code === 10 || err.code === 200 || /permission|scope|requires|insights/i.test(msg);
}

function isTokenError(json: GraphJson): boolean {
  const err = json?.error;
  if (!err) return false;
  return err.code === 190 || /invalid (oauth|access token)|expired|session has/i.test(String(err.message || ''));
}

/** One row of an insights response (`data[i]`), in either supported shape. */
interface InsightEntry {
  name?: string;
  total_value?: { value?: number };
  values?: Array<{ value?: number }>;
}

/**
 * Map an insights response to { metricName: number|null }. Accepts BOTH the
 * metric_type=total_value shape (data[i].total_value.value) and the legacy
 * time-series shape (data[i].values[0].value) so a metric that ignores
 * total_value isn't silently dropped.
 */
function readInsightValues(json: GraphJson): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  const data: InsightEntry[] = Array.isArray(json?.data) ? (json.data as InsightEntry[]) : [];
  for (const entry of data) {
    if (!entry?.name) continue;
    const tv = entry?.total_value?.value;
    if (typeof tv === 'number') {
      out[entry.name] = tv;
      continue;
    }
    const legacy = Array.isArray(entry?.values) && entry.values.length ? entry.values[entry.values.length - 1]?.value : undefined;
    out[entry.name] = typeof legacy === 'number' ? legacy : null;
  }
  return out;
}

/** One media node as returned by `{ig-user-id}/media` for the fields we request. */
interface MediaNode {
  id: string;
  media_type?: string;
  media_product_type?: string;
  caption?: string | null;
  permalink?: string | null;
  thumbnail_url?: string | null;
  media_url?: string | null;
  timestamp?: string | null;
  like_count?: number;
  comments_count?: number;
  username?: string;
}

interface ReelOut {
  id: string;
  permalink: string | null;
  caption: string | null;
  timestamp: string | null;
  thumbnailUrl: string | null;
  mediaUrl: string | null;
  likes: number | null;
  comments: number | null;
  metrics: {
    views: number | null;
    reach: number | null;
    saved: number | null;
    shares: number | null;
    totalInteractions: number | null;
    avgWatchTimeMs: number | null;
    totalWatchTimeMs: number | null;
  };
}

export async function GET(request: NextRequest) {
  try {
    const igUserIdParam = request.nextUrl.searchParams.get('igUserId');
    // Read-only (no refresh-write) — see the note in meta/insights/route.ts.
    const account = await getMetaTokenForAccount(igUserIdParam || undefined);
    if (!account?.igUserId || !account?.userAccessToken) {
      return NextResponse.json(
        { error: 'No Instagram account connected. Please connect your account first.' },
        { status: 401 },
      );
    }
    const igUserId = account.igUserId;
    const token = account.userAccessToken;

    const limitRaw = parseInt(request.nextUrl.searchParams.get('limit') || '12', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(30, Math.max(1, limitRaw)) : 12;
    const after = request.nextUrl.searchParams.get('after') || '';

    // ---- List media (hard-fail). There's no server-side reels filter, so
    // over-fetch (50) and filter to REELS, then slice to `limit`.
    let mediaRes: GraphResult;
    try {
      mediaRes = await graphGet(`${igUserId}/media`, {
        fields:
          'id,media_type,media_product_type,caption,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count,username',
        limit: '50',
        ...(after ? { after } : {}),
        access_token: token,
      });
    } catch (err) {
      if (isAbortError(err)) {
        return NextResponse.json({ error: 'Upstream timed out. Please try again.' }, { status: 504 });
      }
      return NextResponse.json({ error: 'Failed to load reels.' }, { status: 502 });
    }
    if (!mediaRes.ok) {
      if (isTokenError(mediaRes.json)) {
        return NextResponse.json(
          { error: 'Instagram session expired. Reconnect the account.', needsReconnect: true },
          { status: 401 },
        );
      }
      return NextResponse.json(
        { error: mediaRes.json?.error?.message || 'Failed to load reels.' },
        { status: 502 },
      );
    }

    const items: MediaNode[] = Array.isArray(mediaRes.json?.data) ? (mediaRes.json.data as MediaNode[]) : [];
    const reels = items.filter((m) => m?.media_product_type === 'REELS').slice(0, limit);
    const afterCursor = mediaRes.json?.paging?.cursors?.after ?? null;
    const warnings: string[] = [];

    // ---- Per-reel insights, one Promise.allSettled batch; each reel degrades
    // independently. likes/comments come from the media node so they always show.
    const settled = await Promise.allSettled(
      reels.map((reel) =>
        graphGet(`${reel.id}/insights`, {
          // Only the reels metrics the UI shows/uses. Watch-time metrics are left
          // out of v1 to keep the per-reel call from erroring on an unsupported
          // metric (they'd null the whole reel's metrics if bundled).
          metric: 'views,reach,saved,shares,total_interactions',
          metric_type: 'total_value',
          access_token: token,
        }),
      ),
    );

    const out: ReelOut[] = reels.map((reel, i) => {
      const metrics: ReelOut['metrics'] = {
        views: null,
        reach: null,
        saved: null,
        shares: null,
        totalInteractions: null,
        avgWatchTimeMs: null,
        totalWatchTimeMs: null,
      };
      const r = settled[i];
      if (r.status === 'fulfilled' && r.value.ok) {
        const v = readInsightValues(r.value.json);
        metrics.views = v.views ?? null;
        metrics.reach = v.reach ?? null;
        metrics.saved = v.saved ?? null;
        metrics.shares = v.shares ?? null;
        metrics.totalInteractions = v.total_interactions ?? null;
      } else if (r.status === 'fulfilled' && isPermissionError(r.value.json)) {
        warnings.push('needsInsightsScope');
      }
      return {
        id: String(reel.id),
        permalink: reel.permalink ?? null,
        caption: typeof reel.caption === 'string' ? reel.caption : null,
        timestamp: reel.timestamp ?? null,
        thumbnailUrl: reel.thumbnail_url ?? reel.media_url ?? null,
        mediaUrl: reel.media_url ?? null,
        likes: typeof reel.like_count === 'number' ? reel.like_count : null,
        comments: typeof reel.comments_count === 'number' ? reel.comments_count : null,
        metrics,
      };
    });

    return NextResponse.json({
      account: { igUserId, username: account.igUsername ?? null },
      reels: out,
      paging: { after: afterCursor },
      warnings: Array.from(new Set(warnings)),
    });
  } catch (error: unknown) {
    if (isAbortError(error)) {
      return NextResponse.json({ error: 'Upstream timed out. Please try again.' }, { status: 504 });
    }
    const message = error instanceof Error ? error.message : '';
    return NextResponse.json({ error: message || 'Failed to load reels' }, { status: 500 });
  }
}
