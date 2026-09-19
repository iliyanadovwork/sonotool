'use client';

import { useState, useEffect, useRef } from 'react';
import { formatResetIn, formatResetAbsolute } from '@/lib/video-reels/publish-reset';

// Meta's content-publishing cap for Instagram is a rolling 24h window (carousels count
// once); the exact ceiling comes back per-account from the Graph API, so we render
// against the live `total` and fall back to 50 only if it's missing.
const DEFAULT_LIMIT = 50;

interface LimitData {
  config: number;
  quota_usage: number;
  total?: number;
  used?: number;
  capped?: boolean;
  resetAt?: number | null; // epoch seconds (newest post + window), or null
}

// Global Instagram publishing-limit tracker — lives in the sidebar beneath the shared IG
// connection, since Posts, Chart Reels, and Video Reels all publish against the same quota.
// Polls every 60s; renders nothing when no account is connected (401) or while unavailable.
export function PublishingLimit() {
  const [limit, setLimit] = useState<LimitData | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const fetchLimit = async () => {
      // Per-request sequence id so a slow earlier poll can't resolve after a newer
      // one and clobber fresher data with stale (the 60s interval overlaps otherwise).
      const reqId = ++reqIdRef.current;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const res = await fetch('/api/video-reels/meta/publishing-limit', { signal: controller.signal });
        if (cancelled || reqId !== reqIdRef.current) return;
        if (!res.ok) { setLimit(null); return; }   // 401 = not connected → hide quietly
        setLimit(await res.json());
      } catch {
        if (!cancelled && reqId === reqIdRef.current) setLimit(null);
      } finally {
        clearTimeout(timer);
      }
    };
    fetchLimit();
    const interval = setInterval(fetchLimit, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (!limit) return null;

  const total = Number(limit.total ?? limit.config) || DEFAULT_LIMIT;
  const used = Number(limit.used ?? limit.quota_usage) || 0;
  const remaining = Math.max(0, total - used);
  const capped = limit.capped ?? used >= total;
  const pct = Math.min(100, (used / total) * 100);
  const barColor =
    pct >= 100 ? 'bg-red-500'
    : pct >= 80 ? 'bg-yellow-500'
    : pct >= 50 ? 'bg-blue-500'
    : 'bg-emerald-500';

  const resetIn = formatResetIn(limit.resetAt ?? null);
  const resetAbs = formatResetAbsolute(limit.resetAt ?? null);

  return (
    <div
      className="px-3 py-1.5"
      title={
        `Instagram API posts in the rolling 24h window — ${remaining} of ${total} left` +
        (resetAbs ? `\nFully resets around ${resetAbs}` : '')
      }
    >
      <div className="flex items-center justify-between text-micro text-label-tertiary">
        <span>IG posts today</span>
        <span className="tabular-nums text-label-secondary">{used} / {total}</span>
      </div>
      <div className="mt-1.5 h-1 w-full bg-surface-2 rounded-full overflow-hidden">
        <div className={`h-full ${barColor} transition-[width] duration-300`} style={{ width: `${pct}%` }} />
      </div>
      {used > 0 && resetIn && (
        <div className={`mt-1 text-micro tabular-nums ${capped ? 'text-danger font-medium' : 'text-label-tertiary'}`}>
          {capped ? `Limit reached · resets in ${resetIn}` : `Resets in ${resetIn}`}
        </div>
      )}
    </div>
  );
}
