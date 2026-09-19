import { NextRequest, NextResponse } from 'next/server';
import { getMetaTokenForAccount } from '@/lib/video-reels/meta-token-storage';
import { fetchWithTimeout, isAbortError } from '@/lib/video-reels/fetch-timeout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Account-level Instagram analytics for the ACTIVE page (the selected page = the
// active account, so metrics follow the picker with no id param). VIEWING action:
// intentionally NOT isUnlocked-gated (mirrors meta/me + meta/accounts) — only a
// connected account is required. Posting/managing stays password-gated elsewhere.
//
// Insights need the 'instagram_business_manage_insights' scope, which every
// pre-existing token was minted WITHOUT; those tokens 403 on /insights until the
// page reconnects. followers/media count (the account node) works regardless, so
// the panel always renders SOMETHING and surfaces a reconnect prompt via warnings.

// Pin the version (unlike me/route.ts, which omits it) so 'views' exists and the
// deprecated 'impressions'/'profile_views' metrics stay gone.
const GRAPH_HOST = 'https://graph.instagram.com';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';
const UPSTREAM_TIMEOUT_MS = 12000;

/** The subset of a Graph error payload this route reads. */
interface GraphError {
  code?: number;
  error_subcode?: number;
  type?: string;
  message?: string;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
}

/** One datapoint of an insights time_series. */
interface GraphSeriesValue {
  end_time?: string;
  value?: number;
}

/** One metric entry of an insights response (total_value or time_series). */
interface GraphInsightEntry {
  name?: string;
  total_value?: { value?: number };
  values?: GraphSeriesValue[];
}

/** The Graph fields this route reads (account node + insights + errors). */
interface GraphJson {
  error?: GraphError;
  data?: GraphInsightEntry[];
  username?: string;
  name?: string;
  account_type?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  profile_picture_url?: string;
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
  const json = (await res.json().catch(() => ({}))) as GraphJson;
  return { ok: res.ok && !json?.error, status: res.status, json };
}

/** A Graph OAuthException that means "missing permission / scope". */
function isPermissionError(json: GraphJson): boolean {
  const err = json?.error;
  if (!err) return false;
  const msg = String(err.message || '');
  return err.code === 10 || err.code === 200 || /permission|scope|requires|insights/i.test(msg);
}

/** A Graph error that means the token itself is bad (expired/revoked). */
function isTokenError(json: GraphJson): boolean {
  const err = json?.error;
  if (!err) return false;
  return err.code === 190 || /invalid (oauth|access token)|expired|session has/i.test(String(err.message || ''));
}

/** Map an insights total_value response to { metricName: number|null }. */
function totalValues(json: GraphJson): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  const data = Array.isArray(json?.data) ? json.data : [];
  for (const entry of data) {
    const v = entry?.total_value?.value;
    if (entry?.name) out[entry.name] = typeof v === 'number' ? v : null;
  }
  return out;
}

