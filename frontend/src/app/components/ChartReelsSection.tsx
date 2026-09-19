'use client';

import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { upload as uploadToBlob } from '@vercel/blob/client';
import { useInstagramConnection } from './InstagramConnection';
import { ChartsCanvas } from './ChartsCanvas';
import { CANVAS_W, DISPLAY_SCALE } from './ChartsCanvas/constants';
import type { ChartsCanvasRef, ChartsMarket, ReelType } from './ChartsCanvas/types';
import { SP500_ID } from './ChartsCanvas/types';
import { ChartsInputCard, CHARTS_AUDIO_TRACKS } from './ChartsInputCard';
import type { PreloadedAudio } from './ChartsInputCard';
import { CloseIcon } from '@/lib/icons';
import { framedDrawRect, clampFrame, DEFAULT_FRAME, type CircleFrame } from '@/lib/circleFrame';

type PickerPhoto = { url: string; thumbnail: string; title?: string };

const CHARTS_SUPABASE_URL = process.env.NEXT_PUBLIC_CHARTS_SUPABASE_URL ?? '';
const CHARTS_SUPABASE_KEY = process.env.NEXT_PUBLIC_CHARTS_SUPABASE_KEY ?? '';
function getChartsClient() {
  // Read-only data client for a SEPARATE Supabase project (the indextrading
  // artist index). Disable all auth/session behaviour: this must never persist
  // a session, refresh a token, or pick up an #access_token from the URL — that
  // token belongs to sonotool's own project, not this one.
  return createClient(CHARTS_SUPABASE_URL, CHARTS_SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

type AiGroup = { a: ChartsMarket; b: ChartsMarket; reason: string };

type SlotState = {
  id: string;
  reelType: ReelType;
  markets: [ChartsMarket | null, ChartsMarket | null];
  overrideNames: [string, string];
  caption: string;
  captionFontSize: number;
  bannerText: string;
  bannerFontSize: number;
  trendsLoaded: [boolean, boolean];
  trendsLoading: [boolean, boolean];
  instagramCaption: string;
  instagramCaptionLoading: boolean;
  audioTrack: { label: string; url: string; durationMs: number } | null;
  videoLengthSec: number | null;
  smoothing: number;
  artistMultiplier: number;
  profitCumulative: boolean;
  recState: { isRecording: boolean; recProgress: number; recStatus: string };
  igPublish: { busy: boolean; msg: string; permalink: string | null; error: string | null };
};

type SlotUpdater = Partial<SlotState> | ((prev: SlotState) => Partial<SlotState>);

const REEL_TYPE_LABELS: Record<ReelType, string> = {
  comparison: 'Comparison',
  profit: 'Profit vs S&P 500',
};
const REEL_TYPES = Object.keys(REEL_TYPE_LABELS) as ReelType[];

// The S&P 500 pseudo-market that Profit reels compare against. Its sparkline comes from
// /api/charts/spx (real monthly closes), not Google Trends.
const SP500_MARKET: ChartsMarket = { id: SP500_ID, name: 'S&P 500', ticker: 'SPX', photo_url: '/sp500.png', industry: null };

// A track's duration as 0.1s-precision seconds, clamped to the video-length field's valid
// range — the value auto-filled into videoLengthSec when the track is selected (kept
// editable; also used to detect "user didn't change it").
const trackSeconds = (durationMs: number) => Math.min(180, Math.max(4, Math.round(durationMs / 100) / 10));

// Instagram's hard caption limit (matches the Posts publish dialog).
const MAX_IG_CAPTION = 2200;

// Instruction prefix for AI caption generation — kept in sync with the Posts publish
// dialog's DEFAULT_PROMPT_PREFIX so "Get Caption" behaves identically across features.
const CAPTION_PROMPT_PREFIX =
  'Generate me an instagram caption, no emojis, in exactly 2 paragraphs, on this topic. ' +
  'Before writing, you must use Google Search to look up current, accurate, up-to-date ' +
  'information about the topic, and base the caption on what you find — do not rely on prior knowledge alone. ' +
  'Do NOT include any source citations, URLs, website names, domain names, or reference markers ' +
  '(e.g. "[wikipedia.org]" or "[1]") in the caption — write it as clean prose with no references. ' +
  'Aim for roughly 1800 characters and never exceed 2000. Output only the caption text, nothing else. Topic:';

// Replicates the canvas's profit transform to get a series' final on-screen number for the
// caption. The real-priced S&P (real=true) is the $100/mo DCA value; the artist (real=false)
// is $100/mo DCA'd into its CUMULATIVE interest index (running sum, floored only for numeric
// stability), then scaled by the per-reel artistMultiplier. Stay in sync with drawCompareChart
// in ChartsCanvas. Null if no data.
const CUM_INDEX_FLOOR = 0.5; // matches ChartsCanvas
function profitEndValue(sparkline: { value: number }[] | undefined, smoothingPct: number, artistMultiplier: number, real: boolean, cumulative: boolean): number | null {
  if (!sparkline?.length) return null;
  const values = sparkline.map(p => p.value);
  const n = values.length;
  let s = values;
  const radius = Math.round((smoothingPct / 100) * 0.08 * n); // SMOOTH_MAX_FRAC = 0.08
  if (radius >= 1 && n > 2) {
    const prefix = new Array<number>(n + 1); prefix[0] = 0;
    for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + values[i];
    s = values.map((_, i) => {
      const lo = Math.max(0, i - radius), hi = Math.min(n - 1, i + radius);
      return (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
    });
  }
  if (!real) {
    if (cumulative) {
      // Artist CUMULATIVE: cumulate the index, $100/mo DCA into it, × multiplier.
      let cum = 0, shares = 0;
      for (const v of s) { cum += Math.max(v, 0); const px = Math.max(cum, CUM_INDEX_FLOOR); if (px > 0) shares += 100 / px; }
      return shares * Math.max(cum, CUM_INDEX_FLOOR) * artistMultiplier;
    }
    // Artist TRENDS: original DCA straight on the raw index (no floor), × multiplier.
    let shares = 0;
    for (const v of s) { if (v > 0) shares += 100 / v; }
    return shares * s[n - 1] * artistMultiplier;
  }
  // S&P: $100/mo dollar-cost-average value.
  let shares = 0;
  for (const v of s) { if (v > 0) shares += 100 / v; }
  return shares * s[n - 1];
}

const fmtFullMoney = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

// Builds the "Get Caption" AI prompt. Profit reels get a self-contained, data-filled prompt
// (artist name + computed end portfolios baked in, no separate topic field). Comparison reels
// fall back to the generic instruction prefix + the chart headline as the topic.
function buildCaptionPrompt(slot: SlotState): string {
  const a = slot.markets[0], b = slot.markets[1];
  const artist = slot.overrideNames[0] || a?.name || 'this artist';
  if (slot.reelType === 'profit') {
    const smoothing = slot.smoothing ?? 30, mult = slot.artistMultiplier ?? 1, cum = slot.profitCumulative ?? true;
    const artistEnd = profitEndValue(a?.sparkline, smoothing, mult, false, cum);
    const spEnd = profitEndValue(b?.sparkline, smoothing, mult, b?.id === SP500_ID, cum);
    const artistStr = artistEnd != null ? fmtFullMoney(artistEnd) : '(press Start to compute)';
    const spStr = spEnd != null ? fmtFullMoney(spEnd) : '$102,499';
    return `Give me an instagram caption between 1500 and 2000 character limit, no emojis, 2 paragraphs on this topic: A video showing a chart animation illustrating the comparison of investing 100$/mo on ${artist} index on sonotrade.io vs 100$/mo in snp500 starting from 2004. The net portfolio for ${artist} ended up at ${artistStr} and snp500 was ${spStr}. Mention who ${artist} is briefly and say how sonotrade lets you trade on artists indexes and tell them to go to the link in bio to find out more.`;
  }
  const topic = slot.caption.trim() || [artist, slot.overrideNames[1] || b?.name].filter(Boolean).join(' vs ');
  return `${CAPTION_PROMPT_PREFIX} ${topic}`;
}

// Default chart-headline caption, rebuilt whenever the pair (or an override name) changes.
const defaultCaption = (reelType: ReelType, a: string, b: string) =>
  reelType === 'profit'
    ? `Net Portfolio of investing $100/mo in ${a} vs ${b} Index Over Time`
    : `${a} vs ${b} Index Over Time`;

// Default white-banner headline for profit reels (uses the artist = slot A). Comparison
// reels get no auto-banner, so their banner is never overwritten.
const defaultBannerText = (reelType: ReelType, artist: string) =>
  reelType === 'profit' ? `What if you had invested in ${artist} instead of stocks?` : '';

function makeSlot(id: string, g?: AiGroup, reelType: ReelType = 'comparison'): SlotState {
  return {
    id,
    reelType,
    markets: g ? [g.a, g.b] : [null, null],
    overrideNames: ['', ''],
    caption: g ? defaultCaption(reelType, g.a.name, g.b.name) : '',
    captionFontSize: 22,
    bannerText: g ? defaultBannerText(reelType, g.a.name) : '',
    bannerFontSize: 60,
    trendsLoaded: [false, false],
    trendsLoading: [false, false],
    instagramCaption: '',
    instagramCaptionLoading: false,
    audioTrack: null,
    videoLengthSec: null,
    smoothing: 30,
    artistMultiplier: 1,
    profitCumulative: true,
    recState: { isRecording: false, recProgress: 0, recStatus: '' },
    igPublish: { busy: false, msg: '', permalink: null, error: null },
  };
}

// Posts-style "Get Caption" dialog: an editable AI prompt prefix + topic go to the shared
// grounded-Gemini route, and the result drops into the caption box below for review/editing
// (the same flow as PostInstagramPublishDialog's "Generate with AI" panel).
function ChartsCaptionDialog({ caption, initialPrompt, onCaptionChange, onClose }: {
  caption: string;
  initialPrompt: string;
  onCaptionChange: (v: string) => void;
  onClose: () => void;
}) {
  // Single editable prompt (no separate topic field) — the prompt already contains the full
  // instruction + topic, built per reel type by buildCaptionPrompt.
  const [prompt, setPrompt] = useState(initialPrompt);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');

  async function generate() {
    if (!prompt.trim()) { setGenError('The prompt is empty.'); return; }
    setGenerating(true);
    setGenError('');
    try {
      const res = await fetch('/api/posts/instagram/generate-caption', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data = await res.json().catch(() => ({})) as { caption?: string; error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to generate caption');
      onCaptionChange((data.caption || '').slice(0, MAX_IG_CAPTION));
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Failed to generate caption');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { if (!generating) onClose(); }}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-[460px] max-w-[92vw] max-h-[85vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
          <span className="text-sm font-semibold text-zinc-200">Get Caption</span>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <CloseIcon size={14} />
          </button>
        </div>
        <div className="px-4 py-3 flex flex-col gap-3 overflow-y-auto">
          <div className="flex flex-col gap-2 rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-3">
            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Prompt</span>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              disabled={generating}
              rows={9}
              aria-label="AI prompt"
              className="w-full resize-none rounded-md bg-zinc-900 border border-zinc-800 px-2.5 py-1.5 text-[11px] text-zinc-300 leading-relaxed outline-none focus:border-zinc-700 disabled:opacity-60"
            />
            <button type="button"
              onClick={() => void generate()}
              disabled={generating || !prompt.trim()}
              className="self-end h-8 px-3 rounded-md text-[11px] font-semibold bg-fuchsia-500/10 border border-fuchsia-500/30 text-fuchsia-300 hover:bg-fuchsia-500/20 disabled:opacity-40 transition-colors whitespace-nowrap">
              {generating ? 'Generating…' : 'Generate'}
            </button>
            {genError && <span className="text-[10px] text-red-400 leading-snug">{genError}</span>}
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Caption</span>
            <textarea
              value={caption}
              onChange={e => onCaptionChange(e.target.value.slice(0, MAX_IG_CAPTION))}
              disabled={generating}
              rows={7}
              placeholder="Write a caption…"
              className="w-full resize-none rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-[11px] text-zinc-300 leading-relaxed placeholder-zinc-600 outline-none focus:border-zinc-700 disabled:opacity-60"
            />
            <span className="text-[10px] text-zinc-600 self-end tabular-nums">{caption.length}/{MAX_IG_CAPTION}</span>
          </label>
        </div>
      </div>
    </div>
  );
}

function AiPairsPanel({
  groups, loading, addedIds, onAdd, onClose,
}: {
  groups: AiGroup[];
  loading: boolean;
  addedIds: Set<string>;
  onAdd: (g: AiGroup) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-[520px] max-h-[75vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
          <span className="text-sm font-semibold text-zinc-200">AI Artist Pairs</span>
          <span className="text-[10px] text-zinc-600">Click to add canvases</span>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <CloseIcon size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-zinc-500 text-xs">
              <svg className="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Asking AI…
            </div>
          ) : groups.length === 0 ? (
            <p className="text-xs text-zinc-500 text-center py-10">No pairs returned.</p>
          ) : (
            groups.map((g, i) => {
              const key = `${g.a.id}|${g.b.id}`;
              const added = addedIds.has(key);
              return (
                <button key={i} type="button" onClick={() => onAdd(g)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-zinc-800 transition-colors text-left ${added ? 'opacity-50' : ''}`}>
                  {g.a.photo_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={g.a.photo_url} alt={g.a.name} className="w-9 h-9 rounded-full object-cover shrink-0" />
                    : <div className="w-9 h-9 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-300 shrink-0">{g.a.name.charAt(0)}</div>}
                  <span className="text-sm text-zinc-200 font-medium truncate max-w-[110px]">{g.a.name}</span>
                  <span className="text-[11px] text-zinc-500 shrink-0">vs</span>
                  {g.b.photo_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={g.b.photo_url} alt={g.b.name} className="w-9 h-9 rounded-full object-cover shrink-0" />
                    : <div className="w-9 h-9 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-300 shrink-0">{g.b.name.charAt(0)}</div>}
                  <span className="text-sm text-zinc-200 font-medium truncate max-w-[110px]">{g.b.name}</span>
                  <span className="ml-auto text-[10px] text-zinc-500 shrink-0 max-w-[90px] text-right leading-tight">{g.reason}</span>
                  {added && (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-400 shrink-0">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function FramePopup({ imageUrl, loading, error, frame, onChange, onSave, onCancel }: {
  imageUrl: string | null; loading: boolean; error: string;
  frame: CircleFrame; onChange: (f: CircleFrame) => void; onSave: () => void; onCancel: () => void;
}) {
  const R = 120, SIZE = R * 2;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const frameRef = useRef(frame);
  const onChangeRef = useRef(onChange);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  // Latest-value refs for the window mousemove listener below (attached once, so it
  // must not close over a stale frame/onChange). Synced in a layout effect — i.e. at
  // commit time, before paint — never during render: a mouse event can only fire after
  // paint, so the drag still always reads the value of the most recent committed render.
  useLayoutEffect(() => {
    frameRef.current = frame;
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- `ready` mirrors the load state of an out-of-React HTMLImageElement; this branch is the teardown when there is no image to load, so it must reset alongside imgRef (it runs once per imageUrl change, not as a cascade).
    if (!imageUrl) { imgRef.current = null; setReady(false); return; }
    const img = new Image(); img.crossOrigin = 'anonymous';
    let cancelled = false;
    img.onload = () => { if (cancelled) return; imgRef.current = img; setReady(true); };
    img.onerror = () => { if (cancelled) return; imgRef.current = null; setReady(false); };
    img.src = imageUrl;
    return () => { cancelled = true; };
  }, [imageUrl]);

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    ctx.fillStyle = '#27272a'; ctx.fillRect(0, 0, SIZE, SIZE);
    const img = imgRef.current;
    if (img) {
      const { dx, dy, w, h } = framedDrawRect(img.naturalWidth, img.naturalHeight, R, R, R, frame);
      ctx.drawImage(img, dx, dy, w, h);
    }
    ctx.restore();
  }, [frame, ready, R, SIZE]);

  useEffect(() => {
    function move(e: MouseEvent) {
      const img = imgRef.current;
      if (!dragRef.current || !img) return;
      const dx = (e.clientX - dragRef.current.x) / R;
      const dy = (e.clientY - dragRef.current.y) / R;
      dragRef.current = { x: e.clientX, y: e.clientY };
      const f = frameRef.current;
      onChangeRef.current(clampFrame(img.naturalWidth, img.naturalHeight, { ...f, panX: f.panX + dx, panY: f.panY + dy }));
    }
    function up() { dragRef.current = null; }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [R]);

  const onZoom = (z: number) => {
    const img = imgRef.current;
    const next = { ...frame, zoom: z };
    onChange(img ? clampFrame(img.naturalWidth, img.naturalHeight, next) : next);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onCancel}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-[320px] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <span className="text-sm font-semibold text-zinc-200">Frame photo</span>
          <button type="button" onClick={onCancel} className="text-zinc-500 hover:text-zinc-300 transition-colors"><CloseIcon size={14} /></button>
        </div>
        <div className="flex flex-col items-center gap-3 p-4">
          <div className="relative" style={{ width: SIZE, height: SIZE }}>
            {loading ? (
              <div className="w-full h-full rounded-full bg-zinc-800 flex items-center justify-center">
                <svg className="animate-spin w-6 h-6 text-zinc-500" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              </div>
            ) : error ? (
              <div className="w-full h-full rounded-full bg-zinc-800 flex items-center justify-center text-center px-6 text-[11px] text-red-400">{error}</div>
            ) : (
              <canvas ref={canvasRef} width={SIZE} height={SIZE}
                onMouseDown={e => { dragRef.current = { x: e.clientX, y: e.clientY }; }}
                className="rounded-full cursor-grab active:cursor-grabbing select-none" />
            )}
          </div>
          {!loading && !error && (
            <div className="w-full flex items-center gap-2">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Zoom</span>
              <input type="range" min={1} max={3} step={0.01} value={frame.zoom}
                onChange={e => onZoom(parseFloat(e.target.value))} className="flex-1 accent-white" />
            </div>
          )}
          <p className="text-[10px] text-zinc-600 text-center">Drag to reposition · slider to zoom</p>
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-zinc-800">
          <button type="button" onClick={onCancel} className="flex-1 py-2 rounded-lg text-xs font-semibold bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors">Cancel</button>
          <button type="button" onClick={onSave} disabled={loading || !!error} className="flex-1 py-2 rounded-lg text-xs font-semibold bg-white/10 border border-white/20 text-white hover:bg-white/20 disabled:opacity-40 transition-colors">Save</button>
        </div>
      </div>
    </div>
  );
}

const CANVAS_CARD_W = Math.round(CANVAS_W * DISPLAY_SCALE);

export function ChartReelsSection() {
  const slotCounter = useRef(0);
  const [slots, setSlots] = useState<SlotState[]>([]);
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const slotsRef = useRef<SlotState[]>([]);
  slotsRef.current = slots;

  const canvasRefs = useRef(new Map<string, ChartsCanvasRef | null>());
  const activeSlot = slots.find(s => s.id === activeSlotId) ?? null;

  const [allArtists, setAllArtists] = useState<ChartsMarket[]>([]);
  // The S&P pseudo-market's last-used picker photo/frame — persisted like any artist's
  // (photo-prefs keyed by '__sp500__'), applied when creating new Profit reels.
  const sp500PrefRef = useRef<{ photo_url: string; frame: CircleFrame | null } | null>(null);
  const [artistsLoading, setArtistsLoading] = useState(false);
  const artistsLoadedRef = useRef(false);

  const [aiGroups, setAiGroups] = useState<AiGroup[]>([]);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const [preloadedAudios, setPreloadedAudios] = useState<PreloadedAudio[]>(
    CHARTS_AUDIO_TRACKS.map(t => ({ status: 'ready' as const, label: t.label, url: t.url, durationMs: t.durationMs })),
  );

  const [photoPickerSlot, setPhotoPickerSlot] = useState<0 | 1 | null>(null);
  const [photoPickerPhotos, setPhotoPickerPhotos] = useState<PickerPhoto[]>([]);
  const [photoPickerLoading, setPhotoPickerLoading] = useState(false);
  const [photoPickerMore, setPhotoPickerMore] = useState(false);
  const [photoPickerEnd, setPhotoPickerEnd] = useState(false);
  const [photoPickerQuery, setPhotoPickerQuery] = useState('');

  // "Frame photo" popup (circular crop) shown after picking a search image.
  const [framing, setFraming] = useState<null | { slotId: string; mIdx: 0 | 1; artistId: string | null; imageUrl: string | null; loading: boolean; error: string }>(null);
  const [captionDialogSlot, setCaptionDialogSlot] = useState<string | null>(null);
  const [frameDraft, setFrameDraft] = useState<CircleFrame>(DEFAULT_FRAME);

  const updateSlot = useCallback((id: string, updater: SlotUpdater) => {
    setSlots(prev => prev.map(s => {
      if (s.id !== id) return s;
      const patch = typeof updater === 'function' ? updater(s) : updater;
      return { ...s, ...patch };
    }));
  }, []);

  const addSlot = useCallback((g: AiGroup) => {
    // Prefer each artist's last-used photo (from the loaded catalogue) over the raw photo
    // the AI route returned, so AI-added reels respect the same per-artist preference.
    const withPref = (m: ChartsMarket) => {
      const found = allArtists.find(a => a.id === m.id);
      return found ? { ...m, photo_url: found.photo_url, frame: found.frame ?? null } : m;
    };
    const id = String(++slotCounter.current);
    setSlots(prev => [...prev, makeSlot(id, { ...g, a: withPref(g.a), b: withPref(g.b) })]);
    setActiveSlotId(id);
  }, [allArtists]);

  const addBlankSlot = useCallback((type: ReelType) => {
    const id = String(++slotCounter.current);
    const slot = makeSlot(id, undefined, type);
    // Profit reels are artist-vs-market: the second slot starts as the real S&P 500,
    // wearing the last picker photo you chose for it (falls back to the bundled logo).
    if (type === 'profit') {
      slot.markets = [null, {
        ...SP500_MARKET,
        photo_url: sp500PrefRef.current?.photo_url ?? SP500_MARKET.photo_url,
        frame: sp500PrefRef.current?.frame ?? null,
      }];
    }
    setSlots(prev => [...prev, slot]);
    setActiveSlotId(id);
  }, []);

  const removeSlot = useCallback((id: string) => {
    setSlots(prev => prev.filter(s => s.id !== id));
    setActiveSlotId(prev => {
      if (prev !== id) return prev;
      const remaining = slotsRef.current.filter(s => s.id !== id);
      return remaining[0]?.id ?? null;
    });
    canvasRefs.current.delete(id);
  }, []);

  const addedPairIds = new Set(
    slots.filter(s => s.markets[0] && s.markets[1]).map(s => `${s.markets[0]!.id}|${s.markets[1]!.id}`),
  );

  const ensureArtists = useCallback(async () => {
    if (artistsLoadedRef.current || artistsLoading) return;
    setArtistsLoading(true);
    try {
      const sb = getChartsClient();
      const { data, error } = await sb
        .from('artists_with_history')
        .select('spotify_id,artist_name,spotify_img')
        .not('current_index_value', 'is', null)
        .order('current_index_value', { ascending: false })
        // Load every indexed artist (~2.5k) so all are searchable in the picker — the
        // picker filters by query and caps the rendered list at 50, so this stays cheap.
        .limit(5000);
      if (error) throw new Error(error.message);
      // Last-used photo + framing per artist (falls back to the default Spotify photo).
      let prefs: Record<string, { photo_url: string; frame: CircleFrame | null }> = {};
      try {
        const r = await fetch('/api/charts/photo-prefs');
        if (r.ok) prefs = await r.json();
      } catch { /* prefs are best-effort */ }
      if (prefs[SP500_ID]) {
        const pref = { photo_url: prefs[SP500_ID].photo_url, frame: prefs[SP500_ID].frame ?? null };
        sp500PrefRef.current = pref;
        // Profit slots created before this fetch resolved froze the bundled logo into their
        // S&P market — retro-fit the stored pref (only over the untouched default, so a photo
        // picked mid-session is never clobbered).
        setSlots(prev => prev.map(s => {
          const i = s.markets.findIndex(m => m?.id === SP500_ID && m.photo_url === SP500_MARKET.photo_url);
          if (i === -1) return s;
          const markets = [...s.markets] as [ChartsMarket | null, ChartsMarket | null];
          markets[i] = { ...markets[i]!, photo_url: pref.photo_url, frame: pref.frame };
          return { ...s, markets };
        }));
      }
      const mapped: ChartsMarket[] = (data ?? []).map((row: { spotify_id: string; artist_name: string; spotify_img: string | null }) => ({
        id: row.spotify_id, name: row.artist_name, ticker: row.spotify_id,
        photo_url: prefs[row.spotify_id]?.photo_url ?? row.spotify_img,
        frame: prefs[row.spotify_id]?.frame ?? null,
        industry: null,
      }));
      setAllArtists(mapped);
      artistsLoadedRef.current = true;
    } catch (err) {
      console.error('Failed to load artists:', err);
    } finally {
      setArtistsLoading(false);
    }
  }, [artistsLoading]);

  useEffect(() => { ensureArtists(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchTrends = useCallback(async (slotId: string) => {
    const slot = slotsRef.current.find(s => s.id === slotId);
    if (!slot) return;
    const toFetch = ([0, 1] as const).filter(i => slot.markets[i]);
    if (!toFetch.length) return;
    updateSlot(slotId, { trendsLoading: [toFetch.includes(0), toFetch.includes(1)] as [boolean, boolean] });
    await Promise.all(toFetch.map(async (idx) => {
      const s = slotsRef.current.find(s => s.id === slotId);
      const market = s?.markets[idx];
      if (!market) return;
      const term = s?.overrideNames[idx] || market.name;
      try {
        const url = market.id === SP500_ID
          ? '/api/charts/spx' // real S&P 500 closes, not Google Trends
          : `/api/charts/trends?term=${encodeURIComponent(term)}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const points: { timestamp: number; value: number }[] = await res.json();
        updateSlot(slotId, prev => {
          const markets = [...prev.markets] as [ChartsMarket | null, ChartsMarket | null];
          if (markets[idx]) markets[idx] = { ...markets[idx]!, sparkline: points };
          const trendsLoaded = [...prev.trendsLoaded] as [boolean, boolean];
          trendsLoaded[idx] = true;
          return { markets, trendsLoaded };
        });
      } catch (err) { console.error(`Trends fetch failed for slot ${slotId}:`, err); }
    }));
    updateSlot(slotId, { trendsLoading: [false, false] as [boolean, boolean] });
  }, [updateSlot]);

  const suggestPairs = useCallback(async () => {
    setShowAiPanel(true);
    if (aiGroups.length > 0) return;
    setAiLoading(true);
    try {
      const res = await fetch('/api/ai/charts-groups');
      if (!res.ok) return;
      const { groups } = await res.json() as { groups: AiGroup[] };
      setAiGroups(groups ?? []);
    } catch (err) { console.error('AI suggest failed:', err); }
    finally { setAiLoading(false); }
  }, [aiGroups.length]);

  const fetchInstagramCaption = useCallback(async (slotId: string): Promise<string | null> => {
    const slot = slotsRef.current.find(s => s.id === slotId);
    if (!slot?.markets[0] || !slot?.markets[1]) return null;
    // Same builder the Get Caption dialog uses, so publish-time auto-generation matches it:
    // profit reels get the data-filled $100/mo-vs-S&P prompt; comparison reels get the
    // generic prompt + headline. Sent to the shared grounded-Gemini route.
    updateSlot(slotId, { instagramCaptionLoading: true, instagramCaption: '' });
    try {
      const res = await fetch('/api/posts/instagram/generate-caption', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: buildCaptionPrompt(slot) }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json() as { caption?: string };
      updateSlot(slotId, { instagramCaption: data.caption ?? '', instagramCaptionLoading: false });
      return data.caption ?? null;
    } catch { updateSlot(slotId, { instagramCaptionLoading: false }); return null; }
  }, [updateSlot]);

  // ── Instagram publishing (app-global Meta connection via InstagramConnectionProvider;
  // the provider's /me call also back-fills igUserId, which the publish route needs) ─────
  const { igUser, connect: connectInstagram } = useInstagramConnection();

  const publishToInstagram = useCallback(async (slotId: string) => {
    const slot = slotsRef.current.find(s => s.id === slotId);
    if (!slot || slot.recState.isRecording || slot.igPublish.busy) return;
    const setP = (patch: Partial<SlotState['igPublish']>) =>
      updateSlot(slotId, prev => ({ igPublish: { ...prev.igPublish, ...patch } }));
    // The render needs loaded chart data — fail fast with a real reason instead of letting
    // the export's silent guard surface as a bogus "render failed" (after a wasted AI call).
    if (!slot.markets.some(m => (m?.sparkline?.length ?? 0) > 0)) {
      setP({ error: 'Load the chart first (press Start), then publish.' });
      return;
    }
    setP({ busy: true, msg: 'Starting…', permalink: null, error: null });
    let blobUrl: string | null = null;
    try {
      // 1. Caption: use the editable IG caption; generate it if empty (title as last resort).
      let caption = slot.instagramCaption.trim();
      if (!caption) {
        setP({ msg: 'Writing caption…' });
        caption = (await fetchInstagramCaption(slotId)) ?? slot.caption;
      }
      caption = caption.slice(0, 2199); // IG caption limit

      // 2. Render the reel — the selected audio track is muxed in by the export.
      setP({ msg: 'Rendering video…' });
      const blob = await canvasRefs.current.get(slotId)?.exportBlob();
      if (!blob) throw new Error('Video render failed');
      // Instagram only ingests MP4/MOV — the MediaRecorder fallback on some browsers
      // produces WebM, which would fail minutes later inside IG with an opaque error.
      if (!blob.type.includes('mp4')) throw new Error("This browser can't export an Instagram-compatible MP4 — publish from Chrome or Edge.");

      // 3. Host it where Instagram's servers can fetch it (public Vercel Blob, as Video Reels).
      setP({ msg: 'Uploading…' });
      const filename = `chartreels-${slotId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
      const uploaded = await uploadToBlob(filename, blob, { access: 'public', handleUploadUrl: '/api/video-reels/upload' });
      blobUrl = uploaded.url;

      // 4. Publish: container create + IG-side processing + media_publish (can take minutes).
      // shareToFeed:false keeps it in the Reels tab only (no cross-post to the main feed grid),
      // matching the Video Reels upload flow.
      setP({ msg: 'Publishing… (can take a few minutes)' });
      const res = await fetch('/api/video-reels/meta/reels/publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: uploaded.url, caption, shareToFeed: false, idempotencyKey: filename }),
      });
      const data = await res.json().catch(() => ({})) as { permalink?: string; error?: string };
      if (!res.ok) throw new Error(data.error || `Publish failed (${res.status})`);
      setP({ busy: false, msg: 'Published ✓', permalink: data.permalink ?? null });
    } catch (err) {
      setP({ busy: false, msg: '', error: err instanceof Error ? err.message : String(err) });
    } finally {
      // Remove the temporary public copy (best-effort, success or failure).
      if (blobUrl) {
        fetch('/api/video-reels/storage/delete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: blobUrl }),
        }).catch(() => {});
      }
    }
  }, [updateSlot, fetchInstagramCaption]);

  const searchPickerPhotos = useCallback(async (query: string, offset: number, append: boolean) => {
    if (!query.trim()) return;
    if (append) setPhotoPickerMore(true); else { setPhotoPickerLoading(true); setPhotoPickerEnd(false); }
    try {
      const res = await fetch('/api/ai/photos/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, count: 9, offset }),
      });
      if (!res.ok) return;
      const photos: PickerPhoto[] = await res.json();
      if (append && photos.length === 0) setPhotoPickerEnd(true); // reached the end of results
      // Dedupe by URL — SerpAPI can return the same image twice, which would collide React keys.
      setPhotoPickerPhotos(prev => {
        const merged = append ? [...prev, ...photos] : photos;
        const seen = new Set<string>();
        return merged.filter(p => (seen.has(p.url) ? false : (seen.add(p.url), true)));
      });
    } catch { } finally { setPhotoPickerLoading(false); setPhotoPickerMore(false); }
  }, []);

  const openPhotoPicker = useCallback((idx: 0 | 1, query: string) => {
    // Pre-fill the search box with the artist's name but DON'T auto-search — searching
    // only on submit avoids spending a SerpAPI credit every time the picker opens.
    setPhotoPickerSlot(idx); setPhotoPickerPhotos([]); setPhotoPickerQuery(query); setPhotoPickerEnd(false);
  }, []);

  // Apply a (stored) photo + framing to a slot's market, mirror it into the in-memory
  // catalogue, and remember it as the artist's preference.
  const applyPhoto = useCallback((slotId: string, mIdx: 0 | 1, artistId: string | null, photoUrl: string, frame: CircleFrame | null) => {
    updateSlot(slotId, prev => {
      const markets = [...prev.markets] as [ChartsMarket | null, ChartsMarket | null];
      if (markets[mIdx]) markets[mIdx] = { ...markets[mIdx]!, photo_url: photoUrl, frame };
      return { markets };
    });
    if (artistId) {
      if (artistId === SP500_ID) sp500PrefRef.current = { photo_url: photoUrl, frame };
      setAllArtists(prev => prev.map(a => (a.id === artistId ? { ...a, photo_url: photoUrl, frame } : a)));
      fetch('/api/charts/photo-prefs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spotify_id: artistId, photo_url: photoUrl, frame }),
      }).catch(() => {});
    }
  }, [updateSlot]);

  const selectPickerPhoto = useCallback(async (url: string) => {
    if (photoPickerSlot === null || !activeSlotId) return;
    const mIdx = photoPickerSlot;
    const slotId = activeSlotId;
    const artistId = slotsRef.current.find(s => s.id === slotId)?.markets[mIdx]?.id ?? null;
    setPhotoPickerSlot(null);
    setFrameDraft(DEFAULT_FRAME);
    setFraming({ slotId, mIdx, artistId, imageUrl: null, loading: true, error: '' });
    try {
      // Download + store our own copy (reliable, CORS-clean for the canvas + export).
      const res = await fetch('/api/photos/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'save failed');
      // Apply immediately with default framing; the popup lets the user fine-tune.
      applyPhoto(slotId, mIdx, artistId, data.url, DEFAULT_FRAME);
      setFraming(f => (f ? { ...f, imageUrl: data.url, loading: false } : f));
    } catch {
      setFraming(f => (f ? { ...f, loading: false, error: 'Could not load that image — pick another.' } : f));
    }
  }, [photoPickerSlot, activeSlotId, applyPhoto]);

  const saveFraming = useCallback(() => {
    if (framing?.imageUrl) applyPhoto(framing.slotId, framing.mIdx, framing.artistId, framing.imageUrl, frameDraft);
    setFraming(null);
  }, [framing, frameDraft, applyPhoto]);

  const handleUpdateMarket = useCallback((idx: 0 | 1, market: ChartsMarket | null) => {
    if (!activeSlotId) return;
    updateSlot(activeSlotId, prev => {
      const markets = [...prev.markets] as [ChartsMarket | null, ChartsMarket | null];
      markets[idx] = market;
      const trendsLoaded = [...prev.trendsLoaded] as [boolean, boolean];
      if (!market) trendsLoaded[idx] = false;
      const a = markets[0], b = markets[1];
      const caption = a && b ? defaultCaption(prev.reelType, prev.overrideNames[0] || a.name, prev.overrideNames[1] || b.name) : prev.caption;
      // Profit reels also auto-fill the banner from the artist (slot A).
      const banner = prev.reelType === 'profit' && a ? { bannerText: defaultBannerText(prev.reelType, prev.overrideNames[0] || a.name) } : {};
      return { markets, trendsLoaded, ...(a && b ? { caption } : {}), ...banner };
    });
  }, [activeSlotId, updateSlot]);

  const handleUpdateOverrideName = useCallback((idx: 0 | 1, name: string) => {
    if (!activeSlotId) return;
    updateSlot(activeSlotId, prev => {
      const overrideNames = [...prev.overrideNames] as [string, string];
      overrideNames[idx] = name;
      const a = prev.markets[0], b = prev.markets[1];
      const nameA = idx === 0 ? name : overrideNames[0];
      const nameB = idx === 1 ? name : overrideNames[1];
      const caption = a && b ? defaultCaption(prev.reelType, nameA || a.name, nameB || b.name) : prev.caption;
      // Profit reels also re-fill the banner from the artist (slot A) name.
      const banner = prev.reelType === 'profit' && a ? { bannerText: defaultBannerText(prev.reelType, nameA || a.name) } : {};
      return { overrideNames, ...(a && b ? { caption } : {}), ...banner };
    });
  }, [activeSlotId, updateSlot]);

  return (
    <div className="flex h-screen overflow-hidden">

      {/* Photo picker modal */}
      {photoPickerSlot !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setPhotoPickerSlot(null)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-[520px] max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
              <span className="text-sm font-semibold text-zinc-200">Change Photo</span>
              <button type="button" onClick={() => setPhotoPickerSlot(null)} className="text-zinc-500 hover:text-zinc-300 transition-colors"><CloseIcon size={14} /></button>
            </div>
            <div className="px-3 py-2 border-b border-zinc-800 flex gap-2 shrink-0">
              <input value={photoPickerQuery} onChange={e => setPhotoPickerQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') searchPickerPhotos(photoPickerQuery, 0, false); }}
                placeholder="Search photos…"
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500" />
              <button type="button" onClick={() => searchPickerPhotos(photoPickerQuery, 0, false)}
                disabled={photoPickerLoading || !photoPickerQuery.trim()}
                className="px-3 py-1.5 rounded-md text-xs font-semibold bg-zinc-700 text-zinc-200 hover:bg-zinc-600 disabled:opacity-40 transition-colors">
                Search
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {photoPickerLoading && photoPickerPhotos.length === 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {Array.from({ length: 9 }).map((_, i) => <div key={i} className="aspect-square bg-zinc-800 rounded-lg animate-pulse" />)}
                </div>
              ) : photoPickerPhotos.length === 0 ? (
                <p className="text-xs text-zinc-600 text-center py-8">Search for a photo above.</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {photoPickerPhotos.map((p, i) => (
                      <button key={p.url} type="button" onClick={() => selectPickerPhoto(p.url)} className="aspect-square rounded-lg overflow-hidden bg-zinc-800 hover:ring-2 hover:ring-white/40 transition-all">
                        {/* Load via the proxy so what's shown is actually usable; drop tiles that fail. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/photos/proxy?url=${encodeURIComponent(p.url)}`} alt={p.title ?? ''} className="w-full h-full object-cover"
                          onError={() => setPhotoPickerPhotos(prev => prev.filter(x => x.url !== p.url))} />
                      </button>
                    ))}
                  </div>
                  {!photoPickerEnd && (
                    <button type="button" onClick={() => searchPickerPhotos(photoPickerQuery, photoPickerPhotos.length, true)}
                      disabled={photoPickerMore}
                      className="w-full mt-3 py-2 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 transition-colors">
                      {photoPickerMore ? 'Loading…' : 'Load More'}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showAiPanel && (
        <AiPairsPanel groups={aiGroups} loading={aiLoading} addedIds={addedPairIds} onAdd={addSlot} onClose={() => setShowAiPanel(false)} />
      )}

      {framing && (
        <FramePopup
          imageUrl={framing.imageUrl}
          loading={framing.loading}
          error={framing.error}
          frame={frameDraft}
          onChange={setFrameDraft}
          onSave={saveFraming}
          onCancel={() => setFraming(null)}
        />
      )}

      {captionDialogSlot && (() => {
        const slot = slots.find(s => s.id === captionDialogSlot);
        if (!slot) return null;
        return (
          <ChartsCaptionDialog
            caption={slot.instagramCaption}
            initialPrompt={buildCaptionPrompt(slot)}
            onCaptionChange={v => updateSlot(slot.id, { instagramCaption: v })}
            onClose={() => setCaptionDialogSlot(null)}
          />
        );
      })()}

      {/* Left panel */}
      <div className="w-[450px] shrink-0 flex flex-col gap-4 p-4 overflow-y-auto border-r border-zinc-800 bg-zinc-950">
        <div className="flex items-center justify-between shrink-0">
          <h2 className="text-sm font-semibold text-zinc-200">Chart Reels</h2>
          {activeSlot && (
            <span className="text-[10px] text-zinc-600 truncate max-w-[200px]">
              {[activeSlot.overrideNames[0] || activeSlot.markets[0]?.name, activeSlot.overrideNames[1] || activeSlot.markets[1]?.name].filter(Boolean).join(' vs ') || 'New reel'}
            </span>
          )}
        </div>

        {activeSlot ? (
          <ChartsInputCard
            caption={activeSlot.caption}
            onUpdateCaption={v => updateSlot(activeSlot.id, { caption: v })}
            captionFontSize={activeSlot.captionFontSize ?? 22 /* slots predating the field (hot-reload state) */}
            onUpdateCaptionFontSize={v => updateSlot(activeSlot.id, { captionFontSize: v })}
            bannerText={activeSlot.bannerText}
            onUpdateBannerText={v => updateSlot(activeSlot.id, { bannerText: v })}
            bannerFontSize={activeSlot.bannerFontSize}
            onUpdateBannerFontSize={v => updateSlot(activeSlot.id, { bannerFontSize: v })}
            videoLengthSec={activeSlot.videoLengthSec}
            smoothing={activeSlot.smoothing ?? 30 /* slots predating the field (hot-reload state) */}
            onUpdateSmoothing={v => updateSlot(activeSlot.id, { smoothing: v })}
            artistMultiplier={activeSlot.artistMultiplier ?? 1}
            onUpdateArtistMultiplier={v => updateSlot(activeSlot.id, { artistMultiplier: v })}
            showArtistMultiplier={activeSlot.reelType === 'profit'}
            profitCumulative={activeSlot.profitCumulative ?? true}
            onUpdateProfitCumulative={v => updateSlot(activeSlot.id, { profitCumulative: v })}
            onUpdateVideoLengthSec={v => updateSlot(activeSlot.id, { videoLengthSec: v })}
            markets={activeSlot.markets}
            onUpdateMarket={handleUpdateMarket}
            allMarkets={allArtists}
            marketsLoading={artistsLoading}
            onEnsureMarkets={ensureArtists}
            overrideNames={activeSlot.overrideNames}
            onUpdateOverrideName={handleUpdateOverrideName}
            anyLoading={activeSlot.trendsLoading[0] || activeSlot.trendsLoading[1]}
            trendsLoaded={activeSlot.trendsLoaded}
            onStart={() => fetchTrends(activeSlot.id)}
            onOpenPhotoPicker={openPhotoPicker}
            onSuggestPairs={suggestPairs}
            preloadedAudios={preloadedAudios}
            audioTrack={activeSlot.audioTrack}
            onSelectAudioTrack={track => updateSlot(activeSlot.id, { audioTrack: track, videoLengthSec: trackSeconds(track.durationMs) })}
            onClearAudioTrack={() => updateSlot(activeSlot.id, prev => ({
              audioTrack: null,
              // Drop the auto-filled length with the track; keep it if the user edited it.
              ...(prev.audioTrack && prev.videoLengthSec === trackSeconds(prev.audioTrack.durationMs) ? { videoLengthSec: null } : {}),
            }))}
            onDeleteAudio={idx => {
              setPreloadedAudios(prev => {
                const removed = prev[idx];
                if (removed?.status === 'ready' && activeSlot.audioTrack?.url === removed.url)
                  updateSlot(activeSlot.id, p => ({
                    audioTrack: null,
                    ...(p.audioTrack && p.videoLengthSec === trackSeconds(p.audioTrack.durationMs) ? { videoLengthSec: null } : {}),
                  }));
                return prev.filter((_, i) => i !== idx);
              });
            }}
            onAddAudio={track => setPreloadedAudios(prev => [...prev, { status: 'ready' as const, ...track }])}
            onRenameAudio={(idx, label) => setPreloadedAudios(prev => prev.map((a, i) => i === idx && a.status === 'ready' ? { ...a, label } : a))}
          />
        ) : (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-zinc-500">No reels yet.</p>
            {REEL_TYPES.map(t => (
              <button key={t} type="button" onClick={() => addBlankSlot(t)}
                className="w-56 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-white/10 border border-white/20 text-white hover:bg-white/20 transition-colors">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                {REEL_TYPE_LABELS[t]}
              </button>
            ))}
            <button type="button" onClick={suggestPairs}
              className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
              or let AI suggest pairs
            </button>
          </div>
        )}
      </div>

      {/* Canvas area */}
      <div className="flex-1 overflow-auto bg-zinc-900 p-4">
        {slots.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center flex flex-col items-center gap-3">
              <p className="text-zinc-600 text-sm">Create a reel and pick your artists</p>
              <div className="flex flex-col items-center gap-2">
                {REEL_TYPES.map(t => (
                  <button key={t} type="button" onClick={() => addBlankSlot(t)}
                    className="w-56 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-white/10 border border-white/20 text-white hover:bg-white/20 transition-colors">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    {REEL_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
              <button type="button" onClick={suggestPairs}
                className="flex items-center gap-1.5 text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
                or let AI suggest pairs
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-4 items-start">
            {slots.map(slot => (
              <div key={slot.id}
                className={`flex-shrink-0 flex flex-col gap-2 rounded-xl p-2 cursor-pointer transition-all ${activeSlotId === slot.id ? 'ring-2 ring-white/20 bg-zinc-800/40' : 'hover:bg-zinc-800/20'}`}
                style={{ width: CANVAS_CARD_W + 16 }}
                onClick={() => setActiveSlotId(slot.id)}
              >
                {/* Canvas */}
                <div className="relative">
                  <ChartsCanvas
                    ref={(el: ChartsCanvasRef | null) => { if (el) canvasRefs.current.set(slot.id, el); else canvasRefs.current.delete(slot.id); }}
                    overlayCaption={slot.caption}
                    bannerText={slot.bannerText}
                    bannerFontSize={slot.bannerFontSize}
                    markets={slot.markets}
                    overrideNames={slot.overrideNames}
                    onRecordingStateChange={state => updateSlot(slot.id, { recState: state })}
                    audioUrl={slot.audioTrack?.url}
                    audioDurationMs={slot.audioTrack?.durationMs}
                    videoLengthMs={slot.videoLengthSec ? slot.videoLengthSec * 1000 : undefined}
                    smoothing={slot.smoothing ?? 30}
                    reelType={slot.reelType}
                    artistMultiplier={slot.artistMultiplier ?? 1}
                    profitCumulative={slot.profitCumulative ?? true}
                    captionFontSize={slot.captionFontSize ?? 22}
                  />
                  <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-zinc-900/80 border border-zinc-700 text-[9px] text-zinc-400 pointer-events-none">
                    {REEL_TYPE_LABELS[slot.reelType]}
                  </span>
                  <button type="button" onClick={e => { e.stopPropagation(); removeSlot(slot.id); }}
                    className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-zinc-900/80 border border-zinc-700 flex items-center justify-center text-zinc-500 hover:text-white hover:bg-zinc-700 transition-colors"
                    title="Remove reel">
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>

                {/* Play / Export */}
                <div className="flex gap-2">
                  <button type="button"
                    onClick={e => { e.stopPropagation(); canvasRefs.current.get(slot.id)?.replay(); }}
                    disabled={slot.recState.isRecording || slot.igPublish.busy || (!slot.markets[0] && !slot.markets[1])}
                    title="Play from the start"
                    className="shrink-0 px-3.5 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-zinc-300 hover:bg-zinc-700/60 hover:text-white disabled:opacity-40 transition-colors">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                  </button>
                  <button type="button"
                    onClick={e => { e.stopPropagation(); canvasRefs.current.get(slot.id)?.startDownload(); }}
                    disabled={slot.recState.isRecording || slot.igPublish.busy || (!slot.markets[0] && !slot.markets[1])}
                    className="flex-1 py-2 rounded-lg text-[11px] font-semibold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors">
                    {slot.recState.isRecording
                      ? `${slot.recState.recStatus || 'Rendering…'} ${Math.round(slot.recState.recProgress * 100)}%`
                      : 'Export Reel'}
                  </button>
                </div>

                {/* Publish to Instagram */}
                <div onClick={e => e.stopPropagation()}>
                  {/* Keep the publish UI mounted while busy / showing a result, even if the
                      connection state transiently drops (e.g. a flaky /me refresh). */}
                  {igUser || slot.igPublish.busy || slot.igPublish.msg || slot.igPublish.error ? (
                    <>
                      <button type="button"
                        onClick={() => publishToInstagram(slot.id)}
                        disabled={!igUser || slot.igPublish.busy || slot.recState.isRecording || (!slot.markets[0] && !slot.markets[1])}
                        className="w-full py-2 rounded-lg text-[11px] font-semibold bg-fuchsia-500/10 border border-fuchsia-500/30 text-fuchsia-300 hover:bg-fuchsia-500/20 disabled:opacity-40 transition-colors">
                        {slot.igPublish.busy ? slot.igPublish.msg
                          : slot.igPublish.msg === 'Published ✓' ? 'Published ✓ · Publish again'
                          : igUser ? `Publish to @${igUser.username}` : 'Publish'}
                      </button>
                      {slot.igPublish.permalink && (
                        <a href={slot.igPublish.permalink} target="_blank" rel="noreferrer"
                          className="block mt-1 text-center text-[10px] text-fuchsia-300/80 hover:text-fuchsia-200 underline underline-offset-2">
                          View on Instagram ↗
                        </a>
                      )}
                      {slot.igPublish.error && (
                        <p className="mt-1 text-[10px] text-red-400 leading-snug">{slot.igPublish.error}</p>
                      )}
                    </>
                  ) : (
                    <button type="button" onClick={connectInstagram}
                      className="w-full py-1.5 rounded-lg text-[11px] font-medium bg-zinc-800/60 border border-zinc-700/60 text-zinc-400 hover:bg-zinc-700/60 hover:text-zinc-200 transition-colors">
                      Connect Instagram to publish
                    </button>
                  )}
                </div>

                {/* Instagram caption */}
                <div onClick={e => e.stopPropagation()}>
                  {slot.instagramCaptionLoading ? (
                    <div className="flex items-center justify-center gap-2 py-2 text-[11px] text-zinc-500">
                      <svg className="animate-spin w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      Getting caption…
                    </div>
                  ) : slot.instagramCaption ? (
                    <div className="flex flex-col gap-1">
                      <textarea value={slot.instagramCaption}
                        onChange={e => updateSlot(slot.id, { instagramCaption: e.target.value })}
                        rows={4} onClick={e => e.stopPropagation()}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-2 text-[11px] text-zinc-400 outline-none resize-none leading-relaxed focus:border-zinc-700" />
                      <button type="button" onClick={() => setCaptionDialogSlot(slot.id)}
                        className="self-end text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">
                        ↺ regenerate
                      </button>
                    </div>
                  ) : (
                    <button type="button"
                      disabled={!slot.markets[0] || !slot.markets[1]}
                      onClick={() => setCaptionDialogSlot(slot.id)}
                      className="w-full py-1.5 rounded-lg text-[11px] font-medium bg-zinc-800/60 border border-zinc-700/60 text-zinc-400 hover:bg-zinc-700/60 hover:text-zinc-200 disabled:opacity-30 transition-colors">
                      Get Caption
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Add more */}
            <div className="flex-shrink-0 flex flex-col gap-1.5">
              {REEL_TYPES.map(t => (
                <button key={t} type="button" onClick={() => addBlankSlot(t)}
                  style={{ width: 124, height: 32 }}
                  className="rounded-lg border border-dashed border-zinc-700 flex items-center justify-center gap-1 text-zinc-600 hover:border-zinc-500 hover:text-zinc-400 transition-colors">
                  <span className="text-xs leading-none">+</span>
                  <span className="text-[9px]">{REEL_TYPE_LABELS[t]}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
