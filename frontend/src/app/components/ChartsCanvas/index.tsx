'use client';

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { CANVAS_W, CANVAS_H, DISPLAY_SCALE, CAPTION_LINE_HEIGHT, HEADER_PADDING_X } from './constants';
import { SP500_ID } from './types';
import type { ChartsCanvasProps, ChartsCanvasRef, ChartsMarket, ReelType, SparkPoint } from './types';
import { wrapRichText, drawRichLine, measureRichWidth } from '@/lib/emoji';
import { avgColorFromImage, FALLBACK_LINE_COLOR } from '@/lib/imageColor';
import { framedDrawRect, type CircleFrame } from '@/lib/circleFrame';
import { RollingNumber } from '@/lib/rollingNumber';

export type { ChartsCanvasRef, ChartsMarket } from './types';

const CAPTION_FONT_SIZE  = 48;
const CAPTION_LINE_H     = CAPTION_LINE_HEIGHT;
const CAPTION_BOT_OFF    = 18;
const CAPTION_AREA_H     = 320;

const PROFILE_TOP_PAD  = 60;
const PROFILE_CENTER_OFFSET = 200; // distance of each artist column's centre from the central "Vs"
const AVATAR_R         = 88;
const AVATAR_NAME_GAP  = 48;
const NAME_FONT_SIZE   = 42;
const PRICE_FONT_SIZE  = 48;
const PCT_FONT_SIZE    = 36;

const GROW_MS  = 22000;
const CYCLE_MS = 25000;

const POINT_INTERVAL_MS = 45 * 24 * 60 * 60 * 1000;
const MIN_WIN_MS        = 30 * 24 * 60 * 60 * 1000;

const CHART_PAD_L = 16;
const CHART_PAD_R = 300;
const Y_AXIS_W    = 80;
const CHART_PAD_T = 12;
const CHART_PAD_B = 52;
const LEAD_R      = 22;

const CTA_AREA_H   = 48; // spacing kept in HEADERS_H (was the watermark band)
const CTA_LOGO_GAP = 7;

// Single canvas font for everything (matches the Video Reels landing animation's canvas font).
const CANVAS_FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

// Total header height (below the top caption band). Exposed so the caption can be positioned
// in the gap just above the chart without duplicating this formula.
const HEADERS_H = PROFILE_TOP_PAD + AVATAR_R * 2 + AVATAR_NAME_GAP + NAME_FONT_SIZE + 18 + PRICE_FONT_SIZE + 16 + PCT_FONT_SIZE + 16 + CTA_AREA_H;

// Profit reels: $100 invested EVERY MONTH since 2004 (the series are monthly), then held.
// The S&P side buys at its real close each month (honest dollar-cost averaging); the artist
// side is $100/mo DCA'd into its CUMULATIVE interest index, then scaled by a per-reel
// artist multiplier (×1000 … ÷1000) so the user can tune its magnitude vs the S&P.
const INVESTED = 100; // per month
const DEFAULT_ARTIST_MULTIPLIER = 1;
// Small fixed floor on the cumulative index purely for numeric stability — keeps the early
// near-zero stretch from dividing $100 by ~0 and producing wild share counts.
const CUM_INDEX_FLOOR = 0.5;

function fmtMoneyCompact(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

// Max moving-average radius as a fraction of the series length (at smoothing 100) —
// same constant as the landing animation so the slider feels identical.
const SMOOTH_MAX_FRAC = 0.08;

// Only one canvas preview plays audio at a time (mirrors the input card's audio preview).
let activePreviewAudio: HTMLAudioElement | null = null;

function generateFallbackSparkline(ticker: string): SparkPoint[] {
  let seed = ticker.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0x1234) >>> 0;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff; };
  const N = 13 + Math.floor(rand() * 9);
  const wiggle = 0.34 + rand() * 0.18;
  const vals: number[] = [];
  for (let i = 0; i < N; i++) {
    const t = N === 1 ? 0 : i / (N - 1);
    const taper = Math.sin(Math.PI * t);
    let j = (rand() - 0.5) * wiggle;
    if (rand() < 0.22) j += (rand() - 0.5) * wiggle * 1.8;
    vals.push(t + j * taper);
  }
  const lo = Math.min(...vals);
  const range = Math.max(1e-6, Math.max(...vals) - lo);
  return vals.map((x, i) => ({ value: 0.1 + ((x - lo) / range) * 0.8, timestamp: i }));
}

function niceStep(range: number, target: number): number {
  if (!(range > 0) || !(target > 0)) return 1;
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function valueAt(s: { t: number; price: number }[], time: number): number | null {
  if (!s.length) return null;
  if (time <= s[0].t) return s[0].price;
  if (time >= s[s.length - 1].t) return s[s.length - 1].price;
  for (let i = 1; i < s.length; i++) {
    if (s[i].t >= time) {
      const a = s[i - 1], b = s[i];
      const f = b.t === a.t ? 0 : (time - a.t) / (b.t - a.t);
      return a.price + (b.price - a.price) * f;
    }
  }
  return s[s.length - 1].price;
}

function sparkToSeries(spark: SparkPoint[] | null | undefined): { t: number; price: number }[] {
  if (!spark?.length) return [];
  const isReal = spark[0].timestamp > 946_684_800_000;
  if (isReal) return spark.map(p => ({ t: p.timestamp, price: p.value }));
  const nowMs = Date.now();
  const n = spark.length;
  return spark.map((p, i) => ({ t: nowMs - (n - 1 - i) * POINT_INTERVAL_MS, price: p.value }));
}

function drawCaption(ctx: CanvasRenderingContext2D, caption: string, bottomBaselineY: number, baseFontSize: number = CAPTION_FONT_SIZE, maxLines = 2, opts: { color?: string; weight?: number; vCenter?: number; noShrink?: boolean } = {}) {
  if (!caption.trim()) return;
  const weight = opts.weight ?? 400;
  const color = opts.color ?? '#ffffff';
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const padX = HEADER_PADDING_X + 43;
  const maxW = CANVAS_W - padX * 2;
  let fontSize = baseFontSize;
  const countLines = (fs: number) => {
    ctx.font = `${weight} ${fs}px ${CANVAS_FONT}`;
    return caption.split('\n').reduce((sum, p) =>
      sum + (p.trim() ? wrapRichText(ctx, p, maxW, fs).length : 1), 0);
  };
  const totalLines = countLines(fontSize);
  if (!opts.noShrink && totalLines > maxLines) {
    fontSize = Math.max(20, Math.floor(fontSize * maxLines / totalLines));
    if (countLines(fontSize) > maxLines) fontSize = Math.max(20, fontSize - 2);
  }
  const lineH = Math.round(fontSize * 1.25);
  ctx.font = `${weight} ${fontSize}px ${CANVAS_FONT}`;
  ctx.fillStyle = color;
  const groups: (string[] | null)[] = [];
  for (const para of caption.split('\n')) {
    if (!para) { groups.push(null); continue; }
    groups.push(wrapRichText(ctx, para, maxW, fontSize));
  }
  const lineCount = groups.reduce((n, g) => n + (g === null ? 1 : g.length), 0);
  const firstBaseline = opts.vCenter !== undefined
    ? opts.vCenter - ((lineCount - 1) * lineH) / 2 + fontSize * 0.35
    : bottomBaselineY - (lineCount - 1) * lineH;
  let cy = firstBaseline;
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const isLastGroup = gi === groups.length - 1;
    if (group === null) { cy += lineH; continue; }
    for (let wi = 0; wi < group.length; wi++) {
      drawRichLine(ctx, group[wi], (CANVAS_W - measureRichWidth(ctx, group[wi], fontSize)) / 2, cy, fontSize);
      if (wi < group.length - 1) cy += lineH;
    }
    if (!isLastGroup) cy += lineH;
  }
  ctx.restore();
}


function drawImageCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cx: number, cy: number, r: number, frame?: CircleFrame | null) {
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;
  const { dx, dy, w, h } = framedDrawRect(iw, ih, cx, cy, r, frame);
  ctx.drawImage(img, dx, dy, w, h);
}

interface ChartResult {
  priceA: number | null; pctA: number | null;
  priceB: number | null; pctB: number | null;
}

function drawCompareChart(
  ctx: CanvasRenderingContext2D,
  sparkA: SparkPoint[] | null | undefined,
  sparkB: SparkPoint[] | null | undefined,
  imgA: HTMLImageElement | null,
  imgB: HTMLImageElement | null,
  colorA: string, colorB: string,
  frameA: CircleFrame | null | undefined, frameB: CircleFrame | null | undefined,
  smoothing: number,
  reelType: ReelType,
  realEntry: [boolean, boolean],
  artistMultiplier: number,
  profitCumulative: boolean,
  cursorT: number,
  rx: number, ry: number, rw: number, rh: number,
): ChartResult {
  // Centred moving average whose radius scales with the series length — the same 0–100
  // control as the landing animation (100 = radius of 8% of the series; 0 = raw). The
  // window shrinks at the edges; O(N) via a prefix sum.
  const smooth = (s: { t: number; price: number }[]) => {
    const radius = Math.round((smoothing / 100) * SMOOTH_MAX_FRAC * s.length);
    if (radius < 1 || s.length <= 2) return s;
    const n = s.length;
    const prefix = new Array<number>(n + 1);
    prefix[0] = 0;
    for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + s[i].price;
    return s.map((p, i) => {
      const lo = Math.max(0, i - radius), hi = Math.min(n - 1, i + radius);
      return { t: p.t, price: (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1) };
    });
  };
  const rawA = sparkToSeries(sparkA), rawB = sparkToSeries(sparkB);
  let sA = smooth(rawA), sB = smooth(rawB);
  const firstRawNonZeroA = rawA.find(p => p.price > 0);
  const firstRawNonZeroB = rawB.find(p => p.price > 0);
  let firstBaseA = firstRawNonZeroA ? (valueAt(sA, firstRawNonZeroA.t) ?? 0) : 0;
  let firstBaseB = firstRawNonZeroB ? (valueAt(sB, firstRawNonZeroB.t) ?? 0) : 0;
  // Profit reels: $100/mo dollar-cost-averaging, both sides valued in dollars. The real-priced
  // S&P buys at its actual closes. The ARTIST's "price" is its CUMULATIVE interest index (a
  // running sum of the monthly index), and $100/mo is DCA'd into that — since the cumulative
  // index only rises, the artist's portfolio is monotonic (never crashes). The buy floor still
  // applies to the early near-zero stretch of the cumulative index.
  if (reelType === 'profit') {
    // S&P / any real-priced series: $100/mo DCA at the real close.
    const realDca = (series: { t: number; price: number }[]) => {
      let shares = 0;
      return series.map(p => {
        if (p.price > 0) shares += INVESTED / p.price;
        return { t: p.t, price: shares * p.price };
      });
    };
    // Artist, CUMULATIVE mode: DCA into the running-sum index (monotonic), × multiplier.
    const cumIndexDca = (series: { t: number; price: number }[]) => {
      let cum = 0, shares = 0;
      return series.map(p => {
        cum += Math.max(p.price, 0);
        const px = Math.max(cum, CUM_INDEX_FLOOR);
        if (px > 0) shares += INVESTED / px;
        return { t: p.t, price: shares * px * artistMultiplier };
      });
    };
    // Artist, TRENDS mode: original DCA straight on the raw index (no floor), × multiplier.
    const trendsDca = (series: { t: number; price: number }[]) => {
      let shares = 0;
      return series.map(p => {
        if (p.price > 0) shares += INVESTED / p.price;
        return { t: p.t, price: shares * p.price * artistMultiplier };
      });
    };
    const artistDca = profitCumulative ? cumIndexDca : trendsDca;
    // realEntry[i] true = the real-priced S&P; false = the artist.
    sA = realEntry[0] ? realDca(sA) : artistDca(sA); firstBaseA = INVESTED;
    sB = realEntry[1] ? realDca(sB) : artistDca(sB); firstBaseB = INVESTED;
  }

  if (!sA.length && !sB.length) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `300 28px ${CANVAS_FONT}`;
    ctx.fillStyle = '#27272a';
    ctx.fillText('Select artists and press Start', rx + rw / 2, ry + rh / 2);
    return { priceA: null, pctA: null, priceB: null, pctB: null };
  }

  // Chop leading flat region: start at most 2 years before first >$1 crossing
  const TWO_YEARS_MS = 2 * 365.25 * 24 * 60 * 60 * 1000;
  const firstAboveOneTs = ([sA.find(p => p.price > 1), sB.find(p => p.price > 1)] as ({ t: number; price: number } | undefined)[])
    .filter((p): p is { t: number; price: number } => p != null)
    .reduce((min, p) => Math.min(min, p.t), Infinity);
  const chopStart = isFinite(firstAboveOneTs) ? firstAboveOneTs - TWO_YEARS_MS : -Infinity;
  const clipSeries = (s: { t: number; price: number }[]) => {
    if (!isFinite(chopStart) || !s.length || s[0].t >= chopStart) return s;
    const idx = s.findIndex(p => p.t >= chopStart);
    if (idx <= 0) return s;
    const prev = s[idx - 1], next = s[idx];
    const ratio = (chopStart - prev.t) / (next.t - prev.t);
    return [{ t: chopStart, price: prev.price + ratio * (next.price - prev.price) }, ...s.slice(idx)];
  };
  const sAc = clipSeries(sA), sBc = clipSeries(sB);

  const allStarts: number[] = [], allEnds: number[] = [];
  if (sAc.length) { allStarts.push(sAc[0].t); allEnds.push(sAc[sAc.length - 1].t); }
  if (sBc.length) { allStarts.push(sBc[0].t); allEnds.push(sBc[sBc.length - 1].t); }
  const tStart = Math.min(...allStarts), tEnd = Math.max(...allEnds);
  const fullSpan = Math.max(tEnd - tStart, 1);
  const minWin = Math.min(MIN_WIN_MS, fullSpan);
  const cursorTime = tStart + minWin + cursorT * (fullSpan - minWin);
  const winRange = Math.max(cursorTime - tStart, 1);

  const reveal = (s: { t: number; price: number }[]) => {
    const out = s.filter(p => p.t <= cursorTime);
    const lead = valueAt(s, cursorTime);
    if (lead != null && (!out.length || out[out.length - 1].t < cursorTime))
      out.push({ t: cursorTime, price: lead });
    return out;
  };
  const revA = reveal(sAc), revB = reveal(sBc);
  const rPrices = [...revA, ...revB].map(p => p.price);
  const minP = rPrices.length ? Math.min(...rPrices) : 0;
  const maxP = rPrices.length ? Math.max(...rPrices) : 1;
  const pRange = maxP === minP ? 1 : maxP - minP;
  const PAD_Y = pRange * 0.08;
  const loP = minP - PAD_Y, vRange = pRange + 2 * PAD_Y;

  const fullPrices = [...sAc, ...sBc].map(p => p.price);
  const fullMin = fullPrices.length ? Math.min(...fullPrices) : 0;
  const fullMax = fullPrices.length ? Math.max(...fullPrices) : 1;
  const gridStep = niceStep((fullMax - fullMin) || 1, 6);
  const gridLines: number[] = [];
  if (rPrices.length && gridStep > 0 && vRange > 0) {
    const hiP = loP + vRange;
    const firstLine = Math.ceil(loP / gridStep) * gridStep;
    for (let p = firstLine, guard = 0; p <= hiP + 1e-6 && guard < 100; p += gridStep, guard++) {
      // Keep gridlines inside the data bounds [minP, maxP] — a line landing in the scale's
      // padding zone would float above the vertical axis' top (or below the solid bottom).
      if (p >= minP - 1e-6 && p <= maxP + 1e-6) gridLines.push(p);
    }
  }

  const chartAreaH = rh - CHART_PAD_T - CHART_PAD_B;
  const CHART_W = rw - Y_AXIS_W;
  const toX = (t: number) => rx + Y_AXIS_W + CHART_PAD_L + ((t - tStart) / winRange) * (CHART_W - CHART_PAD_L - CHART_PAD_R / 2);
  const toY = (price: number) => ry + CHART_PAD_T + (1 - (price - loP) / vRange) * chartAreaH;

  const boundTopY = toY(maxP), boundBotY = toY(minP);
  for (const price of gridLines) {
    const gy = toY(price);
    // Don't draw a dashed line where a solid bound line already sits (no double lines) —
    // but always keep the value label.
    const coincides = Math.abs(gy - boundBotY) < 1.5;
    if (!coincides) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
      ctx.setLineDash([6, 8]);
      ctx.beginPath(); ctx.moveTo(rx + Y_AXIS_W + CHART_PAD_L, gy); ctx.lineTo(rx + rw, gy); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Skip the value label when it would crowd the peak label at the top of the axis
    // (both are 22px, centered — closer than ~28px and they visibly overlap).
    if (Math.abs(gy - boundTopY) >= 28) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `400 22px ${CANVAS_FONT}`; ctx.fillStyle = '#3f3f46';
      ctx.fillText(reelType === 'profit' ? fmtMoneyCompact(price) : price.toFixed(2), rx + Y_AXIS_W / 2, gy);
    }
  }

  // Solid bottom line (lowest value) + a left vertical axis running up to the peak, so the
  // chart's extent is clear. (No top horizontal line.)
  if (rPrices.length) {
    const leftX = rx + Y_AXIS_W + CHART_PAD_L, rightX = rx + rw;
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(leftX, boundBotY); ctx.lineTo(rightX, boundBotY);   // bottom
    ctx.moveTo(leftX, boundTopY); ctx.lineTo(leftX, boundBotY);    // left vertical (up to the peak)
    ctx.stroke();
    // Peak value labelled at the top of the left axis.
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `400 22px ${CANVAS_FONT}`; ctx.fillStyle = '#3f3f46';
    ctx.fillText(reelType === 'profit' ? fmtMoneyCompact(maxP) : maxP.toFixed(2), rx + Y_AXIS_W / 2, boundTopY);
  }

  const bottomY = ry + CHART_PAD_T + chartAreaH;
  const MIN_LABEL_GAP = 72;
  const y0 = new Date(tStart).getFullYear(), y1 = new Date(cursorTime).getFullYear();
  ctx.font = `400 22px ${CANVAS_FONT}`; ctx.fillStyle = '#3f3f46';
  ctx.textBaseline = 'top'; ctx.textAlign = 'center';
  const chartRight = CHART_W - CHART_PAD_L - CHART_PAD_R / 2;
  const leftBound = rx + Y_AXIS_W + CHART_PAD_L;
  const FADE_ZONE = 48;
  // The thinning must be FRAME-STABLE: deriving the step from the currently revealed span
  // and anchoring it to the newest revealed year made the drawn set re-phase every time the
  // cursor entered a new year — labels flicked between alternating sets (visible jitter).
  // Instead compute the step ONCE from the full time range and anchor the kept years to the
  // FINAL year (which also keeps the chart's end year as the last tick). The set of labelled
  // years is then constant for the whole animation: labels only fade in and glide.
  const yEndFull = new Date(tEnd).getFullYear();
  const fullRange = Math.max(tEnd - tStart, 1);
  const centerFullX = (y: number) => {
    const s = Math.max(new Date(y, 0, 1).getTime(), tStart);
    const e = Math.min(new Date(y + 1, 0, 1).getTime(), tEnd);
    return leftBound + (((s + e) / 2 - tStart) / fullRange) * chartRight;
  };
  let step = 1;
  const totalYears = yEndFull - y0;
  if (totalYears > 1) {
    const spanPx = centerFullX(yEndFull) - centerFullX(y0 + 1);
    const maxLabels = Math.max(1, Math.floor(spanPx / MIN_LABEL_GAP));
    step = Math.ceil(totalYears / maxLabels);
  }
  for (let y = y0 + 1; y <= y1; y++) {
    if ((yEndFull - y) % step !== 0) continue;
    const spanStart = Math.max(new Date(y, 0, 1).getTime(), tStart);
    const spanEnd = Math.min(new Date(y + 1, 0, 1).getTime(), cursorTime);
    const lx = leftBound + (((spanStart + spanEnd) / 2 - tStart) / winRange) * chartRight;
    let alpha = 1;
    if (y === y1) {
      const yStart = new Date(y, 0, 1).getTime(), yEnd = new Date(y + 1, 0, 1).getTime();
      alpha = Math.min(1, ((cursorTime - yStart) / (yEnd - yStart)) * 3);
    }
    const distFromLeft = lx - leftBound;
    if (distFromLeft < FADE_ZONE) alpha = Math.min(alpha, Math.max(0, distFromLeft / FADE_ZONE));
    if (alpha <= 0) continue;
    ctx.globalAlpha = alpha;
    ctx.fillText(String(y), lx, bottomY + 8);
    ctx.globalAlpha = 1;
  }

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const headDate = new Date(cursorTime);
  const headLabel = `${MONTHS[headDate.getMonth()]} ${headDate.getFullYear()}`;
  ctx.font = `600 48px ${CANVAS_FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(headLabel, CANVAS_W / 2, bottomY + 80);

  const drawLine = (rev: { t: number; price: number }[], color: string) => {
    if (rev.length < 2) return;
    const pts = rev.map(p => ({ x: toX(p.t), y: toY(p.price) }));
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 5;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
  };
  if (revA.length >= 2) drawLine(revA, colorA);
  if (revB.length >= 2) drawLine(revB, colorB);

  const drawLead = (
    rev: { t: number; price: number }[],
    color: string, img: HTMLImageElement | null, firstPrice: number,
    frame: CircleFrame | null | undefined,
  ): { price: number; firstPrice: number } | null => {
    if (rev.length < 2) return null;
    const lead = rev[rev.length - 1];
    const lx = toX(lead.t), ly = toY(lead.price);
    const cx = lx + LEAD_R, cy = ly;
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, LEAD_R, 0, Math.PI * 2);
    if (img) { ctx.clip(); drawImageCover(ctx, img, cx, cy, LEAD_R, frame); }
    else { ctx.fillStyle = color; ctx.fill(); }
    ctx.restore();
    ctx.strokeStyle = color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, LEAD_R, 0, Math.PI * 2); ctx.stroke();
    ctx.font = `700 20px ${CANVAS_FONT}`; ctx.fillStyle = color;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(reelType === 'profit' ? fmtMoneyCompact(lead.price) : `${lead.price.toFixed(2)}`, cx, cy - LEAD_R - 6);
    return { price: lead.price, firstPrice };
  };
  const resA = drawLead(revA, colorA, imgA, firstBaseA, frameA);
  const resB = drawLead(revB, colorB, imgB, firstBaseB, frameB);
  // Comparison: % change vs the series' first base (clamped at 0). Profit: % return on the
  // money actually invested so far — $100 per monthly point up to the cursor — so the figure
  // is (value − invested) / invested, and goes negative (red) when the holding is under water.
  const basePct = (res: { price: number; firstPrice: number } | null) =>
    res ? Math.max(0, res.firstPrice > 0 ? ((res.price - res.firstPrice) / res.firstPrice) * 100 : 0) : null;
  const profitPct = (res: { price: number } | null, s: { t: number; price: number }[]) => {
    if (!res) return null;
    const invested = INVESTED * s.filter(p => p.t <= cursorTime).length;
    return invested > 0 ? ((res.price - invested) / invested) * 100 : null;
  };
  return {
    priceA: resA?.price ?? null,
    pctA: reelType === 'profit' ? profitPct(resA, sA) : basePct(resA),
    priceB: resB?.price ?? null,
    pctB: reelType === 'profit' ? profitPct(resB, sB) : basePct(resB),
  };
}

function drawProfiles(
  ctx: CanvasRenderingContext2D,
  markets: [ChartsMarket | null, ChartsMarket | null],
  imgs: [HTMLImageElement | null, HTMLImageElement | null],
  dividerY: number, cursorT: number,
  overrideNames: [string, string],
  colors: [string, string],
  roller: RollingNumber, dt: number,
  bannerText: string,
  bannerFontSize: number,
  linkBioImg: HTMLImageElement | null,
  smoothing: number,
  reelType: ReelType,
  artistMultiplier: number,
  profitCumulative: boolean,
) {
  // White banner (full width, 200px tall) ending just above the two artists.
  ctx.fillStyle = '#ffffff';
  const bannerBottom = dividerY + PROFILE_TOP_PAD - 40;
  const bannerTop = bannerBottom - 200;
  ctx.fillRect(0, bannerTop, CANVAS_W, 200);
  // Banner headline (the link-in-bio wordmark is white, so it lives below on the dark
  // background instead — see the draw near the end of this function).
  if (bannerText.trim()) {
    drawCaption(ctx, bannerText, bannerTop + 120, bannerFontSize, 2, { color: '#0A0A0A', weight: 500, vCenter: bannerTop + 100, noShrink: true });
  }


  const avatarCy = dividerY + PROFILE_TOP_PAD + AVATAR_R;
  const nameBaseY = avatarCy + AVATAR_R + AVATAR_NAME_GAP;
  const priceBaseY = nameBaseY + NAME_FONT_SIZE + 36;
  const headersH = HEADERS_H;
  const LINE_COLORS: [string, string] = colors;
  const CHART_X = 72;
  const chartY = dividerY + headersH;
  const chartW = CANVAS_W - CHART_X - 72;
  const chartH = CANVAS_H - chartY - 280;

  let chartResult: ChartResult = { priceA: null, pctA: null, priceB: null, pctB: null };
  if (chartH > 40) {
    chartResult = drawCompareChart(ctx, markets[0]?.sparkline, markets[1]?.sparkline, imgs[0], imgs[1], LINE_COLORS[0], LINE_COLORS[1], markets[0]?.frame, markets[1]?.frame, smoothing, reelType, [markets[0]?.id === SP500_ID, markets[1]?.id === SP500_ID], artistMultiplier, profitCumulative, cursorT, CHART_X, chartY, chartW, chartH);
  }

  const prices = [chartResult.priceA, chartResult.priceB];
  const pcts = [chartResult.pctA, chartResult.pctB];

  for (let i = 0; i < 2; i++) {
    // Columns sit PROFILE_CENTER_OFFSET either side of the central "Vs" (was colW/2 = 270,
    // which spread them to the quarter lines).
    const market = markets[i], img = imgs[i], cx = CANVAS_W / 2 + (i === 0 ? -1 : 1) * PROFILE_CENTER_OFFSET;
    const color = LINE_COLORS[i], price = prices[i], pct = pcts[i];
    ctx.save(); ctx.beginPath(); ctx.arc(cx, avatarCy, AVATAR_R, 0, Math.PI * 2);
    if (img) { ctx.clip(); drawImageCover(ctx, img, cx, avatarCy, AVATAR_R, market?.frame); }
    else {
      ctx.fillStyle = '#1c1c1c'; ctx.fill();
      if (market) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 ${Math.round(AVATAR_R * 0.65)}px ${CANVAS_FONT}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText((overrideNames[i] || market.name).charAt(0).toUpperCase(), cx, avatarCy);
      }
    }
    ctx.restore();
    ctx.strokeStyle = color; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, avatarCy, AVATAR_R + 3, 0, Math.PI * 2); ctx.stroke();
    if (!market) continue;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = `300 ${NAME_FONT_SIZE}px ${CANVAS_FONT}`; ctx.fillStyle = '#ffffff';
    const maxW = PROFILE_CENTER_OFFSET * 2 - 24; // names may not cross the midline into each other
    const rawName = overrideNames[i] || market.name;
    let displayName = rawName;
    while (displayName.length > 1 && ctx.measureText(displayName).width > maxW) displayName = displayName.slice(0, -1);
    if (displayName !== rawName) displayName += '…';
    ctx.fillText(displayName, cx, nameBaseY);

    if (price != null) {
      // Drawn sizes: white parts at 80% (price 38, pts 26), green parts at 108% (pct 25,
      // triangle 20x15). Layout anchors still use PRICE_FONT_SIZE so nothing moves.
      const priceSz = Math.round(PRICE_FONT_SIZE * 0.8);
      const ptsFontSz = 26, pctFontSz = Math.round(PCT_FONT_SIZE * 0.65 * 1.08), gap = 14, triW = 20, triH = 15;

      // Per-type readout: comparison shows the index in pts; profit shows the holding's
      // dollar value (the series are already in dollars). The green/red figure is the %
      // return — for profit that's gain on the money invested so far, shown on BOTH sides.
      let mainVal = Math.max(0.01, price), mainDec = 2, money = false, labelText = 'pts';
      const pctVal: number | null = pct;
      if (reelType === 'profit') {
        mainVal = Math.max(1, price); mainDec = 0; money = true; labelText = '';
      }

      ctx.font = `600 ${priceSz}px ${CANVAS_FONT}`;
      const priceW = roller.measure(ctx, mainVal, mainDec, money);
      ctx.font = `400 ${ptsFontSz}px ${CANVAS_FONT}`;
      const ptsW = labelText ? ctx.measureText(labelText).width : 0;
      const hasPct = pctVal != null, isUp = (pctVal ?? 0) >= 0;
      const pctColor = isUp ? '#04df9d' : '#ef4444';
      let pctW = 0;
      if (hasPct) {
        ctx.font = `600 ${pctFontSz}px ${CANVAS_FONT}`;
        pctW = roller.measure(ctx, Math.abs(pctVal!), 2) + ctx.measureText('%').width;
      }
      const pctSection = hasPct ? gap + triW + 8 + pctW : 0;
      const totalW = priceW + (labelText ? gap + ptsW : 0) + pctSection;
      let x = cx - totalW / 2;
      ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      ctx.font = `600 ${priceSz}px ${CANVAS_FONT}`; ctx.fillStyle = '#ffffff';
      roller.draw(ctx, `price${i}`, mainVal, mainDec, x, priceBaseY + (PRICE_FONT_SIZE - priceSz) / 2, priceSz, dt, money); x += priceW + gap;
      if (labelText) {
        ctx.font = `400 ${ptsFontSz}px ${CANVAS_FONT}`; ctx.fillStyle = '#ffffff';
        ctx.fillText(labelText, x, priceBaseY + (PRICE_FONT_SIZE - ptsFontSz) / 2); x += ptsW + gap;
      }
      if (hasPct) {
        const triTop = priceBaseY + (PRICE_FONT_SIZE - triH) / 2;
        ctx.fillStyle = pctColor; ctx.beginPath();
        if (isUp) { ctx.moveTo(x + triW / 2, triTop); ctx.lineTo(x + triW, triTop + triH); ctx.lineTo(x, triTop + triH); }
        else { ctx.moveTo(x, triTop); ctx.lineTo(x + triW, triTop); ctx.lineTo(x + triW / 2, triTop + triH); }
        ctx.closePath(); ctx.fill(); x += triW + 8;
        ctx.font = `600 ${pctFontSz}px ${CANVAS_FONT}`; ctx.fillStyle = pctColor;
        const pctY = priceBaseY + (PRICE_FONT_SIZE - pctFontSz) / 2 + 1;
        const pctNumW = roller.draw(ctx, `pct${i}`, Math.abs(pctVal!), 2, x, pctY, pctFontSz, dt);
        ctx.fillText('%', x + pctNumW, pctY);
      }
      ctx.textAlign = 'center';
    }
  }

  ctx.font = `600 52px ${CANVAS_FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('Vs', CANVAS_W / 2, avatarCy);

  // "Sonotrade · Link in bio" wordmark, centred just above the chart-heading caption —
  // it occupies the empty slot the old CTA vacated, so nothing else moves.
  if (linkBioImg && linkBioImg.naturalWidth > 0) {
    const w = 300;
    const h = w * (linkBioImg.naturalHeight / linkBioImg.naturalWidth); // native aspect (≈38px at 300w)
    const anchorY = dividerY + HEADERS_H - 16 - 32; // historical anchor; logo bottom sits 20px below it
    ctx.drawImage(linkBioImg, (CANVAS_W - w) / 2, anchorY + 12 - h, w, h);
  }
}

