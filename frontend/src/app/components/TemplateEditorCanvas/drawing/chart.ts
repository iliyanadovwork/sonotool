// ── Native canvas renderer for the "chart" element ──────────────────────────────────────────
// Faithful 2D-canvas port of the Sonotrade mobile price chart (frontend-expo artist screen):
// header block (avatar + name, "<price> points", ▲ change% + $diff), 5 hairline dashed
// gridlines with y-axis prices in a right gutter, the price line (or synthetic candles),
// release album-art markers in a band below the bottom gridline, pulse halo on the live dot.
// Static (no animation/hover). All sizes scale by k = H / design height, so any box size keeps
// the design; the line area stretches horizontally (panoramic 500-wide design vs the app's 390).

import type { ChartBox, ChartPeriod } from '../../templateEditorTypes';
import { RollingNumber } from './rollingNumber';

const DAY = 86_400_000;
const PERIOD_MS: Record<ChartPeriod, number> = {
  '1D': DAY, '1W': 7 * DAY, '1M': 30 * DAY, '3M': 90 * DAY,
  '6M': 180 * DAY, '1Y': 365 * DAY, 'ALL': Infinity,
};
// Height of the header block (avatar+name 36+4, price row 8+38, change row 4+25, chart margin 20)
// in design units — measured from the app's StyleSheet.
const HEADER_H = 132;
// Design width — matches the app (390): boxes created/refit at this aspect render the header
// and chart with the exact proportions of the mobile artist screen.
const MOBILE_W = 390;
const CHART_AREA_H = 270;   // 240 line area + 30 marker band (the app's chart view height)
const NAMES_H = 18;         // extra design height for the release-name row beneath the markers
const XDATES_H = 16;        // extra design height for the x-axis date ticks along the bottom
const MONTHS_CAPS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const POS_DEFAULT = '#04df9d';
const NEG_DEFAULT = '#FF4B4B';
const MARKER_BG = '#27272a';
// Platform icons after the artist name — exact SVG paths + sizes from the site's profile header
// (SXProfileHeader), scaled down a step from the site's 18/18/20: Spotify 16, Apple Music 16,
// YouTube 18, all in --st-secondary with a 10px gap.
const PLATFORM_ICON_COLOR = '#808080';
const PLATFORM_ICONS: { size: number; d: string }[] = [
  { size: 16, d: 'M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z' },
  { size: 16, d: 'M23.994 6.124a9.23 9.23 0 0 0-.24-2.19c-.317-1.31-1.062-2.31-2.18-3.043a5.022 5.022 0 0 0-1.877-.726 10.496 10.496 0 0 0-1.564-.15c-.04-.003-.083-.01-.124-.013H5.986c-.152.01-.303.017-.455.026-.747.043-1.49.123-2.193.4-1.336.53-2.3 1.452-2.865 2.78-.192.448-.292.925-.363 1.408a10.61 10.61 0 0 0-.1 1.18c0 .032-.007.062-.01.093v12.223c.01.14.017.283.027.424.05.815.154 1.624.497 2.373.65 1.42 1.738 2.353 3.234 2.801.42.127.856.187 1.293.228.555.053 1.11.06 1.667.06h11.03a12.5 12.5 0 0 0 1.57-.1c.822-.106 1.596-.35 2.296-.81a5.046 5.046 0 0 0 1.88-2.207c.186-.42.293-.87.37-1.324.113-.675.138-1.358.137-2.04-.002-3.8 0-7.595-.003-11.393zm-6.423 3.99v5.712c0 .417-.058.827-.244 1.206-.29.59-.76.962-1.388 1.14-.35.1-.706.157-1.07.173-.95.045-1.773-.6-1.943-1.536a1.88 1.88 0 0 1 1.038-2.022c.323-.16.67-.25 1.018-.324.378-.082.758-.153 1.134-.24.274-.063.457-.23.51-.516a.904.904 0 0 0 .02-.193c0-1.815 0-3.63-.002-5.443a.725.725 0 0 0-.026-.185c-.04-.15-.15-.243-.304-.234-.16.01-.318.035-.475.066l-5.597 1.09c-.306.06-.43.197-.437.516v7.37c0 .38-.05.753-.203 1.103-.28.64-.77 1.04-1.434 1.233-.365.106-.742.16-1.123.18-.96.05-1.79-.593-1.96-1.53a1.88 1.88 0 0 1 1.048-2.025c.355-.177.735-.267 1.117-.344.27-.055.54-.102.808-.16.39-.084.594-.292.615-.696.004-.08 0-.16 0-.24V5.992c0-.564.15-.915.57-1.04 1.914-.568 3.83-1.132 5.744-1.697.582-.172 1.164-.345 1.746-.516.47-.14.69-.01.69.478v5.896z' },
  { size: 18, d: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z' },
];
// The Sonotrade glyph+wordmark (white PNG, served from /public) drawn as the chart watermark.
// The -full asset is the native 5613px source: the chart pre-minifies it per render scale, and
// the 4x PNG export needs more pixels than the reels-tuned 420px /sonotrade-wordmark.png has.
export const WATERMARK_URL = '/sonotrade-wordmark-full.png';

// Crisp minification: the logo source is 5613px wide and lands at ~80–650 device px, far past the
// quality range of a single drawImage. Downscale by progressive halving into a cached canvas at
// the exact device-pixel size, so the watermark renders from (near-)native taps, not a crunchy
// one-shot resample. Cached per target width (preview / export scales differ).
const wmScaledCache = new Map<number, HTMLCanvasElement>();
function scaledWatermark(img: HTMLImageElement, targetW: number): HTMLCanvasElement | null {
  const key = Math.max(16, Math.round(targetW));
  const hit = wmScaledCache.get(key);
  if (hit) return hit;
  let sw = img.naturalWidth, sh = img.naturalHeight;
  let src: HTMLImageElement | HTMLCanvasElement = img;
  while (sw / 2 > key) {
    const half = document.createElement('canvas');
    half.width = Math.max(1, Math.round(sw / 2));
    half.height = Math.max(1, Math.round(sh / 2));
    const hctx = half.getContext('2d');
    if (!hctx) return null;
    hctx.imageSmoothingEnabled = true;
    hctx.imageSmoothingQuality = 'high';
    hctx.drawImage(src, 0, 0, half.width, half.height);
    src = half; sw = half.width; sh = half.height;
  }
  const out = document.createElement('canvas');
  out.width = key;
  out.height = Math.max(1, Math.round(key * (img.naturalHeight / img.naturalWidth)));
  const octx = out.getContext('2d');
  if (!octx) return null;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(src, 0, 0, out.width, out.height);
  wmScaledCache.set(key, out);
  return out;
}

// Draw an image cover-cropped into a destination rect (like CSS object-cover / RN resizeMode
// 'cover'): scale to fill, centre, and crop the overflow — never squeeze the aspect ratio.
function drawImageCover(
  ctx: CanvasRenderingContext2D, img: HTMLImageElement,
  dx: number, dy: number, dw: number, dh: number,
): void {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const scale = Math.max(dw / iw, dh / ih);
  const sw = dw / scale, sh = dh / scale;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, dx, dy, dw, dh);
}

