import { NextRequest, NextResponse } from 'next/server';
import { getFreshMetaToken, getMetaTokenForAccount } from '@/lib/video-reels/meta-token-storage';
import { fetchWithTimeout, isAbortError } from '@/lib/video-reels/fetch-timeout';
import { graphTimestampToEpoch, computeResetAt } from '@/lib/video-reels/publish-reset';

export const runtime = 'nodejs';

const UPSTREAM_TIMEOUT_MS = 12000;
// The media call is a best-effort ADD-ON (it only supplies the reset time). Give it a
// much tighter budget than the required count call so a slow/throttled /media edge
// drops the reset time quickly instead of holding the ready count for the full 12s.
const MEDIA_TIMEOUT_MS = 4000;

/** The `error` envelope Graph returns on a failed call (fields are best-effort). */
interface GraphErrorBody {
  error?: { code?: number; message?: string; type?: string };
}

/** A Graph error that means the token itself is bad (expired/revoked) — mirrors insights/media. */
function isTokenError(json: unknown): boolean {
  const err = (json as GraphErrorBody | null | undefined)?.error;
  if (!err) return false;
  return err.code === 190 || /invalid (oauth|access token)|expired|session has/i.test(String(err.message || ''));
}

// content_publishing_limit gives the live usage COUNT for the rolling window but NO
// reset time (see lib/video-reels/publish-reset.ts). We derive the reset from the
// newest post's timestamp (/media edge) + the window length: newest + quota_duration.
export async function GET(request: NextRequest) {
  try {
    // Optional ?igUserId= selects a SPECIFIC connected account (the overview grid
    // fetches each tile's badge by id). Per-account is READ-ONLY so 4 concurrent
    // card fetches can't clobber each other's fresh token in the cookie; the
    // active-account path (no id — the 60s sidebar poll) keeps refreshing as before.
    const igUserIdParam = request.nextUrl.searchParams.get('igUserId');
    const account = igUserIdParam
      ? await getMetaTokenForAccount(igUserIdParam)
      : await getFreshMetaToken();
    const igUserId = account?.igUserId;
    const igAccessToken = account?.userAccessToken;

    if (!igUserId || !igAccessToken) {
      return NextResponse.json({ error: 'Not connected to Instagram' }, { status: 401 });
    }

    const graphVersion = process.env.META_GRAPH_VERSION || 'v22.0';

    const limitUrl = new URL(`https://graph.instagram.com/${graphVersion}/${igUserId}/content_publishing_limit`);
    limitUrl.searchParams.set('fields', 'config,quota_usage');
    limitUrl.searchParams.set('access_token', igAccessToken);

    // Newest posts (unfiltered — images/carousels/reels all consume the quota). We
    // only need the most recent post's timestamp; a few extra guard against a lead
    // item with a missing/unparseable timestamp.
    const mediaUrl = new URL(`https://graph.instagram.com/${graphVersion}/${igUserId}/media`);
    mediaUrl.searchParams.set('fields', 'timestamp');
    mediaUrl.searchParams.set('limit', '5');
    mediaUrl.searchParams.set('access_token', igAccessToken);

    // The limit call is the hard requirement; the media call is best-effort (a
    // failure just drops the reset time, never the count).
    const [limitRes, mediaRes] = await Promise.allSettled([
      fetchWithTimeout(limitUrl.toString(), {}, UPSTREAM_TIMEOUT_MS),
      fetchWithTimeout(mediaUrl.toString(), {}, MEDIA_TIMEOUT_MS),
    ]);

    // ----- content_publishing_limit (required) -----
    if (limitRes.status === 'rejected') {
      if (isAbortError(limitRes.reason)) {
        return NextResponse.json({ error: 'Upstream timed out. Please try again.' }, { status: 504 });
      }
      throw limitRes.reason;
    }
    const limitData = await limitRes.value.json().catch(() => ({}));
    if (!limitRes.value.ok || limitData?.error) {
      // An expired/revoked token is an expected auth condition, not a server error:
      // return 401 + needsReconnect (like insights/media) so the 60s poll doesn't
      // spam 500s. Other upstream Graph failures are 502.
      if (isTokenError(limitData)) {
        return NextResponse.json(
          { error: 'Instagram session expired. Reconnect the account.', needsReconnect: true },
          { status: 401 },
        );
      }
      const msg = limitData?.error?.message || limitData?.error?.type || 'Failed to fetch publishing limit';
      console.error('[Publishing Limit] Upstream error:', msg);
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    // Shape: { data: [{ config: { quota_total, quota_duration }, quota_usage }] }.
    // Read total + window LIVE — Meta varies quota_total per account (docs show 50/100)
    // and the value is authoritative; fall back only when the field is absent.
    let quotaTotal = 50;
    let windowSeconds = 86400;
    let quotaUsage = 0;
    const first = Array.isArray(limitData?.data) ? limitData.data[0] : undefined;
    if (first) {
      if (first.config && typeof first.config.quota_total === 'number') quotaTotal = first.config.quota_total;
      if (first.config && typeof first.config.quota_duration === 'number') windowSeconds = first.config.quota_duration;
      if (typeof first.quota_usage === 'number') quotaUsage = first.quota_usage;
    }

    // ----- newest post timestamp (best-effort) -----
    let newestPostEpoch: number | null = null;
    if (mediaRes.status === 'fulfilled' && mediaRes.value.ok) {
      const mediaData = await mediaRes.value.json().catch(() => ({}));
      const items = Array.isArray(mediaData?.data) ? mediaData.data : [];
      for (const item of items) {
        const epoch = graphTimestampToEpoch(item?.timestamp);
        if (epoch != null) { newestPostEpoch = epoch; break; } // list is newest-first
      }
    }

    const resetAt = computeResetAt({ quotaUsage, newestPostEpoch, windowSeconds });
    const capped = quotaUsage >= quotaTotal;

    return NextResponse.json({
      // Back-compat fields the existing widget reads:
      config: quotaTotal,
      quota_usage: quotaUsage,
      // New, explicit fields:
      igUserId,
      username: account?.igUsername ?? null,
      used: quotaUsage,
      total: quotaTotal,
      remaining: Math.max(0, quotaTotal - quotaUsage),
      windowSeconds,
      capped,
      resetAt, // epoch seconds (newest post + window), or null when nothing to reset
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    console.error('[Publishing Limit] Error:', message || error);
    if (isAbortError(error)) {
      return NextResponse.json({ error: 'Upstream timed out. Please try again.' }, { status: 504 });
    }
    return NextResponse.json({ error: message || 'Failed to fetch publishing limit' }, { status: 500 });
  }
}