export async function GET(request: NextRequest) {
  try {
    // Optional ?igUserId= selects a SPECIFIC connected account (the overview grid
    // + detail view fetch each page by id without changing the active account);
    // absent = the active account (unchanged for existing callers).
    const igUserIdParam = request.nextUrl.searchParams.get('igUserId');
    // Read-only (no refresh-write): the overview fans out up to 4 of these
    // concurrently, and a refresh's read-modify-write of the whole meta_token
    // cookie would let the last response clobber the others' fresh tokens. A
    // near-expiry token is still valid for viewing; the posting path refreshes it.
    const account = await getMetaTokenForAccount(igUserIdParam || undefined);
    if (!account?.igUserId || !account?.userAccessToken) {
      return NextResponse.json(
        { error: 'No Instagram account connected. Please connect your account first.' },
        { status: 401 },
      );
    }
    const igUserId = account.igUserId;
    const token = account.userAccessToken;

    const daysRaw = parseInt(request.nextUrl.searchParams.get('days') || '30', 10);
    // day-period total_value windows are capped ~30d; clamp to a safe range.
    const days = Number.isFinite(daysRaw) ? Math.min(30, Math.max(1, daysRaw)) : 30;
    const until = Math.floor(Date.now() / 1000);
    const since = until - days * 86400;
    const sinceStr = String(since);
    const untilStr = String(until);

    // Four independent groups run concurrently; a failure in one degrades that
    // group to null instead of 500ing the whole panel (Promise.allSettled).
    const [accountRes, coreRes, followerRes, tapsRes, reachSeriesRes] = await Promise.allSettled([
      // 1. Account node — ALWAYS works (no insights scope, no follower gate). This
      //    is what guarantees the panel renders followers/media even pre-reconnect.
      graphGet(igUserId, {
        fields: 'followers_count,follows_count,media_count,username,name,profile_picture_url,account_type',
        access_token: token,
      }),
      // 2. Core aggregate insights — all four share total_value + period=day, so
      //    they combine into one request.
      graphGet(`${igUserId}/insights`, {
        metric: 'reach,views,total_interactions,accounts_engaged',
        metric_type: 'total_value',
        period: 'day',
        since: sinceStr,
        until: untilStr,
        access_token: token,
      }),
      // 3. Follower growth series — time_series ONLY (NO metric_type), needs 100+
      //    followers or returns empty. Kept separate so it can't poison call 2.
      graphGet(`${igUserId}/insights`, {
        metric: 'follower_count',
        period: 'day',
        since: sinceStr,
        until: untilStr,
        access_token: token,
      }),
      // 4. Profile-action taps — the closest surviving proxy for "profile visits"
      //    (profile_views is deprecated on v22). Isolated & best-effort.
      graphGet(`${igUserId}/insights`, {
        metric: 'profile_links_taps',
        metric_type: 'total_value',
        period: 'day',
        since: sinceStr,
        until: untilStr,
        access_token: token,
      }),
      // 5. Reach daily time_series (NO metric_type — reach supports time_series) for
      //    the reach-over-time line chart. Isolated & best-effort.
      graphGet(`${igUserId}/insights`, {
        metric: 'reach',
        period: 'day',
        since: sinceStr,
        until: untilStr,
        access_token: token,
      }),
    ]);

    // ----- Call 1 is the only hard-fail path -----
    if (accountRes.status === 'rejected') {
      if (isAbortError(accountRes.reason)) {
        return NextResponse.json({ error: 'Upstream timed out. Please try again.' }, { status: 504 });
      }
      return NextResponse.json({ error: 'Failed to load Instagram account.' }, { status: 500 });
    }
    const acct = accountRes.value;
    if (!acct.ok) {
      if (isTokenError(acct.json)) {
        return NextResponse.json(
          { error: 'Instagram session expired. Reconnect the account.', needsReconnect: true },
          { status: 401 },
        );
      }
      // Surface + log the FULL Meta error so an app-level block (dev mode / app
      // restricted / missing permission) shows its exact reason instead of only
      // "API access blocked." Meta puts the human-readable cause in error_user_msg
      // / error_user_title (and the machine reason in code / error_subcode).
      const e: GraphError = acct.json?.error || {};
      console.error(
        '[insights] account-node blocked for', igUserId,
        JSON.stringify({
          code: e.code, subcode: e.error_subcode, type: e.type,
          message: e.message, userTitle: e.error_user_title, userMsg: e.error_user_msg,
          trace: e.fbtrace_id,
        }),
      );
      return NextResponse.json(
        {
          error: e.message || 'Failed to load Instagram account.',
          detail: e.error_user_msg || e.error_user_title || null,
          code: typeof e.code === 'number' ? e.code : null,
          subcode: typeof e.error_subcode === 'number' ? e.error_subcode : null,
        },
        { status: 502 },
      );
    }
    const node = acct.json;
    const accountType = String(node.account_type || '').toUpperCase();
    const warnings: string[] = [];

    // ----- Call 2: core insights -----
    const metrics: Record<string, number | null> = {
      reach: null,
      views: null,
      totalInteractions: null,
      accountsEngaged: null,
      profileLinksTaps: null,
      followersGained: null,
    };
    if (coreRes.status === 'fulfilled' && coreRes.value.ok) {
      const tv = totalValues(coreRes.value.json);
      metrics.reach = tv.reach ?? null;
      metrics.views = tv.views ?? null;
      metrics.totalInteractions = tv.total_interactions ?? null;
      metrics.accountsEngaged = tv.accounts_engaged ?? null;
    } else if (coreRes.status === 'fulfilled' && isPermissionError(coreRes.value.json)) {
      // The pre-reconnect state for every token minted before the insights scope.
      warnings.push('needsInsightsScope', 'needsReconnect');
    }
    // Personal accounts return empty insights — a note, not an error.
    if (accountType === 'PERSONAL') warnings.push('notProfessional');

    // ----- Call 3: follower series (best-effort) -----
    let followerCountSeries: Array<{ end_time: string; value: number }> | null = null;
    if (followerRes.status === 'fulfilled' && followerRes.value.ok) {
      const values = followerRes.value.json?.data?.[0]?.values;
      if (Array.isArray(values) && values.length > 0) {
        followerCountSeries = values
          .filter((v: GraphSeriesValue): v is GraphSeriesValue & { value: number } => !!v && typeof v.value === 'number')
          .map((v) => ({ end_time: String(v.end_time ?? ''), value: v.value }));
        metrics.followersGained = followerCountSeries.reduce((s, v) => s + v.value, 0);
      } else {
        warnings.push('notEnoughFollowers');
      }
    }

    // ----- Call 4: profile taps (best-effort) -----
    if (tapsRes.status === 'fulfilled' && tapsRes.value.ok) {
      const tv = totalValues(tapsRes.value.json);
      metrics.profileLinksTaps = tv.profile_links_taps ?? null;
    }

    // ----- Call 5: reach daily series (best-effort) -----
    let reachSeries: Array<{ end_time: string; value: number }> | null = null;
    if (reachSeriesRes.status === 'fulfilled' && reachSeriesRes.value.ok) {
      const values = reachSeriesRes.value.json?.data?.[0]?.values;
      if (Array.isArray(values) && values.length > 0) {
        reachSeries = values
          .filter((v: GraphSeriesValue): v is GraphSeriesValue & { value: number } => !!v && typeof v.value === 'number')
          .map((v) => ({ end_time: String(v.end_time ?? ''), value: v.value }));
      }
    }

    return NextResponse.json({
      account: {
        igUserId,
        username: node.username ?? account.igUsername ?? null,
        name: node.name ?? null,
        accountType: accountType || null,
        followersCount: typeof node.followers_count === 'number' ? node.followers_count : null,
        followsCount: typeof node.follows_count === 'number' ? node.follows_count : null,
        mediaCount: typeof node.media_count === 'number' ? node.media_count : null,
        profilePictureUrl: node.profile_picture_url ?? null,
      },
      window: { since, until, days },
      metrics,
      series: { followerCount: followerCountSeries, reach: reachSeries },
      warnings: Array.from(new Set(warnings)),
    });
  } catch (error: unknown) {
    if (isAbortError(error)) {
      return NextResponse.json({ error: 'Upstream timed out. Please try again.' }, { status: 504 });
    }
    const message = error instanceof Error ? error.message : '';
    return NextResponse.json({ error: message || 'Failed to load insights' }, { status: 500 });
  }
}
