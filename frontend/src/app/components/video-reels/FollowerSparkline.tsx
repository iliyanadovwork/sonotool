'use client';

import { useId } from 'react';

// CSP-safe follower-growth chart (pure inline SVG, no charting lib) — a smoothed
// Catmull-Rom area curve with a gradient fill, in the companion app's style. The
// IG follower_count series is a per-DAY DELTA (net new followers), so we plot the
// running cumulative sum (the growth shape), anchored to the current total.
// Theme via currentColor; set the color on the parent (e.g. text-accent).

const W = 100;
const H = 40;
const PAD = 4;

// Catmull-Rom -> cubic-bezier smoothing for a natural curve.
function smoothPath(pts: Array<[number, number]>): string {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M ${pts[0][0]},${pts[0][1]} L ${pts[1][0]},${pts[1][1]}`;
  let d = `M ${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}

export function FollowerSparkline({
  series,
  followersCount,
  className = 'w-full h-10',
  gridlines = false,
  emptyHint,
}: {
  series: Array<{ end_time: string; value: number }> | null | undefined;
  followersCount?: number | null;
  className?: string;
  gridlines?: boolean;
  emptyHint?: string;
}) {
  const gradId = useId().replace(/:/g, '');
  const deltas = (series ?? []).map((p) => (p && typeof p.value === 'number' ? p.value : 0));

  if (deltas.length < 2) {
    return (
      <div className={`${className} relative`}>
        <svg className="w-full h-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Follower growth unavailable">
          <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="currentColor" strokeWidth={1.25} vectorEffect="non-scaling-stroke" opacity={0.25} />
        </svg>
        {emptyHint ? (
          <span className="absolute inset-0 grid place-items-center text-caption-sm text-label-quaternary pointer-events-none">{emptyHint}</span>
        ) : null}
      </div>
    );
  }

  const cum: number[] = [];
  let acc = 0;
  for (const d of deltas) {
    acc += d;
    cum.push(acc);
  }
  const min = Math.min(...cum);
  const max = Math.max(...cum);
  const span = max - min || 1;
  const pts: Array<[number, number]> = cum.map((v, i) => [
    (i / (cum.length - 1)) * W,
    PAD + (H - 2 * PAD) * (1 - (v - min) / span),
  ]);
  const line = smoothPath(pts);
  const area = `${line} L ${W},${H} L 0,${H} Z`;
  const total = cum[cum.length - 1];
  const sign = total >= 0 ? '+' : '';
  const now = typeof followersCount === 'number' ? ` (now ${followersCount.toLocaleString()})` : '';

  return (
    <svg
      className={className}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Follower growth, ${sign}${total.toLocaleString()} over ${deltas.length} days${now}`}
    >
      <defs>
        <linearGradient id={`spark-${gradId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.28} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      {gridlines &&
        [0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" y1={PAD + (H - 2 * PAD) * f} x2={W} y2={PAD + (H - 2 * PAD) * f} stroke="currentColor" strokeWidth={0.5} vectorEffect="non-scaling-stroke" opacity={0.08} />
        ))}
      <path d={area} fill={`url(#spark-${gradId})`} stroke="none" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
