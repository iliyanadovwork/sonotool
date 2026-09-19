'use client';

import { useRef, useState } from 'react';
import type { ImageBoxFade, FadeEdge, FadeStop } from './templateEditorTypes';
import { defaultFadeStops, sampleFadeStops } from './templateEditorTypes';

const EDGES: { key: FadeEdge; label: string }[] = [
  { key: 'top',    label: 'Top' },
  { key: 'bottom', label: 'Bottom' },
  { key: 'left',   label: 'Left' },
  { key: 'right',  label: 'Right' },
];

// Transparency checkerboard for the preview bar's faded regions (tokenised via separator).
const CHECKER =
  'linear-gradient(45deg,var(--color-separator) 25%,transparent 25%),linear-gradient(-45deg,var(--color-separator) 25%,transparent 25%),' +
  'linear-gradient(45deg,transparent 75%,var(--color-separator) 75%),linear-gradient(-45deg,transparent 75%,var(--color-separator) 75%)';

// Image visibility (0-1) of a fade curve at a given location (0-100), honouring midpoints.
function visAt(stops: FadeStop[], loc: number): number {
  const s = [...stops].sort((a, b) => a.loc - b.loc);
  if (loc <= s[0].loc) return s[0].opacity / 100;
  if (loc >= s[s.length - 1].loc) return s[s.length - 1].opacity / 100;
  for (let i = 0; i < s.length - 1; i++) {
    const A = s[i], B = s[i + 1];
    if (loc >= A.loc && loc <= B.loc) {
      const span = B.loc - A.loc;
      if (span <= 0) return A.opacity / 100;
      const p = (loc - A.loc) / span;
      const midPct = A.mid ?? 50;
      const t = Math.abs(midPct - 50) < 0.5
        ? p
        : Math.pow(p, Math.log(0.5) / Math.log(Math.min(0.999, Math.max(0.001, midPct / 100))));
      return (A.opacity + (B.opacity - A.opacity) * t) / 100;
    }
  }
  return 1;
}

