'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

// Top reels table for the analytics view, styled after companion app's top-posts
// table: thumbnail + caption/date, right-aligned tabular metrics, and an accent ER
// column. Sorted by views. Views/Reach come from per-media insights (degrade to —
// when unavailable); Likes/Comments are free on the media node.

interface Reel {
  id: string;
  permalink: string | null;
  caption: string | null;
  timestamp: string | null;
  thumbnailUrl: string | null;
  likes: number | null;
  comments: number | null;
  metrics: { views: number | null; reach: number | null; totalInteractions: number | null };
}

const FETCH_TIMEOUT_MS = 15000;
const nf = new Intl.NumberFormat('en-US');
const fmt = (n: number | null | undefined) =>
  typeof n === 'number' ? (Math.abs(n) >= 10000 ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n) : nf.format(n)) : '—';
function fmtDate(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function er(r: Reel): string {
  const inter = r.metrics?.totalInteractions ?? ((r.likes ?? 0) + (r.comments ?? 0));
  const reach = r.metrics?.reach;
  return typeof reach === 'number' && reach > 0 ? `${((inter / reach) * 100).toFixed(1)}%` : '—';
}

export function ReelBreakdownList({ igUserId }: { igUserId: string }) {
  const [reels, setReels] = useState<Reel[] | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const reqIdRef = useRef(0);

  useEffect(() => {
    const reqId = ++reqIdRef.current;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    setState('loading');
    (async () => {
      try {
        const res = await fetch(`/api/video-reels/meta/media?igUserId=${encodeURIComponent(igUserId)}&limit=12`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const json = await res.json().catch(() => ({}));
        if (reqId !== reqIdRef.current) return;
        if (!res.ok) { setReels(null); setState('error'); }
        else {
          const list: Reel[] = Array.isArray(json?.reels) ? json.reels : [];
          list.sort((a, b) => (b.metrics?.views ?? -1) - (a.metrics?.views ?? -1));
          setReels(list);
          setState('ok');
        }
      } catch {
        if (reqId !== reqIdRef.current) return;
        setReels(null);
        setState('error');
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => { clearTimeout(timer); controller.abort(); };
  }, [igUserId]);

  const Col = ({ children, w }: { children: ReactNode; w: string }) => (
    <span className={`${w} text-right shrink-0`}>{children}</span>
  );

  return (
    <section className="bg-surface-1 border border-separator rounded-xl p-4 mt-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-title3 text-label">Top reels</h2>
        <span className="text-caption-sm text-label-quaternary">by views · lifetime totals</span>
      </div>

      {state === 'ok' && reels && reels.length > 0 && (
        <div className="hidden sm:flex items-center gap-3 px-2 pb-2 border-b border-separator text-caption-sm text-label-tertiary">
          <span className="w-11 shrink-0" />
          <span className="flex-1">Reel</span>
          <Col w="w-16">Views</Col>
          <Col w="w-16">Reach</Col>
          <Col w="w-14">Likes</Col>
          <Col w="w-20">Comments</Col>
          <Col w="w-14">ER</Col>
        </div>
      )}

      {state === 'loading' && (
        <div className="flex flex-col">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 py-2.5">
              <div className="w-11 h-14 rounded-md bg-surface-2 animate-pulse shrink-0" />
              <div className="flex-1 h-4 rounded bg-surface-2 animate-pulse" />
            </div>
          ))}
        </div>
      )}

      {state === 'error' && <div className="text-caption-sm text-label-tertiary py-4">Couldn’t load reels.</div>}
      {state === 'ok' && reels && reels.length === 0 && <div className="text-caption-sm text-label-tertiary py-4">No reels found.</div>}

      {state === 'ok' && reels && reels.length > 0 && (
        <div className="flex flex-col">
          {reels.map((r) => (
            <a
              key={r.id}
              href={r.permalink ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 py-2.5 border-b border-separator-subtle last:border-0 hover:bg-surface-2 rounded-md px-2 transition-colors"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.thumbnailUrl ?? ''} alt="" className="w-11 h-14 rounded-md object-cover bg-surface-2 shrink-0 border border-separator" />
              <div className="min-w-0 flex-1">
                <p className="text-body-sm text-label truncate">{r.caption?.trim() || 'Untitled reel'}</p>
                <p className="text-caption-sm text-label-tertiary tabular-nums">{fmtDate(r.timestamp)}</p>
                <p className="sm:hidden text-caption-sm text-label-secondary tabular-nums mt-0.5">
                  {fmt(r.metrics?.views)} views · {fmt(r.likes)} likes · ER {er(r)}
                </p>
              </div>
              <Col w="w-16"><span className="text-body-sm text-label-primary tabular-nums hidden sm:inline">{fmt(r.metrics?.views)}</span></Col>
              <Col w="w-16"><span className="text-body-sm text-label-primary tabular-nums hidden sm:inline">{fmt(r.metrics?.reach)}</span></Col>
              <Col w="w-14"><span className="text-body-sm text-label-primary tabular-nums hidden sm:inline">{fmt(r.likes)}</span></Col>
              <Col w="w-20"><span className="text-body-sm text-label-primary tabular-nums hidden sm:inline">{fmt(r.comments)}</span></Col>
              <Col w="w-14"><span className="text-body-sm font-medium text-accent tabular-nums hidden sm:inline">{er(r)}</span></Col>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