// ── Animation timeline (ms) — mirrors the site, with a 4s spark cadence ──
export const CHART_ANIM_TOTAL_MS = 20_000;  // exported video length; the editor preview loops on this
const DRAW_MS = 1500;          // line draw-on, cubic ease-in-out (site: 1s ease-out; ours 1.5s in-out)
const PULSE_MS = 900;          // live-dot pulse loop (site: 0.9s, scale 1→3.2, opacity 0.8→0)
const SPARK_START_MS = DRAW_MS + 3000;  // first spark 3s after the draw completes
const SPARK_EVERY_MS = 4000;   // then every 4s
const SPARK_TRAVEL_MS = 533;   // the glint crosses the line 50% faster than the site's 0.8s
const SPARK_LEN = 60;          // glint length in design units (site: 60px dash)
// Inter — the chart's text face (400 + 600); the system stack fills in until it loads
// (ensureChartFont below).
const FONT = '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
// The 'web' (Desktop) layout is the pre-Aug-4 panoramic design (commit 1688628 narrowed it to the
// app's 390 — "mobile-faithful styling"): the same chart stretched to a 500-wide design, so at any
// height the box is ~28% wider, with the bigger header text (name 24 / price 32 / change 14, no
// platform icons, no tracking) and a TIME-scaled x axis. Everything else is shared.
const DESKTOP_W = 500;

// Load Inter (Google Fonts) once on the client and invoke onReady when the faces are usable —
// the caller redraws so chart text snaps from the fallback to Inter.
let chartFontRequested = false;
export function ensureChartFont(onReady?: () => void): void {
  if (typeof document === 'undefined') return;
  if (!chartFontRequested) {
    chartFontRequested = true;
    if (!document.getElementById('chart-font')) {
      const l = document.createElement('link');
      l.id = 'chart-font';
      l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap';
      document.head.appendChild(l);
    }
  }
  Promise.all([
    document.fonts.load('400 24px Inter'),
    document.fonts.load('600 24px Inter'),
  ]).then(() => { onReady?.(); }).catch(() => { /* fallback stack stays */ });
}

type Pt = { x: number; y: number; price: number; t: number };

// Fixed design aspect — chart boxes resize locked to this ratio. The header, the release-name
// row, and the x-axis date row each extend the design height in BOTH layouts; the layouts differ
// only in design width (mobile 390 = the app; web 500 = the pre-Aug-4 panoramic stretch).
export function chartAspect(withHeader?: boolean, withNames?: boolean, withXDates?: boolean, layout?: 'mobile' | 'web'): number {
  const w = layout === 'web' ? DESKTOP_W : MOBILE_W;
  return w / (CHART_AREA_H + (withHeader ? HEADER_H : 0) + (withNames ? NAMES_H : 0) + (withXDates ? XDATES_H : 0));
}

// All image URLs a chart draws (release album art + the header avatar) — for preloading into the
// shared box-image cache and gating export readiness.
export function chartImageUrls(box: ChartBox): string[] {
  const urls: string[] = [];
  if (box.showReleases !== false) for (const r of box.releases ?? []) if (r.image) urls.push(r.image);
  if (box.showHeader !== false && box.artistImage) urls.push(box.artistImage);
  if (box.showWatermark !== false) urls.push(WATERMARK_URL);
  return urls;
}