// Photoshop-style per-edge fade curve editor: draggable opacity stops + midpoint diamonds,
// click the track to add a stop, numeric location/opacity, delete. One curve per edge.
export function FadeGradientEditor({ fade, onChange }: {
  fade: ImageBoxFade;
  onChange: (next: ImageBoxFade) => void;
}) {
  const [edge, setEdge] = useState<FadeEdge>('top');
  const [sel, setSel]   = useState(0);
  const barRef = useRef<HTMLDivElement>(null);

  const stops = fade.stops?.[edge] ?? defaultFadeStops();
  const selStop = stops[Math.min(sel, stops.length - 1)] ?? stops[0];
  const transparent = !fade.color;
  const reach = fade[edge] ?? 0;
  const edgeLabel = EDGES.find(e => e.key === edge)?.label ?? '';

  const writeStops = (next: FadeStop[]) =>
    onChange({ ...fade, stops: { ...(fade.stops ?? {}), [edge]: next } });

  const locFromX = (clientX: number): number => {
    const r = barRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100));
  };

  // Drag a stop horizontally (clamped between neighbours) or a midpoint between two stops.
  const beginDrag = (e: React.MouseEvent, kind: 'stop' | 'mid', index: number) => {
    e.stopPropagation();
    e.preventDefault();
    if (kind === 'stop') setSel(index);
    const start = stops.map(s => ({ ...s }));
    const onMove = (ev: MouseEvent) => {
      const loc = locFromX(ev.clientX);
      if (kind === 'stop') {
        const lo = index > 0 ? start[index - 1].loc + 0.5 : 0;
        const hi = index < start.length - 1 ? start[index + 1].loc - 0.5 : 100;
        writeStops(start.map((s, i) => i === index ? { ...s, loc: Math.round(Math.min(hi, Math.max(lo, loc))) } : s));
      } else {
        const A = start[index], B = start[index + 1];
        const span = B.loc - A.loc;
        const mid = span <= 0 ? 50 : Math.min(95, Math.max(5, ((loc - A.loc) / span) * 100));
        writeStops(start.map((s, i) => i === index ? { ...s, mid: Math.round(mid) } : s));
      }
    };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Click the track (not a handle) → insert a stop on the existing curve at that location.
  const addStop = (e: React.MouseEvent) => {
    const loc = Math.round(locFromX(e.clientX));
    if (stops.some(s => Math.abs(s.loc - loc) < 1)) return;
    const created: FadeStop = { loc, opacity: Math.round(visAt(stops, loc) * 100), mid: 50 };
    const next = [...stops, created].sort((a, b) => a.loc - b.loc);
    writeStops(next);
    setSel(next.indexOf(created));
  };

  const delStop = () => {
    if (stops.length <= 2) return;
    const next = stops.filter((_, i) => i !== sel);
    writeStops(next);
    setSel(Math.max(0, Math.min(sel, next.length - 1)));
  };

  const setSelLoc = (v: number) => {
    const lo = sel > 0 ? stops[sel - 1].loc : 0;
    const hi = sel < stops.length - 1 ? stops[sel + 1].loc : 100;
    writeStops(stops.map((s, i) => i === sel ? { ...s, loc: Math.min(hi, Math.max(lo, v)) } : s));
  };
  const setSelOpacity = (v: number) =>
    writeStops(stops.map((s, i) => i === sel ? { ...s, opacity: Math.min(100, Math.max(0, v)) } : s));

  const samples = sampleFadeStops(stops);
  const overlay = `linear-gradient(to right, ${samples
    .map(s => `rgba(255,255,255,${s.vis.toFixed(3)}) ${(s.pos * 100).toFixed(2)}%`)
    .join(', ')})`;
  const IN = 'w-12 bg-surface border border-separator hover:border-label-quaternary focus:border-tint rounded-sm px-1.5 py-1 text-micro text-label outline-none transition-colors ease-out';

  return (
    <div className="flex flex-col gap-2 pt-1" onMouseDown={e => e.stopPropagation()}>
      <span className="text-micro text-label-tertiary">Fade curve</span>

      {/* Edge selector */}
      <div className="flex gap-1">
        {EDGES.map(ed => (
          <button
            key={ed.key}
            type="button"
            aria-pressed={edge === ed.key}
            onClick={() => { setEdge(ed.key); setSel(0); }}
            className={`flex-1 h-7 rounded-sm text-micro font-medium transition-colors ease-out ${
              edge === ed.key ? 'bg-accent text-on-accent' : 'bg-surface border border-separator text-label-tertiary hover:text-label-secondary hover:border-label-quaternary'
            }`}
          >{ed.label}</button>
        ))}
      </div>

      {reach === 0 && (
        <span className="text-micro text-label-tertiary">Raise the {edgeLabel} reach above to preview this curve.</span>
      )}

      {/* Preview bar + handle track */}
      <div className="select-none">
        <div
          ref={barRef}
          className="relative h-5 rounded-sm overflow-hidden border border-separator"
          style={transparent
            ? { backgroundColor: 'var(--color-surface-2)', backgroundImage: CHECKER, backgroundSize: '8px 8px', backgroundPosition: '0 0,0 4px,4px -4px,-4px 0' }
            : { backgroundColor: fade.color }}
        >
          <div className="absolute inset-0" style={{ background: overlay }} />
        </div>

        {/* Track: click empty space to add; drag handles to move */}
        <div className="relative h-5 mt-1.5 cursor-copy" onMouseDown={addStop}>
          {/* Midpoint diamonds (between adjacent stops) */}
          {stops.slice(0, -1).map((A, i) => {
            const B = stops[i + 1];
            const midLoc = A.loc + ((A.mid ?? 50) / 100) * (B.loc - A.loc);
            return (
              <div
                key={`m${i}`}
                onMouseDown={e => beginDrag(e, 'mid', i)}
                title="Drag to bias the curve midpoint"
                className="absolute w-2.5 h-2.5 bg-fill-tertiary border border-separator cursor-ew-resize transition-colors ease-out hover:bg-fill-secondary"
                style={{ left: `${midLoc}%`, top: 2, transform: 'translateX(-50%) rotate(45deg)' }}
              />
            );
          })}
          {/* Opacity stops */}
          {stops.map((s, i) => (
            <div
              key={`s${i}`}
              onMouseDown={e => beginDrag(e, 'stop', i)}
              title={i === sel ? 'Selected stop — drag to move' : 'Drag to move this stop'}
              className="group absolute flex flex-col items-center cursor-ew-resize"
              style={{ left: `${s.loc}%`, top: 0, transform: 'translateX(-50%)' }}
            >
              <div
                style={{
                  width: 0, height: 0,
                  borderLeft: '5px solid transparent',
                  borderRight: '5px solid transparent',
                  borderBottom: `6px solid ${i === sel ? 'var(--color-tint)' : 'var(--color-fill-tertiary)'}`,
                }}
              />
              <div
                className="transition-shadow ease-out"
                style={{
                  width: 13, height: 13,
                  backgroundColor: `rgba(255,255,255,${(s.opacity / 100).toFixed(3)})`,
                  border: i === sel ? '2px solid var(--color-tint)' : '1.5px solid var(--color-fill-tertiary)',
                  borderRadius: 'var(--radius-sm)',
                  boxShadow: i === sel
                    ? '0 0 0 1px var(--color-surface), 0 1px 3px rgba(0,0,0,0.4)'
                    : '0 0 0 1px var(--color-surface)',
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Selected stop controls */}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-micro text-label-tertiary">
          Location
          <input
            type="number" min={0} max={100} value={Math.round(selStop.loc)}
            onChange={e => setSelLoc(Math.round(Number(e.target.value) || 0))}
            className={IN}
          />
        </label>
        <label className="flex items-center gap-1 text-micro text-label-tertiary">
          Opacity
          <input
            type="number" min={0} max={100} value={Math.round(selStop.opacity)}
            onChange={e => setSelOpacity(Math.round(Number(e.target.value) || 0))}
            className={IN}
          />
        </label>
        <button
          type="button"
          onClick={delStop}
          disabled={stops.length <= 2}
          aria-label="Delete selected stop"
          title={stops.length <= 2 ? 'A curve needs at least two stops' : 'Delete stop'}
          className="ml-auto shrink-0 w-6 h-6 flex items-center justify-center rounded-sm text-label-tertiary enabled:hover:text-danger enabled:hover:bg-surface-2 disabled:opacity-30 transition-colors ease-out"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