function safeExportName(raw: string) {
  return raw.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 70).replace(/[. ]+$/g, '').trim() || 'charts';
}

export const ChartsCanvas = forwardRef<ChartsCanvasRef, ChartsCanvasProps>(function ChartsCanvas(
  { overlayCaption = '', captionFontSize = 22, bannerText = '', bannerFontSize = 60, smoothing = 30, reelType = 'comparison', artistMultiplier = DEFAULT_ARTIST_MULTIPLIER, profitCumulative = true, markets, overrideNames = ['', ''], onRecordingStateChange, audioUrl, audioDurationMs, videoLengthMs },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const img0Ref = useRef<HTMLImageElement | null>(null);
  const img1Ref = useRef<HTMLImageElement | null>(null);
  const linkBioImgRef = useRef<HTMLImageElement | null>(null);
  // Per-artist line colour, derived from each artist's photo (see @/lib/imageColor),
  // matching the Video Reels landing animation. Falls back to grey until/unless a colour resolves.
  const color0Ref = useRef(FALLBACK_LINE_COLOR);
  const color1Ref = useRef(FALLBACK_LINE_COLOR);
  // Spring-driven rolling numbers (NumberFlow-style), integrated per frame.
  const rollerRef = useRef(new RollingNumber());
  const lastDrawRef = useRef(0);
  const animStartRef = useRef(0);
  const isRecordingRef = useRef(false);
  const onRecStateRef = useRef(onRecordingStateChange);
  useEffect(() => { onRecStateRef.current = onRecordingStateChange; }, [onRecordingStateChange]);
  const captionRef = useRef(overlayCaption);
  const bannerTextRef = useRef(bannerText);
  const captionFontSizeRef = useRef(captionFontSize);
  const bannerFontSizeRef = useRef(bannerFontSize);
  const smoothingRef = useRef(smoothing);
  const reelTypeRef = useRef(reelType);
  const artistMultiplierRef = useRef(artistMultiplier);
  const profitCumulativeRef = useRef(profitCumulative);
  const marketsRef = useRef(markets);
  const overrideNamesRef = useRef(overrideNames);
  useEffect(() => { captionRef.current = overlayCaption; }, [overlayCaption]);
  useEffect(() => { bannerTextRef.current = bannerText; }, [bannerText]);
  useEffect(() => { captionFontSizeRef.current = captionFontSize; }, [captionFontSize]);
  useEffect(() => { bannerFontSizeRef.current = bannerFontSize; }, [bannerFontSize]);
  useEffect(() => { smoothingRef.current = smoothing; }, [smoothing]);
  useEffect(() => { reelTypeRef.current = reelType; }, [reelType]);
  useEffect(() => { artistMultiplierRef.current = artistMultiplier; }, [artistMultiplier]);
  useEffect(() => { profitCumulativeRef.current = profitCumulative; }, [profitCumulative]);
  useEffect(() => { marketsRef.current = markets; }, [markets]);
  useEffect(() => { overrideNamesRef.current = overrideNames; }, [overrideNames]);
  const growMsRef = useRef(GROW_MS), cycleMsRef = useRef(CYCLE_MS);
  const audioUrlRef = useRef<string | null>(null);
  useEffect(() => {
    audioUrlRef.current = audioUrl ?? null;
    // Clip length priority: explicit target length > audio track duration > defaults.
    // grow = length - 3000 keeps the 3s hold on the finished chart at the end.
    const target = videoLengthMs && videoLengthMs >= 4000
      ? videoLengthMs
      : (audioDurationMs && audioDurationMs > 4000 ? audioDurationMs : null);
    if (target) { growMsRef.current = target - 3000; cycleMsRef.current = target; }
    else { growMsRef.current = GROW_MS; cycleMsRef.current = CYCLE_MS; }
  }, [audioUrl, audioDurationMs, videoLengthMs]);
  // Replay the preview when inputs change — but never mid-export: the export loop yields to
  // the event loop, so an unguarded reset would corrupt the in-flight clip (roller snap on
  // the mediabunny path; a mid-capture restart on the MediaRecorder path). The export's
  // finally block resets animStartRef afterwards, so new timing still applies post-export.
  const restartPreview = useCallback(() => {
    if (isRecordingRef.current) return;
    animStartRef.current = 0;
    rollerRef.current.reset();
  }, []);
  useEffect(() => { restartPreview(); }, [videoLengthMs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { restartPreview(); }, [markets[0]?.id, markets[1]?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { restartPreview(); }, [markets[0]?.sparkline?.length, markets[1]?.sparkline?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ▶ button: replay the preview AND play the selected track along with it. Audio only ever
  // starts from the button click (browser autoplay policies block un-gestured audio anyway);
  // it stops at the clip's end (cycleMs) to match the export, on unmount, or on track change.
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioStopRef = useRef(0);
  const stopPreviewAudio = useCallback(() => {
    window.clearTimeout(previewAudioStopRef.current);
    const a = previewAudioRef.current;
    if (a) { a.pause(); a.currentTime = 0; }
  }, []);
  useEffect(() => stopPreviewAudio, [stopPreviewAudio]); // stop on unmount
  useEffect(() => { stopPreviewAudio(); }, [audioUrl, stopPreviewAudio]); // stop when the track changes

  const replay = useCallback(() => {
    if (isRecordingRef.current) return;
    restartPreview();
    stopPreviewAudio();
    const url = audioUrlRef.current;
    if (!url) return;
    if (previewAudioRef.current?.dataset.url !== url) {
      previewAudioRef.current?.pause();
      const el = new Audio(url);
      el.dataset.url = url;
      previewAudioRef.current = el;
    }
    const a = previewAudioRef.current;
    if (activePreviewAudio && activePreviewAudio !== a) activePreviewAudio.pause();
    activePreviewAudio = a;
    a.currentTime = 0;
    a.play().catch(() => { /* e.g. decode failure — preview just runs silent */ });
    previewAudioStopRef.current = window.setTimeout(stopPreviewAudio, cycleMsRef.current);
  }, [restartPreview, stopPreviewAudio]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => { linkBioImgRef.current = img; };
    img.onerror = () => { linkBioImgRef.current = null; };
    img.src = '/sonotrade-link-in-bio.png';
  }, []);

  useEffect(() => {
    const url = markets[0]?.photo_url;
    color0Ref.current = FALLBACK_LINE_COLOR;
    if (!url) { img0Ref.current = null; return; }
    let cancelled = false;
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      img0Ref.current = img;
      try { color0Ref.current = avgColorFromImage(img) ?? FALLBACK_LINE_COLOR; } catch { color0Ref.current = FALLBACK_LINE_COLOR; }
    };
    img.onerror = () => { if (cancelled) return; img0Ref.current = null; color0Ref.current = FALLBACK_LINE_COLOR; };
    img.src = url;
    return () => { cancelled = true; };
  }, [markets[0]?.photo_url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const url = markets[1]?.photo_url;
    color1Ref.current = FALLBACK_LINE_COLOR;
    if (!url) { img1Ref.current = null; return; }
    let cancelled = false;
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      img1Ref.current = img;
      try { color1Ref.current = avgColorFromImage(img) ?? FALLBACK_LINE_COLOR; } catch { color1Ref.current = FALLBACK_LINE_COLOR; }
    };
    img.onerror = () => { if (cancelled) return; img1Ref.current = null; color1Ref.current = FALLBACK_LINE_COLOR; };
    img.src = url;
    return () => { cancelled = true; };
  }, [markets[1]?.photo_url]); // eslint-disable-line react-hooks/exhaustive-deps

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) { rafRef.current = requestAnimationFrame(draw); return; }
    const ctx = canvas.getContext('2d');
    if (!ctx) { rafRef.current = requestAnimationFrame(draw); return; }
    const now = performance.now();
    const dt = lastDrawRef.current ? (now - lastDrawRef.current) / 1000 : 1 / 60;
    lastDrawRef.current = now;
    const mksNow = marketsRef.current;
    const selectedCount = [mksNow[0], mksNow[1]].filter(Boolean).length;
    const loadedCount = [mksNow[0], mksNow[1]].filter(m => (m?.sparkline?.length ?? 0) > 0).length;
    const allLoaded = selectedCount > 0 && loadedCount >= selectedCount;
    if (allLoaded && animStartRef.current === 0) animStartRef.current = now;
    const cursorT = animStartRef.current === 0 ? 0 : Math.min((now - animStartRef.current) / growMsRef.current, 1);
    ctx.imageSmoothingQuality = 'high'; // sharper downscales (logo, avatars)
    ctx.fillStyle = '#0A0A0A'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    drawProfiles(ctx, mksNow, [img0Ref.current, img1Ref.current], CAPTION_AREA_H, cursorT, overrideNamesRef.current, [color0Ref.current, color1Ref.current], rollerRef.current, dt, bannerTextRef.current, bannerFontSizeRef.current, linkBioImgRef.current, smoothingRef.current, reelTypeRef.current, artistMultiplierRef.current, profitCumulativeRef.current);
    drawCaption(ctx, captionRef.current, CAPTION_AREA_H + HEADERS_H + 24, captionFontSizeRef.current, 2, { color: 'rgba(255,255,255,0.15)' });
    rafRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  useImperativeHandle(ref, () => {
    // Render the reel to an MP4 blob — shared by Export (download) and Publish (upload).
    // Returns null when already rendering, inputs aren't loaded, or the render fails
    // (errors are surfaced through recState before returning).
    const runExport = async (): Promise<{ blob: Blob; filename: string } | null> => {
      const canvas = canvasRef.current;
      if (!canvas || isRecordingRef.current) return null;
      const mks = marketsRef.current;
      const loadedCount = mks.filter(m => (m?.sparkline?.length ?? 0) > 0).length;
      if (mks.filter(Boolean).length === 0 || loadedCount === 0) return null;
      stopPreviewAudio(); // don't let a running preview track overlap the export
      isRecordingRef.current = true;
      cancelAnimationFrame(rafRef.current);
      const notify = (isRecording: boolean, recProgress: number, recStatus: string) =>
        onRecStateRef.current?.({ isRecording, recProgress, recStatus });
      notify(true, 0, 'Processing…');
      try {
        const cycleMs = cycleMsRef.current;
        const growMs  = growMsRef.current;
        const FPS = 30;
        const totalFrames = Math.ceil((cycleMs / 1000) * FPS);
        const ctx = canvas.getContext('2d')!;

        // ── mediabunny path (Chrome/Edge — same library as angelstyle2) ─────
        if (typeof VideoEncoder !== 'undefined') {
          const {
            Output, Mp4OutputFormat, BufferTarget,
            VideoSample, VideoSampleSource,
            EncodedAudioPacketSource, EncodedPacket,
            QUALITY_HIGH,
          } = await import('mediabunny');

          const MERGED_SR = 44100;
          const AFRAME = 1024;
          const FRAME_DUR = 1 / FPS;

          // ── Decode + encode audio up-front ──────────────────────────────────
          let audioSource: InstanceType<typeof EncodedAudioPacketSource> | null = null;
          const audioPackets: InstanceType<typeof EncodedPacket>[] = [];
          let audioDecoderConfig: AudioDecoderConfig | null = null;

          if (audioUrlRef.current) {
            try {
              notify(true, 0.02, 'Decoding audio…');
              const arrayBuf = await fetch(audioUrlRef.current).then(r => r.arrayBuffer());
              const tempCtx = new AudioContext({ sampleRate: MERGED_SR });
              const audioBuffer = await tempCtx.decodeAudioData(arrayBuf);
              await tempCtx.close();

              const totalSamples = audioBuffer.length;
              const mixCh = audioBuffer.numberOfChannels;
              const chunks: EncodedAudioChunk[] = [];
              let encCfg: AudioDecoderConfig | null = null;
              let encErr: Error | null = null;
              const enc = new AudioEncoder({
                output: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => {
                  chunks.push(chunk);
                  if (meta?.decoderConfig && !encCfg) encCfg = meta.decoderConfig as AudioDecoderConfig;
                },
                error: (e: Error) => { encErr = e; },
              });
              enc.configure({ codec: 'mp4a.40.2', sampleRate: MERGED_SR, numberOfChannels: mixCh, bitrate: 128_000 });

              const chData = Array.from({ length: mixCh }, (_, c) => audioBuffer.getChannelData(c));
              let tMicros = 0;
              for (let offset = 0; offset < totalSamples; offset += AFRAME) {
                if (tMicros >= cycleMs * 1000) break; // truncate audio to the video's target length
                const fc = Math.min(AFRAME, totalSamples - offset);
                const planar = new Float32Array(fc * mixCh);
                for (let c = 0; c < mixCh; c++) {
                  const src = chData[c];
                  for (let i = 0; i < fc; i++) planar[c * fc + i] = src[offset + i] ?? 0;
                }
                const ad = new AudioData({ format: 'f32-planar', sampleRate: MERGED_SR, numberOfFrames: fc, numberOfChannels: mixCh, timestamp: tMicros, data: planar });
                enc.encode(ad);
                ad.close();
                tMicros += Math.round((fc / MERGED_SR) * 1_000_000);
              }
              await enc.flush();
              enc.close();
              if (encErr) throw encErr;

              if (chunks.length > 0) {
                if (!encCfg) {
                  const sfIdx = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000].indexOf(MERGED_SR);
                  const si = sfIdx >= 0 ? sfIdx : 4;
                  encCfg = { codec: 'mp4a.40.2', sampleRate: MERGED_SR, numberOfChannels: mixCh, description: new Uint8Array([(2 << 3) | (si >> 1), ((si & 1) << 7) | (mixCh << 3)]) };
                }
                audioDecoderConfig = encCfg;
                for (const chunk of chunks) audioPackets.push(EncodedPacket.fromEncodedChunk(chunk));
              }
            } catch (e) { console.warn('[charts-export] audio encode failed:', e); }
          }

          // ── Set up output container ──────────────────────────────────────────
          const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
          const videoSource = new VideoSampleSource({ codec: 'avc', bitrate: QUALITY_HIGH });
          output.addVideoTrack(videoSource);
          if (audioPackets.length > 0) {
            audioSource = new EncodedAudioPacketSource('aac');
            output.addAudioTrack(audioSource);
          }
          await output.start();

          // ── Render frames to OffscreenCanvas → VideoSample ──────────────────
          const offscreen = new OffscreenCanvas(CANVAS_W, CANVAS_H);
          const offCtx = offscreen.getContext('2d')!;
          const imgs = [img0Ref.current, img1Ref.current] as [HTMLImageElement | null, HTMLImageElement | null];
          // Snapshot colours ONCE (paired with imgs) so a photo finishing load mid-encode can't
          // shift a line's colour partway through the exported video or desync it from the avatar.
          const exportColors = [color0Ref.current, color1Ref.current] as [string, string];
          rollerRef.current.reset(); // deterministic spring from a clean state for the export

          for (let f = 0; f < totalFrames; f++) {
            const frameMs = (f / FPS) * 1000;
            const targetTs = frameMs / 1000;
            const cursorT = Math.min(frameMs / growMs, 1);

            offCtx.imageSmoothingQuality = 'high';
            offCtx.fillStyle = '#0A0A0A';
            offCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
            drawProfiles(offCtx as unknown as CanvasRenderingContext2D, mks, imgs, CAPTION_AREA_H, cursorT, overrideNamesRef.current, exportColors, rollerRef.current, 1 / FPS, bannerTextRef.current, bannerFontSizeRef.current, linkBioImgRef.current, smoothingRef.current, reelTypeRef.current, artistMultiplierRef.current, profitCumulativeRef.current);
            drawCaption(offCtx as unknown as CanvasRenderingContext2D, captionRef.current, CAPTION_AREA_H + HEADERS_H + 24, captionFontSizeRef.current, 2, { color: 'rgba(255,255,255,0.15)' });

            const sample = new VideoSample(offscreen, { timestamp: targetTs, duration: FRAME_DUR });
            await videoSource.add(sample);
            sample.close();

            if (f % 15 === 0) {
              notify(true, 0.05 + (f / totalFrames) * (audioPackets.length > 0 ? 0.7 : 0.88), 'Rendering…');
              await new Promise<void>(r => setTimeout(r, 0));
            }
          }

          // ── Add audio packets ────────────────────────────────────────────────
          if (audioSource && audioPackets.length > 0) {
            notify(true, 0.78, 'Adding audio…');
            for (let i = 0; i < audioPackets.length; i++) {
              await audioSource.add(audioPackets[i], i === 0 ? { decoderConfig: audioDecoderConfig ?? undefined } : undefined);
            }
          }

          notify(true, 0.95, 'Saving…');
          await output.finalize();
          const buffer = (output.target as InstanceType<typeof BufferTarget>).buffer;
          if (!buffer) throw new Error('No buffer from mediabunny output');
          const blob = new Blob([buffer], { type: 'video/mp4' });
          return { blob, filename: `${safeExportName(captionRef.current || 'charts')}.mp4` };

        } else {
          // ── MediaRecorder fallback (Safari / Firefox) ─────────────────────
          const mimeType =
            typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4;codecs=avc1') ? 'video/mp4;codecs=avc1'
            : typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4'
            : 'video/webm;codecs=vp9';
          animStartRef.current = 0;
          rafRef.current = requestAnimationFrame(draw);
          await new Promise<void>(r => setTimeout(r, 80));
          const stream = canvas.captureStream(FPS);
          let audioEl: HTMLAudioElement | null = null, audioCtx: AudioContext | null = null;
          if (audioUrlRef.current) {
            try {
              audioEl = new Audio(); audioEl.src = audioUrlRef.current; audioEl.crossOrigin = 'anonymous'; audioEl.preload = 'auto';
              audioCtx = new AudioContext();
              const src = audioCtx.createMediaElementSource(audioEl);
              const dest = audioCtx.createMediaStreamDestination();
              src.connect(dest); dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
              await new Promise<void>(res => { if (!audioEl || audioEl.readyState >= 3) { res(); return; } audioEl.oncanplay = () => res(); setTimeout(res, 6000); });
            } catch { audioEl = null; audioCtx = null; }
          }
          const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
          const chunks: Blob[] = [];
          recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
          recorder.start(200);
          if (audioEl && audioCtx) { audioEl.currentTime = 0; await audioCtx.resume(); audioEl.play().catch(() => {}); }
          const startMs = performance.now();
          await new Promise<void>(resolve => {
            const tick = () => {
              const p = Math.min((performance.now() - startMs) / cycleMs, 1);
              notify(true, p, 'Recording…');
              if (p >= 1) resolve(); else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
          audioEl?.pause(); audioCtx?.close().catch(() => {});
          recorder.stop();
          await new Promise<void>(r => { recorder.onstop = () => r(); });
          const blob = new Blob(chunks, { type: mimeType });
          return { blob, filename: `${safeExportName(captionRef.current || 'charts')}.mp4` };
        }
      } catch (err) {
        notify(true, 0, `Error: ${err instanceof Error ? err.message : String(err)}`);
        setTimeout(() => notify(false, 0, ''), 5000);
        return null;
      } finally {
        isRecordingRef.current = false;
        animStartRef.current = 0;
        // The MediaRecorder fallback already restarted the draw loop — cancel before
        // re-scheduling so each export can't leak an extra self-perpetuating RAF loop.
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(draw);
      }
    };

    return {
      replay,
      startDownload: async () => {
        const res = await runExport();
        if (!res) return;
        const dlUrl = URL.createObjectURL(res.blob);
        Object.assign(document.createElement('a'), { href: dlUrl, download: res.filename }).click();
        URL.revokeObjectURL(dlUrl);
        onRecStateRef.current?.({ isRecording: true, recProgress: 1, recStatus: 'Saved ✓' });
        setTimeout(() => onRecStateRef.current?.({ isRecording: false, recProgress: 0, recStatus: '' }), 3000);
      },
      exportBlob: async () => {
        const res = await runExport();
        // Clear the render status — the publish flow drives its own from here.
        if (res) onRecStateRef.current?.({ isRecording: false, recProgress: 0, recStatus: '' });
        return res?.blob ?? null;
      },
      cancelExport: () => {
        isRecordingRef.current = false;
        onRecStateRef.current?.({ isRecording: false, recProgress: 0, recStatus: '' });
      },
      getTrimState: () => ({ trimStart: 0, trimEnd: 0, duration: 0, includeEdit: false, videoScale: 1, blockTopPct: CAPTION_AREA_H / CANVAS_H }),
    };
  }, []);

  return (
    <div className="relative select-none" style={{ width: CANVAS_W * DISPLAY_SCALE, height: CANVAS_H * DISPLAY_SCALE, overflow: 'visible' }}>
      <canvas
        ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
        className="block border border-zinc-700"
        style={{ width: CANVAS_W * DISPLAY_SCALE, height: CANVAS_H * DISPLAY_SCALE }}
      />
    </div>
  );
});