// Per-chart-box rolling-number state (NumberFlow-style odometer for the header price). The
// spring integrates across frames: the preview steps it with real frame deltas, the exporter
// with fixed per-frame dt from a reset instance — deterministic either way. lastT detects the
// 20s loop/export restart (t goes backwards) and resets the reels.
const rollers = new Map<string, { rn: RollingNumber; lastT: number }>();

// Cubic ease-in-out — slow start, fast middle, slow landing.
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function rand(seed: number): number {
  const x = Math.sin(seed + 1) * 43758.5453123;
  return x - Math.floor(x);
}
function interp(points: Pt[], frac: number) {
  const raw = frac * (points.length - 1);
  const lo = Math.floor(raw);
  const hi = Math.min(lo + 1, points.length - 1);
  const t = raw - lo;
  return { price: points[lo].price * (1 - t) + points[hi].price * t };
}

/**
 * Draw a chart box into ctx. `sc` is the export scale (canvas.width / W); this function isolates
 * its own translate+scale so it draws in box-local px. `releaseImgs` maps an image URL → a loaded
 * HTMLImageElement; the avatar/markers fall back to dark circles until their art loads.
 * `animT` (ms into the 20s timeline) renders that animation frame: line draw-on (0–1.5s, cubic
 * ease-in-out) with the header price rolling along the draw head, live-dot pulse (0.9s loop
 * after the draw), spark glint (first 3s after the draw, then every 4s).
 * Omitted/null → the static final state.
 */
