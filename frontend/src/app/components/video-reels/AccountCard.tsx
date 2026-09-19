'use client';

import { useEffect, useRef, useState } from 'react';
import { FollowerSparkline } from './FollowerSparkline';
import { formatResetIn, formatResetAbsolute } from '@/lib/video-reels/publish-reset';

// One connected IG page in the overview grid. Self-fetches account-level insights
// for THIS page by id (never changes the active account): identity + a prominent
// follower area-chart + Reach/Views/Interactions. Degrades to a reconnect notice
// or a one-line error without ever becoming a dead tile.

interface InsightsResponse {
  account: {
    igUserId: string;
    username: string | null;
    name: string | null;
    followersCount: number | null;
    profilePictureUrl: string | null;
  };
  metrics: {
    reach: number | null;
    views: number | null;
    totalInteractions: number | null;
    followersGained: number | null;
  };
  series: { followerCount: Array<{ end_time: string; value: number }> | null };
  warnings: string[];
}

interface LimitInfo {
  used: number;
  total: number;
  capped: boolean;
  resetAt: number | null; // epoch seconds (newest post + window), or null
}

const FETCH_TIMEOUT_MS = 15000;

const nf = new Intl.NumberFormat('en-US');
function fmtCompact(n: number | null | undefined): string {
  if (typeof n !== 'number') return '—';
  if (Math.abs(n) >= 1000) {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  }
  return nf.format(n);
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-2 rounded-lg px-3 py-2.5">
      <div className="text-caption-sm text-label-tertiary">{label}</div>
      <div className="text-body font-semibold text-label-primary tabular-nums mt-1">{value}</div>
    </div>
  );
}

export function AccountCard({
  igUserId,
  label,
  onViewMore,
  onPost,
}: {
  igUserId: string;
  label: string;
  onViewMore: () => void;
  onPost: () => void;
}) {
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const reqIdRef = useRef(0);
  const [limit, setLimit] = useState<LimitInfo | null>(null);
  const limitReqIdRef = useRef(0);

  useEffect(() => {
    const reqId = ++reqIdRef.current;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    setState('loading');
    (async () => {
      try {
        const res = await fetch(
          `/api/video-reels/meta/insights?igUserId=${encodeURIComponent(igUserId)}&days=30`,
          { cache: 'no-store', signal: controller.signal },
        );
        const json = await res.json().catch(() => ({}));
        if (reqId !== reqIdRef.current) return;
        if (!res.ok) { setData(null); setState('error'); }
        else { setData(json as InsightsResponse); setState('ok'); }
      } catch {
        if (reqId !== reqIdRef.current) return;
        setData(null);
        setState('error');
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => { clearTimeout(timer); controller.abort(); };
  }, [igUserId]);

  // Publishing-limit badge — its own igUserId-scoped, read-only fetch so a slow or
  // failed quota call never blocks the analytics tiles (and vice versa).
  useEffect(() => {
    const reqId = ++limitReqIdRef.current;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    setLimit(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/video-reels/meta/publishing-limit?igUserId=${encodeURIComponent(igUserId)}`,
          { cache: 'no-store', signal: controller.signal },
        );
        const json = await res.json().catch(() => ({}));
        if (reqId !== limitReqIdRef.current) return;
        if (res.ok) setLimit(json as LimitInfo);
      } catch {
        /* best-effort — the badge just stays hidden */
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => { clearTimeout(timer); controller.abort(); };
  }, [igUserId]);

  // The limit is fetched once per mount, but the "resets in …" label is relative to
  // now — tick a re-render every 60s so it counts down instead of freezing at its
  // fetch-time value (mirrors the sidebar widget's 60s cadence).
  const [, setNowTick] = useState(0);
  useEffect(() => {
    if (!limit?.resetAt) return;
    const id = setInterval(() => setNowTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, [limit?.resetAt]);

  const acct = data?.account;
  const m = data?.metrics;
  const warnings = data?.warnings ?? [];
  const needsReconnect = warnings.includes('needsReconnect') || warnings.includes('needsInsightsScope');
  const username = acct?.username || label;
  const gained = m?.followersGained;

  return (
    <div className="rounded-xl bg-surface-1 border border-separator p-5 min-h-[252px] flex flex-col gap-4">
      {/* Identity */}
      <div className="flex items-center gap-3 min-w-0">
        {acct?.profilePictureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={acct.profilePictureUrl} alt="" className="w-12 h-12 rounded-full object-cover shrink-0" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-surface-2 shrink-0" />
        )}
        <div className="min-w-0">
          <div className="text-body font-semibold text-label truncate">@{username}</div>
          <div className="text-caption-sm text-label-tertiary tabular-nums flex items-center gap-1.5">
            <span>{state === 'loading' ? 'Loading…' : `${fmtCompact(acct?.followersCount)} followers`}</span>
            {state === 'ok' && typeof gained === 'number' && gained !== 0 && !needsReconnect && (
              <span className={gained > 0 ? 'text-accent' : 'text-danger'}>
                {gained > 0 ? '+' : ''}{fmtCompact(gained)} · 30d
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Follower trend */}
      {state === 'loading' ? (
        <div className="h-14 rounded-lg bg-surface-2 animate-pulse" />
      ) : needsReconnect ? (
        <div className="bg-surface-2 rounded-lg px-3 py-2.5 text-caption-sm text-label-secondary">
          Reconnect to enable analytics.
        </div>
      ) : state === 'error' ? (
        <div className="h-14 grid place-items-center text-caption-sm text-label-tertiary">Couldn’t load analytics.</div>
      ) : (
        <div className="text-accent">
          <FollowerSparkline
            series={data?.series?.followerCount}
            followersCount={acct?.followersCount}
            className="w-full h-14"
            emptyHint="Follower trend needs 100+ followers"
          />
        </div>
      )}

      {/* Metrics */}
      {state !== 'loading' && !needsReconnect && state !== 'error' && (
        <div className="grid grid-cols-3 gap-2">
          <Tile label="Reach" value={fmtCompact(m?.reach)} />
          <Tile label="Views" value={fmtCompact(m?.views)} />
          <Tile label="Interactions" value={fmtCompact(m?.totalInteractions)} />
        </div>
      )}
      {state === 'loading' && (
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => <div key={i} className="bg-surface-2 rounded-lg h-[58px] animate-pulse" />)}
        </div>
      )}

      {/* Publishing limit + reset time */}
      {limit && (limit.used ?? 0) > 0 && (() => {
        const resetIn = formatResetIn(limit.resetAt ?? null);
        const resetAbs = formatResetAbsolute(limit.resetAt ?? null);
        return (
          <div
            className={`text-caption-sm tabular-nums ${limit.capped ? 'text-danger font-medium' : 'text-label-tertiary'}`}
            title={resetAbs ? `Rolling 24h window fully resets around ${resetAbs}` : undefined}
          >
            {limit.capped ? 'Limit reached' : `${limit.used}/${limit.total} posts`}
            {resetIn ? ` · resets in ${resetIn}` : ''}
          </div>
        );
      })()}

      {/* Actions */}
      <div className="mt-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onViewMore}
          className="h-9 px-3 rounded-md bg-surface-2 border border-separator text-caption font-medium text-label-secondary hover:text-label hover:border-label-quaternary transition-colors"
        >
          View more
        </button>
        <button
          type="button"
          onClick={onPost}
          className="h-9 px-3 rounded-md bg-accent text-on-accent text-caption font-medium hover:bg-accent-hover active:bg-accent-pressed transition-colors"
        >
          Post
        </button>
      </div>
    </div>
  );
}