export function drawChart(
  ctx: CanvasRenderingContext2D,
  box: ChartBox,
  sc: number,
  releaseImgs?: Map<string, HTMLImageElement>,
  animT?: number | null,
): void {
  const W = box.width, H = box.height;
  if (W < 8 || H < 8) return;

  // Layout: 'mobile' (default) is the app's artist screen (390 design); 'web' (Desktop) is the
  // pre-Aug-4 panoramic variant — the SAME design stretched to 500 wide (the stretch lives in the
  // box aspect; k is height-driven, so header/text sizes stay put while the line area widens),
  // with the era's bigger header text and a TIME-scaled x axis.
  const web = box.layout === 'web';
  const header = box.showHeader !== false;
  const showNames = box.showReleases !== false && box.showReleaseNames === true;
  const showDates = box.showReleases !== false && box.showReleaseDates === true;
  const showXDates = box.showXDates !== false;
  const showWatermark = box.showWatermark !== false;
  const k = H / (CHART_AREA_H + (header ? HEADER_H : 0) + (showNames ? NAMES_H : 0) + (showXDates ? XDATES_H : 0));

  const showGrid = box.showGrid !== false;
  const showReleases = box.showReleases !== false;
  const showLastDot = box.showLastDot !== false;
  const fillArea = box.fillArea === true;     // off by default (the app has no fill)
  const posColor = box.positiveColor || POS_DEFAULT;
  const negColor = box.negativeColor || NEG_DEFAULT;
  const labelColor = box.labelColor || '#71717a';

  // The line area is the top 240 of the 270 chart design (30 reserved for markers), padded 40
  // top+bottom. The app has no y-axis numbers and only a 24 right margin; since we DO show
  // prices, reserve a 56 gutter for them so the labels get their own column. Grid off → app-pure.
  const lineAreaH = 240 * k;
  const padTop = 40 * k;
  const padBot = 40 * k;
  const plotH = Math.max(1, lineAreaH - padTop - padBot);
  const chartW = Math.max(1, W - (showGrid ? 56 : 24) * k);
  const markerR = 10 * k;
  const markerY = 255 * k;
  const lineW = 2.5 * k;
  const chartFont = FONT;   // Inter in both layouts (it predates the Aug-4 restyle)

  // ── Normalize + window the series (snapshot "now" = last point, so it's stable) ──
  const all = (box.data ?? [])
    .map(p => ({ t: new Date(p.timestamp).getTime(), price: typeof p.index === 'number' ? p.index : parseFloat(String(p.index)) }))
    .filter(p => isFinite(p.t) && isFinite(p.price))
    .sort((a, b) => a.t - b.t);
  if (all.length < 2) return;

  const nowT = all[all.length - 1].t;
  // Window START: a chosen release (1 week of run-up before it) overrides the period; otherwise a
  // rolling period window — counted back from the custom end when one is set, else from data end.
  // Invalid/out-of-range anchors fall back to ALL.
  const releaseT = box.sinceRelease ? new Date(box.sinceRelease).getTime() : NaN;
  const customEndT = box.endMode === 'custom' && box.endDate ? new Date(box.endDate).getTime() : NaN;
  const endRef = isFinite(customEndT) ? customEndT : nowT;
  // An explicit startDate outranks both the release anchor and the rolling period,
  // so any arbitrary range can be shown — the reason it exists is to start a window
  // AFTER a data outage, which no fixed period can express.
  const customStartT = box.startDate ? new Date(box.startDate).getTime() : NaN;
  const cutoff = isFinite(customStartT) ? customStartT
    : isFinite(releaseT) ? releaseT - 7 * DAY
    : endRef - PERIOD_MS[box.period];
  let win: { t: number; price: number }[];
  if ((!isFinite(customStartT) && !isFinite(releaseT) && box.period === 'ALL') || cutoff < all[0].t) {
    win = all;
  } else {
    const inWin = all.filter(d => d.t >= cutoff);
    const before = [...all].reverse().find(d => d.t < cutoff);
    // The synthetic edge point exists so the line starts AT the window edge when the
    // first real sample falls after it. Two cases where adding it is wrong:
    //   1. a real sample already sits on the cutoff — prepending duplicates the x and
    //      draws a vertical stroke between two prices on the same date;
    //   2. the previous sample is days old (a data outage), so carrying its price
    //      forward to the edge invents a value for time nobody measured.
    // Both produced a fake vertical rise at the start of a window pinned just after
    // the index backend's 2026-06-13..08-03 outage.
    const CARRY_MAX_MS = 2 * DAY;
    const startsOnCutoff = inWin.length > 0 && inWin[0].t - cutoff < DAY / 2;
    const carryIsFresh = !!before && cutoff - before.t <= CARRY_MAX_MS;
    win = before && !startsOnCutoff && carryIsFresh
      ? [{ t: cutoff, price: before.price }, ...inWin]
      : inWin;
  }
  if (win.length < 2) win = all;
  // Window END: a custom date clips the series; lowest/highest ends it at the extremum AFTER the
  // start point. Degenerate results (< 2 points) fall back to the un-clipped window.
  if (box.endMode) {
    let clipped = win;
    if (isFinite(customEndT)) {
      clipped = win.filter(d => d.t <= customEndT);
    } else if (box.endMode === 'lowest' || box.endMode === 'highest') {
      let bestIdx = -1;
      let best = box.endMode === 'lowest' ? Infinity : -Infinity;
      for (let i = 1; i < win.length; i++) {   // i=1: strictly after the start point
        const p = win[i].price;
        if (box.endMode === 'lowest' ? p < best : p > best) { best = p; bestIdx = i; }
      }
      if (bestIdx >= 1) clipped = win.slice(0, bestIdx + 1);
    }
    if (clipped.length >= 2) win = clipped;
  }

  const startT = win[0].t;
  const endT = win[win.length - 1].t;
  let minP = Infinity, maxP = -Infinity;
  for (const d of win) { if (d.price < minP) minP = d.price; if (d.price > maxP) maxP = d.price; }
  const priceRange = maxP === minP ? 1 : maxP - minP;

  // MOBILE x axis is INDEX-scaled, not time-scaled: every point sits an equal step from the next,
  // so gaps in the data (a quiet week) don't stretch into long flat segments. Timestamps that fall
  // between points (release markers, date ticks) interpolate between their neighbours' slots.
  // WEB is era-faithful to the pre-c6f4f96 desktop chart: TIME-scaled — x is proportional to the
  // timestamp, so quiet stretches draw long and flat, exactly like the site (and the old renders).
  const lastIdx = win.length - 1;
  const timeRange = endT - startT || 1;
  const idxAt = (t: number): number => {
    if (t <= win[0].t) return 0;
    if (t >= win[lastIdx].t) return lastIdx;
    let lo = 0, hi = lastIdx;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (win[mid].t <= t) lo = mid; else hi = mid; }
    const span = win[hi].t - win[lo].t;
    return lo + (span > 0 ? (t - win[lo].t) / span : 0);
  };
  const toX = web
    ? (t: number) => ((t - startT) / timeRange) * chartW
    : (t: number) => (idxAt(t) / (lastIdx || 1)) * chartW;
  const toY = (price: number) => padTop + (1 - (price - minP) / priceRange) * plotH;
  const pts: Pt[] = win.map((d, i) => ({
    x: web ? ((d.t - startT) / timeRange) * chartW : (i / (lastIdx || 1)) * chartW,
    y: toY(d.price), price: d.price, t: d.t,
  }));

  const positive = pts[pts.length - 1].price >= pts[0].price;
  const lineColor = positive ? posColor : negColor;

  // ── Animation timing — shared by the header's rolling price and the line draw-on ──
  const t = animT ?? -1;
  const anim = t >= 0 && box.mode !== 'candle';
  const drawP = anim ? easeInOutCubic(Math.min(t / DRAW_MS, 1)) : 1;
  let pathLen = 0;
  for (let i = 1; i < pts.length; i++) pathLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  // Price at the draw head (path-length parameterized) — the header tracks the line as it draws.
  const headPrice = (p: number): number => {
    if (p >= 1 || pathLen <= 0) return pts[pts.length - 1].price;
    const target = pathLen * p;
    let cum = 0;
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (cum + seg >= target) {
        const f = seg > 0 ? (target - cum) / seg : 0;
        return pts[i - 1].price + (pts[i].price - pts[i - 1].price) * f;
      }
      cum += seg;
    }
    return pts[pts.length - 1].price;
  };

  ctx.save();
  ctx.translate(box.x * sc, box.y * sc);
  ctx.scale(sc, sc);
  ctx.globalAlpha = (box.opacity ?? 100) / 100;

  if (box.bgColor) { ctx.fillStyle = box.bgColor; ctx.fillRect(0, 0, W, H); }

  // ── Header block — avatar + name, "<price> points", ▲ change% (+$diff) ──
  // Faithful to the app's StyleSheet: padding 16, avatar 36 r18 gap 10, name 24/400, price 32/600,
  // "points" 24/400, change row 14/600 with a 14px triangle; chart starts HEADER_H below.
  if (header) {
    const first = win[0].price;
    // While animating, the header follows the line's draw head (then settles on the final value).
    const last = anim ? headPrice(drawP) : win[win.length - 1].price;
    const raw = last - first;
    const up = raw >= 0;
    const changeColor = up ? posColor : negColor;
    const px = 16 * k;
    // The app's negative tracking (name/points -0.6, price -0.8). Canvas letterSpacing is not
    // scaled by the CTM (drawCanvas's setLS does the same), so scale by k AND the device scale.
    // Desktop (pre-Aug-4) drew untracked — its setTracking is a no-op.
    const setTracking = (v: number) => {
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = web ? '0px' : `${v * k * sc}px`;
    };
    // Era header sizes: the Aug-4 restyle shrank name/points 24→22 and the price 32→26 (and
    // added the icons + tracking). Desktop keeps the old sizes.
    const nameSize = web ? 24 : 22;
    const priceSize = web ? 32 : 26;
    const pctSize = web ? 14 : 11;

    // Avatar — dark base circle, artist image clipped on top once loaded
    const ar = 18 * k, acx = px + 18 * k, acy = 18 * k;
    const av = box.artistImage ? releaseImgs?.get(box.artistImage) : undefined;
    ctx.beginPath(); ctx.arc(acx, acy, ar, 0, Math.PI * 2);
    ctx.fillStyle = MARKER_BG; ctx.fill();
    if (av && av.complete && av.naturalWidth) {
      ctx.save(); ctx.beginPath(); ctx.arc(acx, acy, ar, 0, Math.PI * 2); ctx.clip();
      drawImageCover(ctx, av, acx - ar, acy - ar, ar * 2, ar * 2);
      ctx.restore();
    }

    // Artist name — vertically centred on the avatar
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `400 ${nameSize * k}px ${chartFont}`;
    setTracking(-0.6);
    const nameX = px + 36 * k + 10 * k;
    ctx.fillText(box.artistName || '', nameX, acy);

    // Platform icons (Spotify / Apple Music / YouTube) after the name, like the site's header.
    // Not on Desktop — the icons arrived with the Aug-4 restyle.
    if (!web && box.showPlatformIcons !== false) {
      let ix = nameX + ctx.measureText(box.artistName || '').width + 10 * k;
      ctx.fillStyle = PLATFORM_ICON_COLOR;
      for (const icon of PLATFORM_ICONS) {
        const s = icon.size * k;
        ctx.save();
        ctx.translate(ix, acy - s / 2);
        ctx.scale(s / 24, s / 24);
        ctx.fill(new Path2D(icon.d));
        ctx.restore();
        ix += s + 10 * k;
      }
      ctx.fillStyle = '#fff';   // the price row below draws white
    }

    // Price row — "<last> points". Animated: a NumberFlow-style spring odometer (RollingNumber)
    // that rolls the digits as the value climbs with the draw head.
    const priceBaseline = web ? 75 * k : 72 * k;   // 48 (row top) + the price's approximate ascent
    ctx.textBaseline = 'alphabetic';
    ctx.font = `600 ${priceSize * k}px ${chartFont}`;
    setTracking(-0.8);
    let priceW: number;
    if (anim) {
      let entry = rollers.get(box.id);
      if (!entry) { entry = { rn: new RollingNumber(), lastT: -1 }; rollers.set(box.id, entry); }
      if (t < entry.lastT) entry.rn.reset();   // 20s loop / export restart → fresh reels
      const dt = entry.lastT >= 0 && t >= entry.lastT ? (t - entry.lastT) / 1000 : 0;
      entry.lastT = t;
      ctx.fillStyle = '#fff';
      // Baseline-anchored drop-in for the static fillText — at rest it renders pixel-identically.
      priceW = entry.rn.draw(ctx, 'price', last, 2, px, priceBaseline, priceSize * k, dt);
      ctx.textAlign = 'left';
    } else {
      const priceStr = last.toFixed(2);
      ctx.fillText(priceStr, px, priceBaseline);
      priceW = ctx.measureText(priceStr).width;
    }
    ctx.fillStyle = '#fff';
    ctx.font = `400 ${nameSize * k}px ${chartFont}`;
    setTracking(-0.6);
    ctx.fillText('points', px + priceW + 8 * k, priceBaseline);
    setTracking(0);   // change row and everything below draw untracked, like the app

    // Change row — triangle + "1.55%" + "(+$0.298)"
    const cy = 101 * k;
    const triW = 14 * k, triH = 14 * k * (14.25 / 24);   // the app's 24×14 viewBox fit into 14px
    const ty = cy - 0.5 * k;   // optical nudge: the triangle rides 0.5 design px above the text centre
    ctx.fillStyle = changeColor;
    ctx.beginPath();
    if (up) {
      ctx.moveTo(px + triW / 2, ty - triH / 2);
      ctx.lineTo(px + triW * 0.933, ty + triH / 2);
      ctx.lineTo(px + triW * 0.067, ty + triH / 2);
    } else {
      ctx.moveTo(px + triW / 2, ty + triH / 2);
      ctx.lineTo(px + triW * 0.933, ty - triH / 2);
      ctx.lineTo(px + triW * 0.067, ty - triH / 2);
    }
    ctx.closePath(); ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${pctSize * k}px ${chartFont}`;
    const pctStr = `${Math.abs(first !== 0 ? (raw / first) * 100 : 0).toFixed(2)}%`;
    ctx.fillText(pctStr, px + triW + 6 * k, cy);
    const pctW = ctx.measureText(pctStr).width;
    ctx.fillText(`(${up ? '+' : '-'}$${Math.abs(raw).toFixed(3)})`, px + triW + 6 * k + pctW + 6 * k, cy);

    // Everything below draws in chart-local coordinates
    ctx.translate(0, HEADER_H * k);
  }

  // ── Dashed horizontal gridlines + y-axis price labels ──
  if (showGrid) {
    ctx.save();
    // Scale BOTH dash segment and gap by k — keeps the app's 1:4 duty cycle visible at any size.
    ctx.setLineDash([Math.max(1, k), 4 * k]);
    const priceAtY = (y: number) => minP + (1 - (y - padTop) / plotH) * priceRange;
    ctx.fillStyle = labelColor;
    ctx.font = `${10 * k}px ${chartFont}`;
    ctx.textAlign = 'right';
    // Optically centre the digits on the line: 'middle' centres the em box (digits land visibly
    // low), so centre the actual glyph bounds instead.
    ctx.textBaseline = 'alphabetic';
    // 5 lines incl. the bottom; they stop short of the right gutter where the prices live.
    ctx.lineWidth = Math.max(1, 0.75 * k);
    ctx.strokeStyle = box.gridColor || 'rgba(255,255,255,0.20)';
    for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
      const y = frac * lineAreaH;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chartW + 12 * k, y); ctx.stroke();
      const txt = priceAtY(y).toFixed(2);
      const m = ctx.measureText(txt);
      const half = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
      // Clamp the top label away from the box edge only when there's no header above to give it room.
      const labelY = header ? y : Math.max(6 * k, y);
      ctx.fillText(txt, W - 2 * k, labelY + half);
    }
    ctx.restore();
  }

  // ── Release vertical guides (behind the line) ──
  if (showReleases && box.releases?.length) {
    ctx.save();
    // Width scales with the box; alpha nudged up from the app's 0.06 so the guides read like the
    // phone screenshot once rasterized. Desktop keeps the era's stronger 0.08.
    ctx.strokeStyle = web ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.05)';
    ctx.lineWidth = Math.max(1, k);
    const seen = new Set<string>();
    for (const rel of box.releases) {
      if (!rel.date) continue;
      const ms = new Date(rel.date).getTime();
      if (!isFinite(ms) || ms < startT || ms > endT || seen.has(rel.date)) continue;
      seen.add(rel.date);
      const mx = toX(ms);
      ctx.beginPath();
      ctx.moveTo(mx, 0);
      ctx.lineTo(mx, markerY - markerR - 3 * k);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Line or candles ──
  if (box.mode === 'candle') {
    ctx.save(); ctx.globalAlpha *= 0.12; strokeLine(ctx, pts, lineColor, 1.5 * k); ctx.restore();
    drawCandles(ctx, pts, chartW, toY, posColor, negColor, priceRange, k);
  } else {
    if (fillArea) {
      ctx.save();
      if (drawP < 1) {
        // Reveal the fill with the line head (x-clip is a good approximation of path progress).
        const headX = pts[0].x + (pts[pts.length - 1].x - pts[0].x) * drawP;
        ctx.beginPath(); ctx.rect(0, padTop - 2 * k, Math.max(0, headX), plotH + 4 * k); ctx.clip();
      }
      const [r, g, b] = hexToRgb(lineColor);
      const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
      grad.addColorStop(0, `rgba(${r},${g},${b},0.18)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, padTop + plotH);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.lineTo(pts[pts.length - 1].x, padTop + plotH);
      ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();
      ctx.restore();
    }

    // The line — dash-revealed while drawing on (the site's strokeDashoffset technique).
    if (drawP < 1) {
      ctx.save();
      ctx.setLineDash([pathLen * drawP, pathLen + 4 * k]);
      strokeLine(ctx, pts, lineColor, lineW);
      ctx.restore();
    } else {
      strokeLine(ctx, pts, lineColor, lineW);
    }

    // Live dot — the site shows it only once the draw has finished.
    if (showLastDot && drawP >= 1) {
      const last = pts[pts.length - 1];
      const [hr, hg, hb] = hexToRgb(lineColor);
      if (anim) {
        // Pulse: a ghost scales 1→3.2× with opacity 0.8→0 every 0.9s (scale ease-out, like the app).
        const phase = ((t - DRAW_MS) % PULSE_MS) / PULSE_MS;
        const scaleE = 1 - Math.pow(1 - phase, 2);
        ctx.beginPath(); ctx.arc(last.x, last.y, 3.5 * k * (1 + 2.2 * scaleE), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${hr},${hg},${hb},${0.8 * (1 - phase)})`; ctx.fill();
      } else {
        // Static frame: a soft mid-pulse halo.
        ctx.beginPath(); ctx.arc(last.x, last.y, 9 * k, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${hr},${hg},${hb},0.16)`; ctx.fill();
      }
      ctx.beginPath(); ctx.arc(last.x, last.y, 3.5 * k, 0, Math.PI * 2);
      ctx.fillStyle = lineColor; ctx.fill();
    }

    // Spark glint — a short bright blurred segment travels the line in 0.8s; first at 4s, then every 3s.
    if (anim && t >= SPARK_START_MS && pathLen > 0) {
      const cyclePos = (t - SPARK_START_MS) % SPARK_EVERY_MS;
      if (cyclePos <= SPARK_TRAVEL_MS) {
        const sp = cyclePos / SPARK_TRAVEL_MS;
        const sparkLen = SPARK_LEN * k;
        const [r, g, b] = hexToRgb(lineColor);
        // Mix 60% toward white (the site's color-mix), slide the dash from before the start to past the end.
        const mix = (c: number) => Math.round(c + (255 - c) * 0.6);
        ctx.save();
        ctx.setLineDash([sparkLen, pathLen + 2 * sparkLen]);
        ctx.lineDashOffset = sparkLen - sp * (pathLen + sparkLen);
        ctx.filter = `blur(${2 * k}px)`;
        strokeLine(ctx, pts, `rgb(${mix(r)},${mix(g)},${mix(b)})`, lineW);
        ctx.restore();
        ctx.filter = 'none';
      }
    }
  }

  // ── Release date indicators — the site's hover state, made static: a bright vertical line
  //    (rgba .4) over the price line down behind the artwork. ──
  if (showReleases && showDates && box.releases?.length) {
    const seenI = new Set<string>();
    for (const rel of box.releases) {
      if (!rel.date) continue;
      const ms = new Date(rel.date).getTime();
      if (!isFinite(ms) || ms < startT || ms > endT || seenI.has(rel.date)) continue;
      seenI.add(rel.date);
      const mx = toX(ms);
      // Bright line: site draws y=-12 → just past the marker centre (hidden behind the artwork).
      // Animated: the line grows UPWARD from the marker with the draw-line's exact timing/easing.
      const lineTop = header ? -12 * k : 0;
      const lineBottom = markerY + 8 * k;
      const topNow = anim ? lineBottom - (lineBottom - lineTop) * drawP : lineTop;
      ctx.save();
      // Desktop keeps the era's brighter 0.4 indicator; the Aug-4 restyle dimmed it to 0.28.
      ctx.strokeStyle = web ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.28)';
      ctx.lineWidth = Math.max(1, k);
      ctx.beginPath();
      ctx.moveTo(mx, topNow);
      ctx.lineTo(mx, lineBottom);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── Round album-art release markers in the band below the bottom gridline ──
  if (showReleases && box.releases?.length) {
    const seen = new Set<string>();
    let lastNameEnd = -Infinity;   // greedy skip so clustered markers don't overlap their names
    let lastDateEnd = -Infinity;   // same, for the top date labels
    for (const rel of box.releases) {
      if (!rel.date) continue;
      const ms = new Date(rel.date).getTime();
      if (!isFinite(ms) || ms < startT || ms > endT || seen.has(rel.date)) continue;
      seen.add(rel.date);
      const mx = toX(ms);
      const img = rel.image ? releaseImgs?.get(rel.image) : undefined;
      // dark base circle
      ctx.beginPath(); ctx.arc(mx, markerY, markerR, 0, Math.PI * 2);
      ctx.fillStyle = MARKER_BG; ctx.fill();
      // album art clipped to the circle
      if (img && img.complete && img.naturalWidth) {
        ctx.save(); ctx.beginPath(); ctx.arc(mx, markerY, markerR, 0, Math.PI * 2); ctx.clip();
        const s = markerR * 2;
        drawImageCover(ctx, img, mx - markerR, markerY - markerR, s, s);
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(mx, markerY, 4 * k, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fill();
      }
      // ring
      ctx.beginPath(); ctx.arc(mx, markerY, markerR, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(0.5, 0.75 * k);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.stroke();
      // Release date at the top of its indicator line — the site's hover label style (10/400,
      // white), baseline just under the top gridline. Year appended when it differs from the
      // window end. Greedy overlap-skip like names.
      if (showDates) {
        const d = new Date(ms);
        const endYear = new Date(endT).getFullYear();
        const label = `${MONTHS_CAPS[d.getMonth()]} ${d.getDate()}`
          + (d.getFullYear() !== endYear ? `, ${d.getFullYear()}` : '');
        ctx.font = `400 ${10 * k}px ${chartFont}`;
        const tw = ctx.measureText(label).width;
        const lx = Math.max(tw / 2 + 2 * k, Math.min(W - tw / 2 - 2 * k, mx));   // keep inside the box
        if (lx - tw / 2 > lastDateEnd + 6 * k) {
          // Animated: fade in over 400ms once the line draw has finished.
          const fade = anim ? Math.max(0, Math.min(1, (t - DRAW_MS) / 400)) : 1;
          if (fade > 0) {
            ctx.save();
            ctx.globalAlpha *= fade;
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(label, lx, 15 * k);
            ctx.restore();
          }
          lastDateEnd = lx + tw / 2;
        }
      }
      // Release name beneath the marker — the app's hover label (8/600 #e4e4e7), made static.
      // Skipped when it would overlap the previous name (clustered releases).
      if (showNames && rel.name) {
        const label = rel.name.length > 18 ? rel.name.slice(0, 17) + '…' : rel.name;
        ctx.font = `600 ${8 * k}px ${chartFont}`;
        const tw = ctx.measureText(label).width;
        if (mx - tw / 2 > lastNameEnd + 6 * k) {
          ctx.fillStyle = '#e4e4e7';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, mx, markerY + markerR + 9 * k);
          lastNameEnd = mx + tw / 2;
        }
      }
    }
  }

  // ── X-axis date ticks in their design row along the bottom (formatXTick: hour for 1D, else M/D) ──
  if (showXDates) {
    ctx.save();
    ctx.fillStyle = labelColor;
    ctx.font = `400 ${10 * k}px ${chartFont}`;
    ctx.textBaseline = 'alphabetic';
    const yTick = (CHART_AREA_H + (showNames ? NAMES_H : 0)) * k + 11 * k;
    const n = 5;
    for (let i = 0; i < n; i++) {
      // MOBILE: even INDEX steps (matching the equal-spaced x axis), labelled with that point's
      // date. DESKTOP (era-faithful): even TIME fractions across the window, like before Aug 4.
      const tickT = web ? startT + (i * timeRange) / (n - 1) : win[Math.round((i * lastIdx) / (n - 1))].t;
      const d = new Date(tickT);
      const label = box.period === '1D' && !box.sinceRelease
        ? `${(d.getHours() % 12) || 12} ${d.getHours() >= 12 ? 'PM' : 'AM'}`
        : `${d.getMonth() + 1}/${d.getDate()}`;
      ctx.textAlign = i === 0 ? 'left' : i === n - 1 ? 'right' : 'center';
      ctx.fillText(label, toX(tickT), yTick);
    }
    ctx.restore();
  }

  // ── Sonotrade glyph+wordmark watermark, top right (white logo @ 30%, like the site) ──
  if (showWatermark) {
    const wm = releaseImgs?.get(WATERMARK_URL);
    if (wm && wm.complete && wm.naturalWidth) {
      const wh = 26 * k;                                   // logo height in design units
      const ww = wh * (wm.naturalWidth / wm.naturalHeight);
      // With the header, it sits in the gap above the chart area (like the site's header corner);
      // headerless, it tucks inside the top padding band.
      const bottom = header ? -20 * k : 12 * k;
      const crisp = scaledWatermark(wm, ww * sc) ?? wm;    // pre-minified at device pixels
      ctx.save();
      ctx.globalAlpha *= 0.3;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(crisp, W - 4 * k - ww, bottom - wh, ww, wh);
      ctx.restore();
    }
  }

  ctx.restore();
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const v = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function strokeLine(ctx: CanvasRenderingContext2D, pts: Pt[], color: string, width: number) {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

// Synthetic candles over the line (matches the source — cosmetic, not real OHLC).
function drawCandles(
  ctx: CanvasRenderingContext2D, pts: Pt[], chartW: number,
  toY: (p: number) => number, posColor: string, negColor: string, priceRange: number, k: number,
) {
  if (pts.length < 2) return;
  let vol = 0;
  for (let i = 1; i < pts.length; i++) vol += Math.abs(pts[i].price - pts[i - 1].price);
  vol = vol / (pts.length - 1) || priceRange * 0.02;
  const N = Math.max(4, Math.floor(chartW / (9 * k)));
  const candleW = Math.max((chartW / N) * 0.7, 1.5);
  const baseAlpha = ctx.globalAlpha;
  for (let i = 0; i < N; i++) {
    const base = interp(pts, i / N);
    const end = interp(pts, (i + 1) / N);
    const open = base.price + (rand(i * 4) - 0.5) * 2 * vol;
    const close = end.price + (rand(i * 4 + 1) - 0.5) * 2 * vol;
    const rawHigh = Math.max(open, close), rawLow = Math.min(open, close);
    const spread = Math.max(rawHigh - rawLow, vol * 0.4);
    const high = rawHigh + (0.3 + rand(i * 4 + 2) * 0.7) * spread;
    const low = rawLow - (0.3 + rand(i * 4 + 3) * 0.7) * spread;
    const cx = ((i + 0.5) / N) * chartW;
    const col = close >= open ? posColor : negColor;
    const bodyTop = toY(Math.max(open, close));
    const bodyH = Math.max(Math.abs(toY(close) - toY(open)), 1.2);
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.globalAlpha = baseAlpha * 0.8;
    ctx.beginPath(); ctx.moveTo(cx, toY(high)); ctx.lineTo(cx, toY(low)); ctx.stroke();
    ctx.fillStyle = col; ctx.globalAlpha = baseAlpha * 0.9;
    ctx.fillRect(cx - candleW / 2, bodyTop, candleW, bodyH);
  }
  ctx.globalAlpha = baseAlpha;
}
