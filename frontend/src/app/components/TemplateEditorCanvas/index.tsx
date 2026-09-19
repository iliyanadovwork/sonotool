'use client';

import React, { useRef, useEffect, useLayoutEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { QUOTE_STYLES, QUOTE_STYLES_PAIRED, ALL_QUOTE_STYLES } from '../templateEditorQuoteStyles';
import type { QuoteStyle } from '../templateEditorQuoteStyles';
import type { ChartBox,
  TemplateEditorCanvasRef, SelectedElement, CarouselTextAlign, CarouselFontLabel,
  CarouselSettings, CarouselBgLayerState, SlotContent, LayerId, TagStyle, TextSpan,
  SidebarElementData, DividerSubSlotContent, DividerStyleSettings, ImageBoxFade, FadeStop,
  ImageBox, ImageEffects, TextBoxStyle, ImageBoxPerspective, PerspectiveMode,
  SwipeStyle, SwipeArrowType, SwipeLayout, SwipeDirection, ShadowStyle,
} from '../templateEditorTypes';
import { removeBackgroundBlob } from './imageRemoval';
import { warpImageToQuad, type WarpPt } from './perspectiveWarp';
import {
  MAX_FONT, SUB_MAX, defaultTagStyle, TAG_PRESETS, defaultDividerSettings,
  defaultSwipeStyle, SWIPE_PRESETS, defaultFadeStops, sampleFadeStops, orderedLayerIds, FADE_LAYER_ID,
  hasGeometryLock, hasFullImageLock, IMAGES_LAYER_ID,
} from '../templateEditorTypes';
import { ElementLayersPanel } from '../ElementLayersPanel';
import { resolveCarouselFont, useCustomFonts } from '../customFonts';
import { LayersPanel } from '../TemplateEditorSettingsPanel';
import { TemplateEditorSwipePreviewMini } from '../TemplateEditorSwipePreviewMini';

import {
  CAROUSEL_W as W, CAROUSEL_H as H,
  CAROUSEL_PREVIEW_W, CAROUSEL_PREVIEW_H,
  DISPLAY_SCALE,
  LOGO_PH, LOGO_CW, LOGO_CH,
} from './constants';
export { CAROUSEL_PREVIEW_W, CAROUSEL_PREVIEW_H, LOGO_PH };

import { divHexToRgba, drawWaveSegment, applyShadow, clearShadow, drawDividerOnCanvas, getSubZoneCanvasBounds } from './drawing/divider';
import { ensureFontLoaded, wrapText, drawAligned, hexToRgba, roundRectPath, drawTag, drawLogoFit } from './drawing/helpers';
import { drawChart, chartImageUrls, chartAspect, ensureChartFont, CHART_ANIM_TOTAL_MS } from './drawing/chart';
import { drawSwipeArrow, drawSwipeOnCanvas } from './drawing/swipe';
import { wrapTextOffsets, wrapSpanLines, getLineSpanSegs, drawSpanLine, spansToHtml, rgbToHex, htmlToSpans, buildFiller, alternateWeightSpans, layoutFitToWidth } from './drawing/spans';

const RICH_COLORS = [
  '#ffffff', '#000000', '#9ca3af',
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e',
];

// ── HARD single-line (TextBoxStyle.singleLine) helpers ──────────────────────────────────────────
// A single-line box never wraps and never renders more than one line ('\n' draws as a space) at a
// FIXED font size. While inline-editing, any insertion that would make that one line wider than the
// box is refused. These helpers splice a would-be edit into the box's spans and locate/restore the
// caret so the refusal can be measured (and rolled back) with the canvas's own text measurement.
const SINGLE_LINE_EPS = 0.5;   // sub-pixel tolerance so a line measuring exactly the box width fits

// Global character offset of a DOM point inside the inline editor, counted the same way htmlToSpans
// counts characters (text-node text; <br> = 1 char), so offsets line up with the extracted spans.
function editorOffsetOf(root: HTMLElement, node: Node, offset: number): number {
  let count = 0;
  let found = false;
  const walk = (n: Node) => {
    if (found) return;
    if (n.nodeType === Node.TEXT_NODE) {
      if (n === node) { count += offset; found = true; return; }
      count += (n.textContent ?? '').length;
      return;
    }
    if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).tagName === 'BR') { count += 1; return; }
    const kids = Array.from(n.childNodes);
    for (let i = 0; i < kids.length; i++) {
      if (n === node && i === offset) { found = true; return; }   // element-anchored caret: before child i
      walk(kids[i]);
      if (found) return;
    }
    if (n === node) found = true;   // offset ≥ childCount → caret at the end of this element
  };
  walk(root);
  return count;
}

// Put a collapsed caret at global character offset `target` (same counting as editorOffsetOf).
function restoreEditorCaret(root: HTMLElement, target: number) {
  const sel = window.getSelection();
  if (!sel) return;
  let remaining = target;
  let done = false;
  const place = (node: Node, off: number) => {
    const r = document.createRange();
    r.setStart(node, off);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    done = true;
  };
  const walk = (n: Node) => {
    if (done) return;
    if (n.nodeType === Node.TEXT_NODE) {
      const len = (n.textContent ?? '').length;
      if (remaining <= len) { place(n, remaining); return; }
      remaining -= len;
      return;
    }
    if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).tagName === 'BR') { remaining = Math.max(0, remaining - 1); return; }
    for (const kid of Array.from(n.childNodes)) { walk(kid); if (done) return; }
  };
  walk(root);
  if (!done) {   // offset past the end → caret at the very end
    const r = document.createRange();
    r.selectNodeContents(root);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }
}

// The would-be spans after an edit: `insert` replaces global range [start, end). The inserted run
// inherits the style of the span just before the caret (matches browser typing behaviour) — style
// only matters for width when weights differ, and this mirrors what the DOM will actually do.
function spliceSpansAt(spans: TextSpan[], start: number, end: number, insert: string): TextSpan[] {
  const out: TextSpan[] = [];
  let pos = 0;
  let insStyle: TextSpan | undefined;
  let placed = false;
  const place = () => {
    if (placed) return;
    placed = true;
    if (insert) out.push({ ...(insStyle ?? {}), text: insert });
  };
  for (const sp of spans) {
    const s = pos, e = pos + sp.text.length;
    pos = e;
    if (e <= start) { out.push(sp); insStyle = sp; continue; }   // wholly before the edited range
    if (s < start) { out.push({ ...sp, text: sp.text.slice(0, start - s) }); insStyle = sp; }
    place();
    if (e > end) {
      const t = sp.text.slice(Math.max(0, end - s));
      if (t) out.push({ ...sp, text: t });
    }
  }
  place();   // caret at the very end (or an empty box)
  return out;
}

// ── Image-box subject-split effect helpers (foreground / background adjustments) ──
function imageEffectsActive(e?: ImageEffects): boolean {
  return !!e && ((e.brightness ?? 0) !== 0 || (e.blur ?? 0) > 0 || (e.noise ?? 0) > 0);
}
function imageFadeActive(f?: ImageBoxFade): boolean {
  return !!f && (f.enabled ?? true) && ((f.top ?? 0) > 0 || (f.bottom ?? 0) > 0 || (f.left ?? 0) > 0 || (f.right ?? 0) > 0);
}
// Perspective is active when any corner is offset from the box's natural rectangle.
function perspectiveActive(p?: ImageBoxPerspective): boolean {
  if (!p) return false;
  for (const c of [p.tl, p.tr, p.br, p.bl]) if ((c?.x ?? 0) !== 0 || (c?.y ?? 0) !== 0) return true;
  return false;
}
const IDENTITY_PERSPECTIVE: ImageBoxPerspective = { tl: { x: 0, y: 0 }, tr: { x: 0, y: 0 }, br: { x: 0, y: 0 }, bl: { x: 0, y: 0 } };
type Corner = 'tl' | 'tr' | 'br' | 'bl';
const ROW_PARTNER: Record<Corner, Corner> = { tl: 'tr', tr: 'tl', bl: 'br', br: 'bl' }; // same horizontal edge
const COL_PARTNER: Record<Corner, Corner> = { tl: 'bl', bl: 'tl', tr: 'br', br: 'tr' }; // same vertical edge
// The 4 perspective corner handles, with their fractional position on the box rect.
const PCORNERS: { id: Corner; fx: 0 | 1; fy: 0 | 1 }[] = [
  { id: 'tl', fx: 0, fy: 0 }, { id: 'tr', fx: 1, fy: 0 }, { id: 'br', fx: 1, fy: 1 }, { id: 'bl', fx: 0, fy: 1 },
];
// Update the destination quad when a corner is dragged by (dpx, dpy) canvas px from `start`,
// constrained by the active mode. Distort = free corner; Perspective = the same-edge partner
// mirrors (symmetric trapezoid, axis chosen by the dominant drag direction); Skew = the same-edge
// partner follows (the whole edge slides → parallelogram).
function updatePerspective(id: Corner, dpx: number, dpy: number, start: ImageBoxPerspective, mode: PerspectiveMode): ImageBoxPerspective {
  const p: ImageBoxPerspective = { tl: { ...start.tl }, tr: { ...start.tr }, br: { ...start.br }, bl: { ...start.bl } };
  if (mode === 'distort') {
    p[id] = { x: start[id].x + dpx, y: start[id].y + dpy };
  } else if (mode === 'perspective') {
    if (Math.abs(dpx) >= Math.abs(dpy)) {
      const r = ROW_PARTNER[id];
      p[id] = { ...p[id], x: start[id].x + dpx };
      p[r]  = { ...p[r],  x: start[r].x - dpx };
    } else {
      const c = COL_PARTNER[id];
      p[id] = { ...p[id], y: start[id].y + dpy };
      p[c]  = { ...p[c],  y: start[c].y - dpy };
    }
  } else { // skew
    if (Math.abs(dpx) >= Math.abs(dpy)) {
      const r = ROW_PARTNER[id];
      p[id] = { ...p[id], x: start[id].x + dpx };
      p[r]  = { ...p[r],  x: start[r].x + dpx };
    } else {
      const c = COL_PARTNER[id];
      p[id] = { ...p[id], y: start[id].y + dpy };
      p[c]  = { ...p[c],  y: start[c].y + dpy };
    }
  }
  return p;
}
// brightness + gaussian blur as GPU ctx.filter ops. The blur radius is in DEVICE px
// (blur × sc) and applied with no scale transform active, exactly like the main bg blur
// (`blur(amount * sc)`), so preview (sc=1) and 4× export stay visually consistent.
// Returns 'none' when no-op.
function imageEffectsFilter(e: ImageEffects | undefined, sc: number): string {
  const parts: string[] = [];
  const b = e?.brightness ?? 0;
  const blur = e?.blur ?? 0;
  if (b !== 0)   parts.push(`brightness(${Math.max(0, 1 + b / 100)})`);
  if (blur > 0)  parts.push(`blur(${Math.max(1, Math.round(blur * sc))}px)`);
  return parts.length ? parts.join(' ') : 'none';
}
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// Chris Wellons' "lowbias32" integer hash — strong avalanche, so hashing a coordinate/counter
// yields white-noise-quality output. A single xorshift round (the previous approach) leaves
// neighbouring pixels correlated, producing a visible lattice/moiré; this fully decorrelates.
function hashU32(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x >>> 0;
}
// Monochromatic (grayscale) Gaussian noise over an ImageData buffer — film-grain-like white
// noise, the way Photoshop's Add Noise (Gaussian + Monochromatic) does it: each pixel is an
// INDEPENDENT normal draw (no spatial structure). Deterministic (the randomness comes from a
// strong hash of the canvas-space coordinate + per-layer seed, not Math.random), so it never
// flickers on redraw and the 4× export matches the preview; sampled at col = floor(px / sc)
// so grain size is the same in preview (sc=1) and export.
function applyMonoNoise(data: Uint8ClampedArray, w: number, h: number, sc: number, amount: number, seed: number, skipTransparent: boolean): void {
  if (amount <= 0) return;
  const sigma = (amount / 100) * 40;           // Gaussian std-dev in luma levels at 100%
  const step  = Math.max(1, Math.round(sc));
  const TAU   = Math.PI * 2;
  for (let y = 0; y < h; y++) {
    const cy = (y / step) | 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) << 2;
      if (skipTransparent && data[i + 3] === 0) continue;
      const cx = (x / step) | 0;
      // White-noise per-pixel randomness: avalanche-hash the canvas coord + seed, then derive
      // a second independent stream by re-hashing — gives two decorrelated uniforms.
      const r1 = hashU32((Math.imul(cx, 374761393) + Math.imul(cy, 3266489917) + seed) | 0);
      const r2 = hashU32(r1 ^ 0x9e3779b9);
      // Box–Muller transform → standard normal, scaled to sigma.
      const u1 = (r1 + 0.5) / 4294967296;      // (0,1) — avoid log(0)
      const u2 = r2 / 4294967296;              // [0,1)
      const d = Math.sqrt(-2 * Math.log(u1)) * Math.cos(TAU * u2) * sigma;
      data[i]     += d;   // Uint8ClampedArray clamps to [0,255] on assignment
      data[i + 1] += d;
      data[i + 2] += d;
    }
  }
}

// Paint one effect layer into a device-pixel buffer context: brightness + gaussian blur (ctx.filter),
// then monochromatic noise. When overdraw is true (a box-filling layer whose blurred edges should stay
// solid edge-to-edge), the draw is over-extended past the buffer so the blur kernel never samples the
// transparent area outside the image. When overdraw is false the blur fades to transparent at the edges
// — wanted for the subject cut-out's silhouette, and opt-in for box-filling layers via blurEdgeFade.
function paintLayer(
  tctx: CanvasRenderingContext2D, image: CanvasImageSource, effects: ImageEffects | undefined, seed: number,
  w: number, h: number, sc: number, sx: number, sy: number, sw: number, sh: number, overdraw: boolean,
): void {
  const blur = effects?.blur ?? 0;
  tctx.filter = imageEffectsFilter(effects, sc);
  if (overdraw && blur > 0) {
    const m = Math.max(1, Math.round(blur * sc)) * 2;
    tctx.drawImage(image, sx, sy, sw, sh, -m, -m, w + 2 * m, h + 2 * m);
  } else {
    tctx.drawImage(image, sx, sy, sw, sh, 0, 0, w, h);
  }
  tctx.filter = 'none';
  const noise = effects?.noise ?? 0;
  if (noise > 0) {
    try {
      const id = tctx.getImageData(0, 0, w, h);
      applyMonoNoise(id.data, w, h, sc, noise, seed, true);
      tctx.putImageData(id, 0, 0);
    } catch { /* tainted canvas — skip noise rather than break the render/export */ }
  }
}

// Clipboard for copy/paste of a layer (text or image box). Module-level singleton so it survives the
// active canvas re-rendering with another slide/template's settings — enabling paste across canvases.
// A copied composition: the selected layers in bottom→top order, with a 'fade' marker at the fade's
// position, plus the fade settings — so ⌘/Ctrl+V reproduces the EXACT layer order (fade included)
// even when pasting into a different slide.
type LayerClipItem =
  | { kind: 'text';  box: TextBoxStyle; srcId: string }
  | { kind: 'image'; box: ImageBox;     srcId: string }
  | { kind: 'chart'; box: ChartBox;     srcId: string }
  | { kind: 'fade' };
let layerClipboard: { items: LayerClipItem[]; fade: Partial<CarouselSettings> | null } | null = null;

// True when an internal layer is on the clipboard (copied via ⌘/Ctrl+C). The canvas's keydown
// handler claims ⌘/Ctrl+V for layer-paste in that case, so other ⌘/Ctrl+V listeners (e.g. the
// post-images paste-to-upload in TemplateEditorGrid) can defer to it instead of double-acting.
export function hasLayerClipboard(): boolean { return !!layerClipboard && layerClipboard.items.some(i => i.kind !== 'fade'); }

// Snap guide lines for moving/resizing boxes: canvas edges, 60px margins, and centre.
const SNAP_PX = 12, SNAP_EDGE = 60;
const X_GUIDES = [0, SNAP_EDGE, W / 2, W - SNAP_EDGE, W];
const Y_GUIDES = [0, SNAP_EDGE, H / 2, H - SNAP_EDGE, H];
function nearestGuide(v: number, guides: number[], thresh = SNAP_PX): number | null {
  let best: number | null = null, bestD = thresh;
  for (const g of guides) { const d = Math.abs(v - g); if (d <= bestD) { bestD = d; best = g; } }
  return best;
}

// Apply per-edge fades inside an image box's offscreen buffer (coords in canvas px).
// No colour → erase the image's alpha toward the edge (destination-out).
// Colour set → paint the colour over the image toward the edge (source-atop, so it
// only affects the image's existing pixels — transparent areas stay transparent).
function paintImageBoxFades(bctx: CanvasRenderingContext2D, fade: ImageBoxFade, bw: number, bh: number) {
  const transparent = !fade.color;
  const colorAt = transparent
    ? (a: number) => `rgba(0,0,0,${a.toFixed(3)})`
    : (a: number) => hexToRgba(fade.color!, a);
  const st = fade.stops ?? {};
  // Each edge's gradient runs from the edge (pos 0) inward to its reach distance (pos 1),
  // following that edge's opacity curve (default = linear ramp). vis = image visibility, so
  // the fill alpha (erase amount in transparent mode / colour cover in colour mode) is 1 - vis.
  const grad = (x0: number, y0: number, x1: number, y1: number, stops: FadeStop[]) => {
    const g = bctx.createLinearGradient(x0, y0, x1, y1);
    for (const { pos, vis } of sampleFadeStops(stops)) g.addColorStop(Math.min(1, Math.max(0, pos)), colorAt(1 - vis));
    return g;
  };
  bctx.save();
  bctx.globalCompositeOperation = transparent ? 'destination-out' : 'source-atop';
  const t = fade.top ?? 0, b = fade.bottom ?? 0, l = fade.left ?? 0, r = fade.right ?? 0;
  if (t > 0) { const d = bh * t / 100; bctx.fillStyle = grad(0, 0, 0, d,       st.top    ?? defaultFadeStops()); bctx.fillRect(0, 0, bw, d); }
  if (b > 0) { const d = bh * b / 100; bctx.fillStyle = grad(0, bh, 0, bh - d, st.bottom ?? defaultFadeStops()); bctx.fillRect(0, bh - d, bw, d); }
  if (l > 0) { const d = bw * l / 100; bctx.fillStyle = grad(0, 0, d, 0,       st.left   ?? defaultFadeStops()); bctx.fillRect(0, 0, d, bh); }
  if (r > 0) { const d = bw * r / 100; bctx.fillStyle = grad(bw, 0, bw - d, 0, st.right  ?? defaultFadeStops()); bctx.fillRect(bw - d, 0, d, bh); }
  bctx.restore();
}

interface TemplateEditorCanvasProps {
  imageSrc: string;
  videoSrc?: string;
  headline: string;
  subheadline: string;
  settings: CarouselSettings;
  onScaleChange?: (scale: number) => void;
  onSettingsChange?: (partial: Partial<CarouselSettings>) => void;
  onBgLayerStateChange?: (s: CarouselBgLayerState) => void;
  brandLogoSrc?: string;
  onRecordingStateChange?: (state: { isRecording: boolean; recProgress: number; recStatus: string }) => void;
  onHeadlineChange?: (text: string) => void;
  onSubheadlineChange?: (text: string) => void;
  rectMode?: boolean;
  isDraggingElement?: boolean;
  invertedSlots?: boolean;
  onSlotDrop?: (slotIndex: number, data: SidebarElementData) => void;
  staticMode?: boolean;
  onSelectedImageBoxChange?: (idx: number | null) => void;
  onTextEditStateChange?: (s: { boxIndex: number | null; hasSelection: boolean }) => void;
  // Unified selection signal (text OR image plain-selection) for the inspector's element accordion.
  onSelectionChange?: (sel: SelectedElement | null) => void;
  lockImageAspect?: boolean;
  previewPlaceholders?: boolean;   // draw empty-placeholder frames even in export/headless render (a slot preview)
  cleanView?: boolean;   // hide all editor chrome (frames, guides, slots, handles) for a clean preview
  hideLayersPanel?: boolean;   // suppress the floating layers panel (it's rendered in the right inspector instead)
  // Subject split: upload a per-box cut-out PNG (returns its public URL) so it persists; report per-box bg-removal status.
  onUploadImage?: (blob: Blob, filename: string) => Promise<string | null>;
  onUploadVideo?: (file: File) => Promise<string | null>;   // upload an mp4 (post-videos), returns public URL
  onImageBoxBgStateChange?: (statuses: Record<string, 'processing' | 'error'>) => void;
  // Image expansion preview: id of the box being set up for BRIA expand — shades the fill area on the canvas.
  expandPreviewBoxId?: string | null;
  // Perspective/distort transform: the box whose corner handles are shown, and the active edit mode.
  perspectiveBoxId?: string | null;
  perspectiveMode?: PerspectiveMode;
  // Posts mode: enforce per-box `lockedProps` (template-frozen styling/geometry). Geometry-locked
  // text boxes stay selectable + inline-editable but can't be dragged/resized/nudged by the USER
  // (programmatic writes like the fit-to-width height hug are unaffected). Off in the template editor.
  enforceLocks?: boolean;
}

// ── TemplateEditorCanvas (canvas + pan/zoom only) ──────────────────────────────────

const TemplateEditorCanvas = forwardRef<TemplateEditorCanvasRef, TemplateEditorCanvasProps>(
  function TemplateEditorCanvas({ imageSrc, videoSrc, headline, subheadline, settings, onScaleChange, onSettingsChange, onBgLayerStateChange, brandLogoSrc, onRecordingStateChange, onHeadlineChange, onSubheadlineChange, rectMode = false, isDraggingElement = false, invertedSlots = false, onSlotDrop, staticMode = false, onSelectedImageBoxChange, onTextEditStateChange, onSelectionChange, lockImageAspect = true, previewPlaceholders = false, cleanView = false, hideLayersPanel = false, onUploadImage, onUploadVideo, onImageBoxBgStateChange, expandPreviewBoxId, perspectiveBoxId, perspectiveMode = 'distort', enforceLocks = false }, ref) {
    const canvasRef    = useRef<HTMLCanvasElement>(null);
    const wrapperRef   = useRef<HTMLDivElement>(null);
    const cachedImgRef = useRef<HTMLImageElement | null>(null);
    const videoRef     = useRef<HTMLVideoElement>(null);
    const animFrameRef  = useRef<number | null>(null);
    const pulseAlphaRef = useRef(0.12);
    const isDraggingElementRef = useRef(isDraggingElement);
    const invertedSlotsRef     = useRef(invertedSlots);
    const pulseRafRef   = useRef<number | null>(null);
    const videoModeRef = useRef(!!videoSrc);
    useEffect(() => { videoModeRef.current = !!videoSrc; }, [videoSrc]);
    const trimStartRef = useRef(0);
    const trimEndRef   = useRef(Infinity);

    const videoSrcRef = useRef<string | undefined>(videoSrc);
    useEffect(() => { videoSrcRef.current = videoSrc; }, [videoSrc]);
    const [isVideoExporting,    setIsVideoExporting]    = useState(false);
    const isVideoExportingRef = useRef(false);
    useEffect(() => { isVideoExportingRef.current = isVideoExporting; }, [isVideoExporting]);
    const [videoExportProgress, setVideoExportProgress] = useState(0);
    // Which video box is currently playing (with sound) in the editor — at most one at a time. null = all paused.
    const [playingVideoUrl, setPlayingVideoUrl] = useState<string | null>(null);
    const [videoExportStatus,   setVideoExportStatus]   = useState('');
    const videoExportAbortRef         = useRef<AbortController | null>(null);
    const onRecordingStateChangeRef   = useRef(onRecordingStateChange);
    useEffect(() => { onRecordingStateChangeRef.current = onRecordingStateChange; }, [onRecordingStateChange]);

    const imgOffsetRef      = useRef({ x: 0, y: 0 });
    const imgScaleRef       = useRef(1);
    // Stores committed crop as source-rect in image's natural pixel coords
    const imgSrcCropRef     = useRef<{ sx: number; sy: number; sw: number; sh: number } | null>(null);
    // Saved state from before entering crop mode (for Escape / cancel)
    const cropEntryStateRef = useRef<{
      crop:  typeof imgSrcCropRef.current;
      ox: number; oy: number; sc: number;
    } | null>(null);
    const [imgScale,   setImgScale]   = useState(1);
    const [isDragging, setIsDragging] = useState(false);
    const [isCropMode, setIsCropMode] = useState(false);
    const [cropRect,   setCropRect]   = useState({ x: 0, y: 0, w: CAROUSEL_PREVIEW_W, h: CAROUSEL_PREVIEW_H });
    const [cropLock,   setCropLock]   = useState<'free' | '4:5'>('free');
    const dragStartRef     = useRef({ mx: 0, my: 0, ox: 0, oy: 0 });
    const cropOverlayRef   = useRef<HTMLCanvasElement>(null);
    const cropActiveHandle = useRef<string | null>(null);
    const cropDragStart    = useRef({ mx: 0, my: 0, rect: { x: 0, y: 0, w: 0, h: 0 } });
    const cropRectRef      = useRef({ x: 0, y: 0, w: CAROUSEL_PREVIEW_W, h: CAROUSEL_PREVIEW_H });
    const cropLockRef      = useRef<'free' | '4:5'>('free');
    useEffect(() => { cropRectRef.current = cropRect; }, [cropRect]);
    useEffect(() => { cropLockRef.current = cropLock; }, [cropLock]);

    const [slots,         setSlots]         = useState<(SlotContent | null)[]>(Array(3).fill(null));
    const slotsRef        = useRef<(SlotContent | null)[]>(Array(6).fill(null));
    const logoImgsRef     = useRef<(HTMLImageElement | null)[]>(Array(3).fill(null));
    const zoneLogoImgsRef = useRef<(HTMLImageElement | null)[]>(Array(9).fill(null));
    const subImgRefsArr   = useRef<(HTMLImageElement | null)[]>(Array(3).fill(null));

    // ── Rect mode state (replaces both circles when rectMode=true) ────────────
    // Stores the preview-px band [top, bottom, left, right] between the top-3 and bottom-3 tag slots (rectMode)
    const rectBandRef                     = useRef({ top: 0, bottom: 0, left: 0, right: 0 });

    const [circleSrcs, setCircleSrcs] = useState<(string|null)[]>([null, null]);
    const circleImgRefsArr    = useRef<(HTMLImageElement|null)[]>([null, null]);
    const circleInput0Ref     = useRef<HTMLInputElement>(null);
    const circleInput1Ref     = useRef<HTMLInputElement>(null);
    const circlePosRefsArr    = useRef<({x:number;y:number}|null)[]>([null, null]);
    const [circlePoses, setCirclePoses]   = useState<({x:number;y:number}|null)[]>([null, null]);
    const [activeDragCircle, setActiveDragCircle]     = useState<number|null>(null);
    const circleDragStart     = useRef({ mx: 0, my: 0, cx: 0, cy: 0 });
    const [activeDragTextBox, setActiveDragTextBox]   = useState<number|null>(null);
    const textBoxDragStart    = useRef({ mx: 0, my: 0, x: 0, y: 0 });
    const [selectedTextBox, setSelectedTextBox]       = useState<number|null>(null);
    const [activeResizeTextBox, setActiveResizeTextBox] = useState<number|null>(null);
    const textBoxResizeStart  = useRef({ handle: 'se', mx: 0, my: 0, x: 0, y: 0, w: 0, h: 0 });
    const [snapGuideX, setSnapGuideX] = useState<number|null>(null);  // canvas px
    const [snapGuideY, setSnapGuideY] = useState<number|null>(null);  // canvas px
    const [altHeld, setAltHeld] = useState(false);  // Option/Alt held → show spacing measurements
    // Image boxes (free positioned images dropped from Uploads)
    const [selectedImageBox, setSelectedImageBox]         = useState<number|null>(null);
    // Chart boxes (trading-site index charts) — same selection/drag model as image boxes
    const [selectedChartBox, setSelectedChartBox]         = useState<number|null>(null);
    const [activeDragChartBox, setActiveDragChartBox]     = useState<number|null>(null);
    const chartBoxDragStart   = useRef({ mx: 0, my: 0, x: 0, y: 0 });
    // Current frame time (ms, 0..CHART_ANIM_TOTAL_MS) for animated charts — driven by the editor
    // preview rAF loop and by the video exporter; null = draw the static final state.
    const chartAnimTimeRef    = useRef<number | null>(null);
    const chartBoxResizeStart = useRef({ handle: 'se', mx: 0, my: 0, x: 0, y: 0, w: 0, h: 0 });
    // Multi-selection (⌘/Ctrl+A → every element), tracked by stable id — separate from the single
    // selection above. Drives select-all + copy/paste/delete of many layers at once.
    const [multiSel, setMultiSel] = useState<Array<{ kind: 'text' | 'image' | 'chart'; id: string }>>([]);
    const multiSelRef = useRef(multiSel);
    useEffect(() => { multiSelRef.current = multiSel; }, [multiSel]);
    // Picking a single element supersedes a multi-selection (keeps the two states from co-existing).
    useEffect(() => { if (selectedTextBox != null || selectedImageBox != null || selectedChartBox != null) setMultiSel([]); }, [selectedTextBox, selectedImageBox, selectedChartBox]);
    const [activeDragImageBox, setActiveDragImageBox]     = useState<number|null>(null);
    const [activeResizeImageBox, setActiveResizeImageBox] = useState<number|null>(null);
    const imageBoxDragStart   = useRef({ mx: 0, my: 0, x: 0, y: 0 });
    const imageBoxResizeStart = useRef({ handle: 'se', mx: 0, my: 0, x: 0, y: 0, w: 0, h: 0, aspect: 1 });

    // ── Native-size outline overlay ──────────────────────────────────────────────────────────────
    // The canvas wrapper is overflow:hidden (frames + clicks clamped to the canvas, no scrollable spill,
    // so scrolling never "breaks" the edges). To still show selection (blue) + element (dashed) outlines
    // at their TRUE size PAST the canvas edge, we draw them in a fixed layer portaled to <body> — outside
    // the zoom + scroll flow, so they add no scrollable area. Positions track the wrapper's screen rect.
    const [overlayRect, setOverlayRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
    const syncOverlayRect = useCallback(() => {
      const el = wrapperRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setOverlayRect(prev => (prev && prev.left === r.left && prev.top === r.top && prev.width === r.width && prev.height === r.height)
        ? prev : { left: r.left, top: r.top, width: r.width, height: r.height });
    }, []);
    useLayoutEffect(() => {
      // Re-sync after renders that move/resize the canvas (zoom, panel toggle, slide switch, selection).
      // Skip during a live drag/resize — the canvas itself doesn't move then, and the dragged element's
      // outline already follows via its settings update + the cached rect.
      if (activeDragImageBox != null || activeDragTextBox != null || activeResizeImageBox != null || activeResizeTextBox != null) return;
      syncOverlayRect();
    });
    useEffect(() => {
      syncOverlayRect();
      const on = () => syncOverlayRect();
      window.addEventListener('scroll', on, true);   // capture → also catches the inner stage scroll
      window.addEventListener('resize', on);
      const el = wrapperRef.current;
      const ro = el ? new ResizeObserver(on) : null;
      if (el && ro) ro.observe(el);
      return () => { window.removeEventListener('scroll', on, true); window.removeEventListener('resize', on); ro?.disconnect(); };
    }, [syncOverlayRect]);
    // Centre-edge handles crop instead of scaling (changes aspect, ignores the lock)
    const [activeCropImageBox, setActiveCropImageBox] = useState<number|null>(null);
    const imageBoxCropStart   = useRef({ handle: 'e', mx: 0, my: 0, x: 0, y: 0, w: 0, h: 0, cropL: 0, cropR: 0, cropT: 0, cropB: 0 });
    const imageBoxImgsRef     = useRef<Map<string, HTMLImageElement>>(new Map());
    const videoBoxElsRef      = useRef<Map<string, HTMLVideoElement>>(new Map());  // per-videoUrl <video> for video boxes
    // Per-box cache of the finished composite buffer (blur+noise+fades). Keyed by everything that affects
    // the buffer EXCEPT position/opacity/blend/shadow/perspective — those are applied when blitting. Lets a
    // drag / perspective warp / opacity change / unrelated edit reuse the buffer instead of recomputing the
    // expensive per-pixel noise + blur every redraw.
    const imageBoxFxCacheRef  = useRef<Map<string, { canvas: HTMLCanvasElement; key: string }>>(new Map());
    // Per-box cache of the subject-outline buffer (the cut-out stamped ~50× around a circle, then
    // tinted). Keyed by box id; the entry key covers everything that changes the stamp (cut-out src,
    // colour, width, buffer size/scale, crop). Kept separate from imageBoxFxCacheRef so one stroke
    // buffer serves both the 'all' and 'fg' mode composites, and so fx rebuilds (e.g. dragging a
    // brightness slider) reuse it instead of restamping every tick.
    const imageBoxStrokeCacheRef = useRef<Map<string, { canvas: HTMLCanvasElement; key: string }>>(new Map());
    const circleRadsArr       = useRef<number[]>([90, 90]);
    const [circleRadii, setCircleRadii]   = useState<number[]>([90, 90]);
    const [activeResizeCircle, setActiveResizeCircle] = useState<number|null>(null);
    const circleResizeStart   = useRef({ cx: 0, cy: 0 });
    const circleImgOffsetsArr = useRef<{x:number;y:number}[]>([{x:0,y:0},{x:0,y:0}]);
    const circleImgScalesArr  = useRef<number[]>([1, 1]);
    const [circleImgEditModes, setCircleImgEditModes] = useState<boolean[]>([false, false]);
    const [activeImgDragCircle, setActiveImgDragCircle]   = useState<number|null>(null);
    const circleImgDragStart  = useRef({ mx: 0, my: 0, ox: 0, oy: 0 });
    const [activeZoomDragCircle, setActiveZoomDragCircle] = useState<number|null>(null);
    const circleZoomDragStart = useRef({ my: 0, scale: 1 });
    const circleEl0Ref        = useRef<HTMLDivElement>(null);
    const circleEl1Ref        = useRef<HTMLDivElement>(null);
    const fgMaskImgRef          = useRef<HTMLImageElement | null>(null);
    const [fgMaskSrc, setFgMaskSrc] = useState<string | null>(null);
    const fgMaskSrcRef          = useRef<string | null>(null);
    const [isBgProcessing, setIsBgProcessing] = useState(false);
    const [bgProcessError, setBgProcessError] = useState(false);
    // Per-image-box subject split: cut-out images (keyed by source url), an fg-layer
    // offscreen buffer, in-flight guards, and per-box bg-removal status for the panel.
    const imageBoxFgImgsRef     = useRef<Map<string, HTMLImageElement>>(new Map());
    const imageBoxFgBufRef      = useRef<HTMLCanvasElement | null>(null);
    const imageBoxFgPendingRef  = useRef<Set<string>>(new Set());
    const imageBoxFgPromisesRef = useRef<Map<string, Promise<void>>>(new Map());   // export waits on these
    const [imageBoxBgStatus, setImageBoxBgStatus] = useState<Record<string, 'processing' | 'error'>>({});
    const [imageBoxSrcTick, setImageBoxSrcTick] = useState(0);   // bumped when a box source loads → re-runs the split compute
    // Latest callbacks via refs so the (per-box) split effect needn't list them as deps.
    const onUploadImageRef    = useRef(onUploadImage);
    const onUploadVideoRef    = useRef(onUploadVideo);
    const onSettingsChangeRef = useRef(onSettingsChange);
    useEffect(() => { onUploadImageRef.current = onUploadImage; onUploadVideoRef.current = onUploadVideo; onSettingsChangeRef.current = onSettingsChange; });
    useEffect(() => { onImageBoxBgStateChange?.(imageBoxBgStatus); }, [imageBoxBgStatus, onImageBoxBgStateChange]);
    useEffect(() => { circlePosRefsArr.current = [...circlePoses]; }, [circlePoses]);
    useEffect(() => { circleRadsArr.current    = [...circleRadii]; }, [circleRadii]);
    const instanceId      = useRef(Math.random().toString(36).slice(2)).current;
    const [customTagText,   setCustomTagText]   = useState('');
    const [showCustom,      setShowCustom]      = useState(false);
    const [showQuotePicker, setShowQuotePicker] = useState<number | null>(null);
    // blockTopPv tracks the text-block's top edge in preview-px so above-headline slots stay anchored
    const [blockTopPv,   setBlockTopPv]   = useState(384);
    const [headBlockHPv, setHeadBlockHPv] = useState(0);
    const [subBlockHPv,  setSubBlockHPv]  = useState(0);
    const [gapPv,        setGapPv]        = useState(0);
    // Rich text editing overlay
    const [richEditTarget, setRichEditTarget] = useState<'headline' | 'sub' | null>(null);
    const richEditTargetRef  = useRef<'headline' | 'sub' | null>(null);
    const richEditRef        = useRef<HTMLDivElement>(null);
    // Inline editing of a free text box (double-click to type straight into it)
    const [editingTextBox, setEditingTextBox] = useState<number | null>(null);
    const editingTextBoxRef = useRef<number | null>(null);
    const editTextRef       = useRef<HTMLDivElement>(null);
    const savedSelRef        = useRef<Range | null>(null);
    const [toolbarPos,     setToolbarPos]     = useState<{ top: number; left: number } | null>(null);

    const headlineRef    = useRef(headline);
    const subheadlineRef = useRef(subheadline);
    useEffect(() => { headlineRef.current    = headline; },    [headline]);
    useEffect(() => { subheadlineRef.current = subheadline; }, [subheadline]);
    // Clear stale spans if the headline text is changed externally (e.g., settings panel textarea)
    useEffect(() => {
      if (!settingsRef.current.headlineSpans) return;
      const t = settingsRef.current.headlineSpans.map(s => s.text).join('');
      if (t !== headline) onSettingsChange?.({ headlineSpans: null });
    }, [headline]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
      if (!settingsRef.current.subSpans) return;
      const t = settingsRef.current.subSpans.map(s => s.text).join('');
      if (t !== subheadline) onSettingsChange?.({ subSpans: null });
    }, [subheadline]); // eslint-disable-line react-hooks/exhaustive-deps

    const drawCanvas = useCallback((
      img: HTMLImageElement | null,
      imgOx: number, imgOy: number, imgSc: number,
      s: CarouselSettings,
      targetCanvas?: HTMLCanvasElement | OffscreenCanvas,
      videoFrameOverride?: { source: CanvasImageSource; vw: number; vh: number } | null,
    ) => {
      const canvas = targetCanvas ?? canvasRef.current;
      if (!canvas) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx = (canvas as any).getContext('2d') as CanvasRenderingContext2D | null;
      if (!ctx) return;
      const sc = canvas.width / W;
      ctx.setTransform(sc, 0, 0, sc, 0, 0);

      const setLS = (px: number) => { (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${px * sc}px`; };

      const fontDef    = resolveCarouselFont(s.fontLabel);
      const subFontDef = resolveCarouselFont(s.subFontLabel);
      const fs  = (sz: number) => `${s.italic    ? 'italic ' : ''}${s.fontWeight}  ${sz}px ${fontDef.css}`;
      const sfs = (sz: number) => `${s.subItalic ? 'italic ' : ''}${s.subFontWeight} ${sz}px ${subFontDef.css}`;

      ctx.clearRect(0, 0, W, H);
      if (!s.canvasTransparent) {
        ctx.fillStyle = s.canvasColor ?? '#000000';
        ctx.fillRect(0, 0, W, H);
      }
      // (transparent → leave the cleared, alpha-0 background; the editor shows a checkerboard behind it)

      if (img) {
        const crop = imgSrcCropRef.current;
        const sx = crop?.sx ?? 0;
        const sy = crop?.sy ?? 0;
        const sw = crop?.sw ?? img.naturalWidth;
        const sh = crop?.sh ?? img.naturalHeight;
        const baseScale      = Math.max(W / sw, H / sh);
        const effectiveScale = baseScale * imgSc;
        const drawW = sw * effectiveScale;
        const drawH = sh * effectiveScale;
        const drawX = (W - drawW) / 2 + imgOx;
        const drawY = (H - drawH) / 2 + imgOy;
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
        const fgMask = fgMaskImgRef.current;
        if (s.bgBlurEnabled && fgMask) {
          const defaultOrder: LayerId[] = ['background', 'circle', 'circle2', 'subject'];
          const order: LayerId[] = (s.layerOrder && s.layerOrder.length >= 4) ? s.layerOrder : defaultOrder;
          const drawCircle = (ci: number) => {
            const _cImg = circleImgRefsArr.current[ci];
            if (!_cImg) return;
            const _pos = circlePosRefsArr.current[ci];
            const _defX = ci === 0 ? Math.round(CAROUSEL_PREVIEW_W / 4) : Math.round(CAROUSEL_PREVIEW_W * 3 / 4);
            const _cX = _pos ? _pos.x / DISPLAY_SCALE : _defX / DISPLAY_SCALE;
            const _cY = _pos ? _pos.y / DISPLAY_SCALE : H / 2;
            const _cR = Math.round(circleRadsArr.current[ci] / DISPLAY_SCALE);
            const _shadowEnabled = ci === 0 ? s.circleShadowEnabled : s.circle2ShadowEnabled;
            const _lift = ci === 0 ? s.circleLift : s.circle2Lift;
            if (_shadowEnabled || _lift > 0) {
              ctx.save();
              if (_shadowEnabled) {
                ctx.shadowBlur    = ci === 0 ? s.circleShadowBlur    : s.circle2ShadowBlur;
                ctx.shadowOffsetX = ci === 0 ? s.circleShadowOffsetX : s.circle2ShadowOffsetX;
                ctx.shadowOffsetY = ci === 0 ? s.circleShadowOffsetY : s.circle2ShadowOffsetY;
                ctx.shadowColor   = hexToRgba(ci === 0 ? s.circleShadowColor : s.circle2ShadowColor, (ci === 0 ? s.circleShadowOpacity : s.circle2ShadowOpacity) / 100);
              } else {
                ctx.shadowBlur = _lift * 0.5; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = _lift * 0.3; ctx.shadowColor = 'rgba(0,0,0,0.7)';
              }
              ctx.beginPath(); ctx.arc(_cX, _cY, _cR, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill();
              ctx.restore();
            }
            ctx.save();
            ctx.beginPath(); ctx.arc(_cX, _cY, _cR, 0, Math.PI * 2); ctx.clip();
            const _cs  = Math.max((_cR * 2) / _cImg.naturalWidth, (_cR * 2) / _cImg.naturalHeight);
            const _ecs = _cs * circleImgScalesArr.current[ci];
            const _off = circleImgOffsetsArr.current[ci];
            const _cdw = _cImg.naturalWidth * _ecs, _cdh = _cImg.naturalHeight * _ecs;
            ctx.drawImage(_cImg, _cX - _cdw / 2 + _off.x, _cY - _cdh / 2 + _off.y, _cdw, _cdh);
            ctx.restore();
            const _bw = ci === 0 ? s.circleBorderWidth   : s.circle2BorderWidth;
            const _bo = ci === 0 ? s.circleBorderOpacity : s.circle2BorderOpacity;
            const _bc = ci === 0 ? s.circleBorderColor   : s.circle2BorderColor;
            if (_bw > 0 && _bo > 0) {
              ctx.save();
              ctx.beginPath(); ctx.arc(_cX, _cY, _cR, 0, Math.PI * 2);
              ctx.strokeStyle = hexToRgba(_bc, _bo / 100); ctx.lineWidth = _bw; ctx.stroke();
              ctx.restore();
            }
          };
          const drawRect = () => {
            const _rImg = circleImgRefsArr.current[0];
            if (!_rImg) return;
            const { top: _rtPv, bottom: _rbPv, left: _rlPv } = rectBandRef.current;
            const _rl  = _rlPv / DISPLAY_SCALE;
            const _rt  = _rtPv / DISPLAY_SCALE;
            const _rw  = W - _rl * 2;
            const _rh  = (_rbPv - _rtPv) / DISPLAY_SCALE;
            const SHIFT_CV = Math.round(50 / DISPLAY_SCALE);
            const _pos = circlePosRefsArr.current[0];
            const _cr  = _pos ? Math.round(circleRadsArr.current[0] / DISPLAY_SCALE) : Math.min(_rh, _rw) / 2 - Math.round(4 / DISPLAY_SCALE);
            const _cx  = _pos ? _pos.x / DISPLAY_SCALE : W / 2 + SHIFT_CV;
            const _cy  = _pos ? _pos.y / DISPLAY_SCALE : _rt + _rh / 2;
            ctx.save();
            ctx.beginPath(); ctx.arc(_cx, _cy, _cr, 0, Math.PI * 2); ctx.clip();
            const _cs  = Math.max((_cr * 2) / _rImg.naturalWidth, (_cr * 2) / _rImg.naturalHeight);
            const _ecs = _cs * circleImgScalesArr.current[0];
            const _off = circleImgOffsetsArr.current[0];
            const _cdw = _rImg.naturalWidth * _ecs, _cdh = _rImg.naturalHeight * _ecs;
            ctx.drawImage(_rImg, _cx - _cdw / 2 + _off.x, _cy - _cdh / 2 + _off.y, _cdw, _cdh);
            ctx.restore();
          };

          for (const layer of order) {
            if (layer === 'background') {
              if (s.bgBlurAmount > 0) {
                const blurPx = Math.max(1, Math.round(s.bgBlurAmount * sc));
                ctx.filter = `blur(${blurPx}px)`;
                // Overdraw past the canvas edges so the blur kernel never samples the transparent
                // area outside the image — otherwise the borders fade out and the slide background
                // bleeds through. Margin ≈ 2× the blur radius covers the gaussian falloff; the
                // canvas bitmap crops the overflow.
                const m = blurPx * 2;
                ctx.drawImage(img, sx, sy, sw, sh, drawX - m, drawY - m, drawW + 2 * m, drawH + 2 * m);
                ctx.filter = 'none';
              } else {
                ctx.drawImage(img, sx, sy, sw, sh, drawX, drawY, drawW, drawH);
              }
              if (s.bgDarkenAmount > 0) {
                ctx.fillStyle = `rgba(0,0,0,${(s.bgDarkenAmount / 100).toFixed(3)})`;
                ctx.fillRect(0, 0, W, H);
              }
            } else if (layer === 'circle') {
              rectMode ? drawRect() : drawCircle(0);
            } else if (layer === 'circle2') {
              if (!rectMode) drawCircle(1);
            } else if (layer === 'subject') {
              ctx.drawImage(fgMask, sx, sy, sw, sh, drawX, drawY, drawW, drawH);
            }
          }
        } else {
          ctx.drawImage(img, sx, sy, sw, sh, drawX, drawY, drawW, drawH);
        }
        ctx.restore();
      } else if (videoFrameOverride || (videoRef.current && videoRef.current.readyState >= 2)) {
        const vSrc: CanvasImageSource = videoFrameOverride ? videoFrameOverride.source : videoRef.current!;
        const vw = videoFrameOverride ? videoFrameOverride.vw : (videoRef.current!.videoWidth || 1);
        const vh = videoFrameOverride ? videoFrameOverride.vh : (videoRef.current!.videoHeight || 1);
        const crop = imgSrcCropRef.current;
        const sx = crop?.sx ?? 0, sy = crop?.sy ?? 0;
        const sw = crop?.sw ?? vw, sh = crop?.sh ?? vh;
        const baseScale = Math.max(W / sw, H / sh);
        const drawW = sw * baseScale * imgSc, drawH = sh * baseScale * imgSc;
        const drawX = (W - drawW) / 2 + imgOx, drawY = (H - drawH) / 2 + imgOy;
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
        ctx.drawImage(vSrc, sx, sy, sw, sh, drawX, drawY, drawW, drawH);
        if (s.bgDarkenAmount > 0) {
          ctx.fillStyle = `rgba(0,0,0,${(s.bgDarkenAmount / 100).toFixed(3)})`;
          ctx.fillRect(0, 0, W, H);
        }
        ctx.restore();
      }

      const rawHead = s.headlineSpans ? s.headlineSpans.map(sp => sp.text).join('') : headlineRef.current;
      const rawSub  = s.subSpans      ? s.subSpans.map(sp => sp.text).join('')      : subheadlineRef.current;
      const text    = s.allCaps    ? rawHead.trim().toUpperCase() : rawHead.trim();
      const subText = s.subAllCaps ? rawSub.trim().toUpperCase()  : rawSub.trim();
      // Nothing to lay out only if there's truly no content. Image boxes and free
      // text boxes render below and are independent of the headline/sub block, so
      // they must not be skipped on a slide that has no headline/subheadline text.
      if (!text && !subText && !(s.imageBoxes ?? []).length && !(s.textBoxes ?? []).length && !(s.chartBoxes ?? []).length) return;

      const padX      = Math.round(32 + s.contentPadding * 0.64);
      const padBot    = Math.round(40 + s.contentPadding * 0.80);
      const MAX_W     = W - padX * 2;
      const lsPx      = (s.lSpacing    / 100) * 20;
      const subLsPx   = (s.subLSpacing / 100) * 20;
      const lhMult    = 1.0 + (s.lHeight    / 100) * 1.2;
      const subLhMult = 1.0 + (s.subLHeight / 100) * 1.2;

      const hasSub   = subText.length > 0;

      const hSize = s.fontSize; let hLines: string[] = [];
      if (text) {
        setLS(lsPx);
        ctx.font = fs(hSize);
        hLines = wrapText(ctx, text, MAX_W);
      }
      const hLineH  = hSize * lhMult;
      const hBlockH = hLines.length * hLineH;

      const sSize = s.subFontSize; let sLines: string[] = [];
      if (subText) {
        setLS(subLsPx);
        ctx.font = sfs(sSize);
        sLines = wrapText(ctx, subText, MAX_W);
      }
      const sLineH  = sSize * subLhMult;
      const sBlockH = sLines.length * sLineH;
      const gap         = hasSub && text ? hSize * (s.headSubGap / 100) : 0;
      // Bottom slot is hidden when nothing is placed there and nothing is being dragged
      const hasBottomContent = !!(
        slotsRef.current[2] ||
        s.dividerSlots?.[2] ||
        s.tagSlots?.[2] ||
        s.quoteSlots?.[2] ||
        s.tagZoneSlots?.slice(6).some(Boolean) ||
        s.zoneLogoSlots?.slice(6).some(Boolean) ||
        s.quoteZoneSlots?.slice(6).some(Boolean) ||
        s.swipeZoneSlots?.slice(6).some(Boolean)
      );
      const invSl = invertedSlotsRef.current;
      const hasTopContent = !!(
        slotsRef.current[0] || s.dividerSlots?.[0] || s.tagSlots?.[0] || s.quoteSlots?.[0] ||
        s.tagZoneSlots?.slice(0, 3).some(Boolean) || s.zoneLogoSlots?.slice(0, 3).some(Boolean) ||
        s.quoteZoneSlots?.slice(0, 3).some(Boolean) || s.swipeZoneSlots?.slice(0, 3).some(Boolean)
      );
      const showBottomSlot = invSl ? true  : (isDraggingElementRef.current || hasBottomContent);
      const showTopSlot    = invSl ? (isDraggingElementRef.current || hasTopContent) : true;
      const showMiddleSlot = !invSl;
      const showSlot       = [showTopSlot, showMiddleSlot, showBottomSlot] as const;
      const subSlotCV   = H - (showBottomSlot ? LOGO_CH + padX : padX);
      const aboveGapCV  = Math.round(s.aboveLogoGap / DISPLAY_SCALE);
      // Inverted: text sits just below top slot when visible, or at padX when top slot is hidden
      // Normal: aboveGapCV only moves slot 1 upward — text stays anchored above the bottom slot
      const blockTop    = invSl
        ? (showTopSlot ? (padX + LOGO_CH + aboveGapCV) : padX)
        : Math.max(padX, subSlotCV - (hBlockH + gap + sBlockH));

      if (!targetCanvas) {
        const btp = Math.round(blockTop * DISPLAY_SCALE);
        setBlockTopPv(prev => prev === btp ? prev : btp);
        const hbhPv = Math.round(hBlockH * DISPLAY_SCALE);
        setHeadBlockHPv(prev => prev === hbhPv ? prev : hbhPv);
        const sbhPv = Math.round(sBlockH * DISPLAY_SCALE);
        setSubBlockHPv(prev => prev === sbhPv ? prev : sbhPv);
        const gPv = Math.round(gap * DISPLAY_SCALE);
        setGapPv(prev => prev === gPv ? prev : gPv);
      }

      // Free-element layer order (+ the settings fade). Computed once; reused by the element pass below.
      const imgBoxes = s.imageBoxes ?? [];
      // Drop cached effect buffers for image boxes that no longer exist (frees their offscreen canvases).
      // Keys are `${boxId}::${mode}`.
      if (imageBoxFxCacheRef.current.size || imageBoxStrokeCacheRef.current.size) {
        const liveIds = new Set(imgBoxes.map(b => b.id));
        for (const k of imageBoxFxCacheRef.current.keys()) {
          if (!liveIds.has(k.slice(0, k.indexOf('::')))) imageBoxFxCacheRef.current.delete(k);
        }
        // Subject-outline buffers are keyed by the box id directly.
        for (const k of imageBoxStrokeCacheRef.current.keys()) {
          if (!liveIds.has(k)) imageBoxStrokeCacheRef.current.delete(k);
        }
      }
      const txtBoxes = s.textBoxes ?? [];
      const chartBoxesArr = s.chartBoxes ?? [];
      // A DELETED fade layer (fadeRemoved) is not enabled at all — it leaves the
      // z-order entirely, so nothing draws and no layer slot is reserved for it.
      const fadeEnabled  = !s.fadeRemoved && !!(s.showFade || s.showTopFade);
      const fadeShown    = fadeEnabled && !s.fadeHidden;
      const layers       = orderedLayerIds(imgBoxes, txtBoxes, s.layerOrderIds, fadeEnabled, chartBoxesArr);
      const fadeAtBottom = layers.length > 0 && layers[0].kind === 'fade';

      // Settings fade (bottom + top gradient overlay). Drawn here when it's the bottom layer — its
      // original position, under all content — otherwise within the element pass at its layer position.
      // Fill a gradient with many smoothstep-sampled stops (alpha a0→a1). smoothstep has zero slope at
      // both ends, so the transparent end ramps in gradually instead of starting at a linear slope — that
      // slope discontinuity is what reads as a hard "line" at the edge of the fade.
      // Smoothstep alpha ramp over a sub-range [p0,p1] of a gradient.
      const rampStops = (g: CanvasGradient, p0: number, p1: number, a0: number, a1: number, steps = 32) => {
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const sm = t * t * (3 - 2 * t);
          g.addColorStop(p0 + (p1 - p0) * t, `rgba(0,0,0,${(a0 + (a1 - a0) * sm).toFixed(4)})`);
        }
      };
      // One seamless gradient per fade — the solid "floor" is held as gradient stops, NOT a separate
      // fillRect overlapping the ramp. (The old rect + 0.3px-overlapping gradient double-drew a ~1px
      // darker line at the boundary whenever intensity < 100%.)
      // Floor position: anchored to a text box's top edge when fadeFloorAnchor is set
      // (the invariant "solid black starts at the headline" holds by construction),
      // else the fadeFloor percentage.
      const resolveFloorTop = (): number => {
        if (s.fadeFloorAnchor) {
          const tb = (s.textBoxes ?? []).find(t => t.id === s.fadeFloorAnchor);
          if (tb) return Math.max(0, Math.min(H, tb.y));
        }
        return H - H * 0.6 * (s.fadeFloor / 100);
      };
      const drawFade = () => {
        if (s.showFade) {
          const alpha    = s.fadeIntensity / 100;
          const floorTop = resolveFloorTop();
          const fadeH    = H * 0.05 + H * 0.95 * (s.fadeReach / 100);
          const gradTop  = Math.max(0, floorTop - fadeH);
          const span     = H - gradTop;
          if (span > 0) {
            const grad = ctx.createLinearGradient(0, gradTop, 0, H);
            const frac = Math.min(1, Math.max(0, (floorTop - gradTop) / span));
            rampStops(grad, 0, frac, 0, alpha);                                      // transparent → solid over the reach
            if (frac < 1) grad.addColorStop(1, `rgba(0,0,0,${alpha.toFixed(4)})`);   // hold the solid floor to the bottom
            ctx.fillStyle = grad;
            ctx.fillRect(0, gradTop, W, span);
          }
        }
        if (s.showTopFade) {
          const alpha      = (s.topFadeIntensity ?? 85) / 100;
          const floorH     = H * 0.6 * ((s.topFadeFloor ?? 20) / 100);
          const fadeH      = H * 0.05 + H * 0.95 * ((s.topFadeReach ?? 40) / 100);
          const gradBottom = Math.min(H, floorH + fadeH);
          if (gradBottom > 0) {
            const grad = ctx.createLinearGradient(0, 0, 0, gradBottom);
            const frac = Math.min(1, Math.max(0, floorH / gradBottom));
            grad.addColorStop(0, `rgba(0,0,0,${alpha.toFixed(4)})`);                  // hold the solid floor at the top
            rampStops(grad, frac, 1, alpha, 0);                                      // solid → transparent over the reach
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, gradBottom);
          }
        }
      };
      if (fadeShown && fadeAtBottom) drawFade();

      // Logo overlays drawn on canvas (included in download) — positions mirror the HTML overlay slots
      const slotFW       = W - 2 * padX;
      const logoCY_top   = padX;
      const logoCY_above = Math.max(0, blockTop - LOGO_CH - Math.round(s.aboveLogoGap / DISPLAY_SCALE));
      const logoCY_sub   = H - LOGO_CH - padX;
      const logoCYs      = [logoCY_top, logoCY_above, logoCY_sub];
      const logoAlpha = (s.logoOpacity ?? 100) / 100;
      logoImgsRef.current.forEach((logoImg, li) => {
        if (!logoImg || li > 2) return;
        if (li <= 2 && !showSlot[li]) return;
        ctx.save();
        ctx.globalAlpha = logoAlpha;
        const lha = (s.logoSlotAligns?.[li] ?? 'center') as 'left' | 'center' | 'right';
        const lva = li === 0 ? 'top' as const : 'bottom' as const;
        const logoLift = s.logoShadow?.lift ?? 0;
        applyShadow(ctx, s.logoShadow);
        drawLogoFit(ctx, logoImg, padX, logoCYs[li] - logoLift, slotFW, LOGO_CH, lha, lva, s.logoScale ?? 100, s.logoCornerRadius ?? 0);
        clearShadow(ctx);
        ctx.restore();
      });
      (s.tagSlots ?? []).forEach((tagSlot, li) => {
        if (!tagSlot || li > 2) return;
        if (li <= 2 && !showSlot[li]) return;
        const ts = tagSlot.style;
        const tagFontDef = resolveCarouselFont(ts.fontLabel);
        const ha = (s.tagSlotAligns?.[li] ?? 'center') as 'left' | 'center' | 'right';
        // Slot 0 (top) pins to top edge; slots 1/2 pin to bottom edge toward content/padding boundary
        const va = li === 0 ? 'top' as const : 'bottom' as const;
        const tagSlotLift = ts.shadow?.lift ?? 0;
        applyShadow(ctx, ts.shadow);
        drawTag(ctx, tagSlot.text, padX, logoCYs[li] - tagSlotLift, slotFW, LOGO_CH, ha, va, ts, tagFontDef.css, 1 / DISPLAY_SCALE);
        clearShadow(ctx);
      });

      // Quote mark overlays
      (s.quoteSlots ?? []).forEach((styleId, li) => {
        if (!styleId || li > 2) return;
        if (li <= 2 && !showSlot[li]) return;
        const qs = ALL_QUOTE_STYLES.find(q => q.id === styleId);
        if (!qs) return;
        const qColor   = s.quoteColor   ?? '#ffffff';
        const qSize    = s.quoteSize    ?? 120;
        const qAlpha   = (s.quoteOpacity ?? 100) / 100;
        const [vbX, vbY, vbW, vbH] = qs.viewBox;
        const scale    = Math.min(qSize / vbW, qSize / vbH);
        const drawW    = vbW * scale;
        const drawH    = vbH * scale;
        const quoteGap = qs.paired ? (s.quoteGap ?? 8) : 0;
        const totalW   = qs.paired ? drawW * 2 + quoteGap : drawW;
        const qx = padX + (slotFW - totalW) / 2;
        const quoteLift = s.quoteShadow?.lift ?? 0;
        const qy = logoCYs[li] - quoteLift + (LOGO_CH - drawH) / 2;
        // Opening mark
        ctx.save();
        ctx.globalAlpha = qAlpha;
        ctx.fillStyle   = qColor;
        applyShadow(ctx, s.quoteShadow);
        ctx.translate(qx - vbX * scale, qy - vbY * scale);
        ctx.scale(scale, scale);
        if (qs.pathOffset) ctx.translate(qs.pathOffset.x, qs.pathOffset.y);
        for (const pathD of qs.paths) ctx.fill(new Path2D(pathD));
        clearShadow(ctx);
        ctx.restore();
        // Closing mark — same shape rotated 180°, offset by quoteGap
        if (qs.paired) {
          const cx = qx + drawW + quoteGap;
          ctx.save();
          ctx.globalAlpha = qAlpha;
          ctx.fillStyle   = qColor;
          applyShadow(ctx, s.quoteShadow);
          ctx.translate(cx + drawW / 2, qy + drawH / 2);
          ctx.rotate(Math.PI);
          ctx.translate(-drawW / 2, -drawH / 2);
          ctx.translate(-vbX * scale, -vbY * scale);
          ctx.scale(scale, scale);
          if (qs.pathOffset) ctx.translate(qs.pathOffset.x, qs.pathOffset.y);
          for (const pathD of qs.paths) ctx.fill(new Path2D(pathD));
          clearShadow(ctx);
          ctx.restore();
        }
      });

      // Zone-level independent items (row*3+zone, zones: 0=left,1=center,2=right)
      const zoneW = slotFW / 3;
      for (let row = 0; row < 3; row++) {
        if (row <= 2 && !showSlot[row]) continue;
        if (s.dividerSlots?.[row]) continue; // divider takes whole row, skip zone items
        const lva = row === 0 ? 'top' as const : row === 2 ? 'bottom' as const : 'center' as const;
        for (let zi = 0; zi < 3; zi++) {
          const fi = row * 3 + zi;
          const zoneX = padX + zi * zoneW;
          const lha = zi === 0 ? 'left' as const : zi === 2 ? 'right' as const : 'center' as const;
          // Zone tag
          const zt = s.tagZoneSlots?.[fi];
          if (zt) {
            const tfd = resolveCarouselFont(zt.style.fontLabel);
            const tzLift = zt.style.shadow?.lift ?? 0;
            applyShadow(ctx, zt.style.shadow);
            drawTag(ctx, zt.text, zoneX, logoCYs[row] - tzLift, zoneW, LOGO_CH, lha, lva, zt.style, tfd.css, 1 / DISPLAY_SCALE);
            clearShadow(ctx);
          }
          // Zone logo (brand)
          if (s.zoneLogoSlots?.[fi]) {
            const zImg = zoneLogoImgsRef.current[fi];
            if (zImg) {
              const zLogoLift = s.logoShadow?.lift ?? 0;
              ctx.save();
              ctx.globalAlpha = logoAlpha;
              applyShadow(ctx, s.logoShadow);
              drawLogoFit(ctx, zImg, zoneX, logoCYs[row] - zLogoLift, zoneW, LOGO_CH, lha, lva, s.logoScale ?? 100, s.logoCornerRadius ?? 0);
              clearShadow(ctx);
              ctx.restore();
            }
          }
          // Zone quote — positioned to match the zone corner (same anchor as tag/logo)
          const zq = s.quoteZoneSlots?.[fi];
          if (zq) {
            const qs = ALL_QUOTE_STYLES.find(q => q.id === zq);
            if (qs) {
              const qColor = s.quoteColor ?? '#ffffff';
              const qSize  = s.quoteSize  ?? 120;
              const qAlpha = (s.quoteOpacity ?? 100) / 100;
              const [vbX, vbY, vbW, vbH] = qs.viewBox;
              const scale = Math.min(qSize / vbW, qSize / vbH);
              const drawW = vbW * scale, drawH = vbH * scale;
              const quoteGap = qs.paired ? (s.quoteGap ?? 8) : 0;
              const totalW   = qs.paired ? drawW * 2 + quoteGap : drawW;
              const zqLift = s.quoteShadow?.lift ?? 0;
              // Horizontal anchor
              const qx = lha === 'left' ? zoneX
                       : lha === 'right' ? zoneX + zoneW - totalW
                       : zoneX + (zoneW - totalW) / 2;
              // Vertical anchor
              const qy = (lva === 'top'    ? logoCYs[row]
                        : lva === 'bottom' ? logoCYs[row] + LOGO_CH - drawH
                        : logoCYs[row] + (LOGO_CH - drawH) / 2) - zqLift;
              ctx.save(); ctx.globalAlpha = qAlpha; ctx.fillStyle = qColor;
              applyShadow(ctx, s.quoteShadow);
              ctx.translate(qx - vbX * scale, qy - vbY * scale);
              ctx.scale(scale, scale);
              if (qs.pathOffset) ctx.translate(qs.pathOffset.x, qs.pathOffset.y);
              for (const pathD of qs.paths) ctx.fill(new Path2D(pathD));
              clearShadow(ctx);
              ctx.restore();
              if (qs.paired) {
                const cx = qx + drawW + quoteGap;
                ctx.save(); ctx.globalAlpha = qAlpha; ctx.fillStyle = qColor;
                applyShadow(ctx, s.quoteShadow);
                ctx.translate(cx + drawW / 2, qy + drawH / 2); ctx.rotate(Math.PI);
                ctx.translate(-drawW / 2, -drawH / 2); ctx.translate(-vbX * scale, -vbY * scale);
                ctx.scale(scale, scale);
                if (qs.pathOffset) ctx.translate(qs.pathOffset.x, qs.pathOffset.y);
                for (const pathD of qs.paths) ctx.fill(new Path2D(pathD));
                clearShadow(ctx);
                ctx.restore();
              }
            }
          }
          // Zone swipe
          const zsw = s.swipeZoneSlots?.[fi];
          if (zsw) {
            const sfd = resolveCarouselFont(zsw.fontLabel);
            const zswLift = zsw.shadow?.lift ?? 0;
            applyShadow(ctx, zsw.shadow);
            drawSwipeOnCanvas(ctx, zoneX, logoCYs[row] - zswLift, zoneW, LOGO_CH, lha, lva, zsw, sfd.css);
            clearShadow(ctx);
          }
        }
      }

      // Draw dividers + sub-slot content together (merged so line gaps recalculate from actual content)
      (s.dividerSlots ?? []).forEach((divId, li) => {
        if (!divId || li > 2) return;
        if (li <= 2 && !showSlot[li]) return;
        const subContent = s.dividerSubSlots?.[li] ?? null;
        const szC = subContent ? getSubZoneCanvasBounds(divId, padX, logoCYs[li], slotFW, LOGO_CH) : null;

        // Measure actual rendered content width + center so lines align to content
        let contentW: number | null = null;
        let contentCY: number | null = null;
        let fittedTs: TagStyle | null = null;
        const va = li === 0 ? 'top' as const : li === 2 ? 'bottom' as const : 'center' as const;
        if (subContent && szC) {
          if (subContent.type === 'image') {
            const img = subImgRefsArr.current[li];
            if (img) {
              const imgS = Math.min(szC.w / img.naturalWidth, szC.h / img.naturalHeight);
              const dh = img.naturalHeight * imgS;
              const dy = va === 'top' ? szC.y : va === 'bottom' ? szC.y + szC.h - dh : szC.y + (szC.h - dh) / 2;
              contentW = img.naturalWidth * imgS;
              contentCY = dy + dh / 2;
            }
          } else if (subContent.type === 'tag') {
            const ts = subContent.style;
            const tfd = resolveCarouselFont(ts.fontLabel);
            const pxScale = 1 / DISPLAY_SCALE;
            const tc = ts.textCase ?? 'none';
            const dispTxt = tc === 'upper' ? subContent.text.toUpperCase() : subContent.text;
            const variant = tc === 'smallcaps' ? 'small-caps ' : '';
            let fsPx = Math.round(ts.fontSize * pxScale);
            (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
              `${((ts.letterSpacing ?? 0) * pxScale).toFixed(2)}px`;
            ctx.font = `${ts.italic ? 'italic ' : ''}${variant}${ts.fontWeight} ${fsPx}px ${tfd.css}`;
            const pxPad = Math.round(ts.paddingX * pxScale);
            const pxPy  = Math.round(ts.paddingY * pxScale);
            // Always measure against full slot width — sub-zone (140px) would artificially shrink font
            const avail = slotFW - pxPad * 2;
            let tw = ctx.measureText(dispTxt).width;
            if (tw > avail && avail > 0) {
              fsPx = Math.max(6, Math.floor(fsPx * avail / tw));
              ctx.font = `${ts.italic ? 'italic ' : ''}${variant}${ts.fontWeight} ${fsPx}px ${tfd.css}`;
              tw = ctx.measureText(dispTxt).width;
            }
            contentW = Math.max(1, tw + pxPad * 2);
            fittedTs = { ...ts, fontSize: Math.round(fsPx / pxScale) };
            const boxH = Math.round(fsPx * 1.2 + pxPy * 2);
            const by = va === 'top' ? logoCYs[li] : va === 'bottom' ? logoCYs[li] + LOGO_CH - boxH : logoCYs[li] + (LOGO_CH - boxH) / 2;
            contentCY = by + boxH / 2;
          } else if (subContent.type === 'swipe') {
            contentW = szC.w;
            contentCY = szC.y + szC.h / 2;
          }
        }

        // For dividers without tag/logo content, pin line to top edge (slot 0) or bottom edge (slots 1/2)
        const isContentDiv = divId.startsWith('tag') || divId.startsWith('logo');
        const positionalCY = (!isContentDiv && contentW == null)
          ? (li === 0 ? logoCYs[li] : logoCYs[li] + LOGO_CH)
          : null;

        // Draw divider lines — placeholder box hidden when contentW is known; lines align to content center
        const divLift = s.dividerSettings?.[li]?.shadow?.lift ?? 0;
        applyShadow(ctx, s.dividerSettings?.[li]?.shadow);
        drawDividerOnCanvas(ctx, divId, padX, logoCYs[li] - divLift, slotFW, LOGO_CH, contentW, contentCY != null ? contentCY - divLift : positionalCY != null ? positionalCY - divLift : null, s.dividerSettings?.[li], pulseAlphaRef.current);
        clearShadow(ctx);

        // Draw content clipped to the original placeholder zone
        if (subContent && szC) {
          const ha = divId.includes('left') ? 'left'   as const
                   : divId.includes('right') ? 'right'  as const
                   : 'center' as const;
          if (subContent.type === 'image') {
            const img = subImgRefsArr.current[li];
            if (img) {
              ctx.save();
              ctx.beginPath(); ctx.roundRect(szC.x, szC.y, szC.w, szC.h, 8); ctx.clip();
              drawLogoFit(ctx, img, szC.x, szC.y, szC.w, szC.h, ha, va);
              ctx.restore();
            }
          } else if (subContent.type === 'tag' && fittedTs) {
            const tfd = resolveCarouselFont(fittedTs.fontLabel);
            drawTag(ctx, subContent.text, padX, logoCYs[li], slotFW, LOGO_CH, ha, va, fittedTs, tfd.css, 1 / DISPLAY_SCALE);
          } else if (subContent.type === 'swipe') {
            const sfd = resolveCarouselFont(subContent.style.fontLabel);
            drawSwipeOnCanvas(ctx, szC.x, szC.y, szC.w, szC.h, ha, va, subContent.style, sfd.css);
          }
        }
      });

      // Circle images (drawn between top and bottom slot rows)
      const circleCY = (logoCY_top + LOGO_CH + logoCY_above) / 2; // midpoint between slot 0 and slot 1
      [0, 1].forEach(ci => {
        if (rectMode && ci === 0) return; // rectMode ci=0 handled by drawRect() in bgBlur path and rect block below
        const circleImg = circleImgRefsArr.current[ci];
        if (!circleImg || (s.bgBlurEnabled && fgMaskImgRef.current) || videoModeRef.current) return;
        const pos = circlePosRefsArr.current[ci];
        const _defX  = ci === 0 ? Math.round(CAROUSEL_PREVIEW_W / 4) : Math.round(CAROUSEL_PREVIEW_W * 3 / 4);
        const circleCX   = pos ? pos.x / DISPLAY_SCALE : _defX / DISPLAY_SCALE;
        const circleCanY = pos ? pos.y / DISPLAY_SCALE : circleCY;
        const circleR    = Math.round(circleRadsArr.current[ci] / DISPLAY_SCALE);
        const imgOffset  = circleImgOffsetsArr.current[ci];
        const imgScale   = circleImgScalesArr.current[ci];
        const shadowEnabled = ci === 0 ? s.circleShadowEnabled : s.circle2ShadowEnabled;
        const lift          = ci === 0 ? s.circleLift          : s.circle2Lift;
        if (shadowEnabled || lift > 0) {
          ctx.save();
          if (shadowEnabled) {
            ctx.shadowBlur    = ci === 0 ? s.circleShadowBlur    : s.circle2ShadowBlur;
            ctx.shadowOffsetX = ci === 0 ? s.circleShadowOffsetX : s.circle2ShadowOffsetX;
            ctx.shadowOffsetY = ci === 0 ? s.circleShadowOffsetY : s.circle2ShadowOffsetY;
            ctx.shadowColor   = hexToRgba(ci === 0 ? s.circleShadowColor : s.circle2ShadowColor, (ci === 0 ? s.circleShadowOpacity : s.circle2ShadowOpacity) / 100);
          } else {
            ctx.shadowBlur = lift * 0.5; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = lift * 0.3; ctx.shadowColor = 'rgba(0,0,0,0.7)';
          }
          ctx.beginPath(); ctx.arc(circleCX, circleCanY, circleR, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill();
          ctx.restore();
        }
        ctx.save();
        ctx.beginPath(); ctx.arc(circleCX, circleCanY, circleR, 0, Math.PI * 2); ctx.clip();
        const cs = Math.max((circleR * 2) / circleImg.naturalWidth, (circleR * 2) / circleImg.naturalHeight);
        const effectiveCs = cs * imgScale;
        const cdw = circleImg.naturalWidth * effectiveCs, cdh = circleImg.naturalHeight * effectiveCs;
        ctx.drawImage(circleImg, circleCX - cdw / 2 + imgOffset.x, circleCanY - cdh / 2 + imgOffset.y, cdw, cdh);
        ctx.restore();
        const bw = ci === 0 ? s.circleBorderWidth   : s.circle2BorderWidth;
        const bo = ci === 0 ? s.circleBorderOpacity : s.circle2BorderOpacity;
        const bc = ci === 0 ? s.circleBorderColor   : s.circle2BorderColor;
        if (bw > 0 && bo > 0) {
          ctx.save();
          ctx.beginPath(); ctx.arc(circleCX, circleCanY, circleR, 0, Math.PI * 2);
          ctx.strokeStyle = hexToRgba(bc, bo / 100); ctx.lineWidth = bw; ctx.stroke();
          ctx.restore();
        }
      });

      // Rect-mode circle — non-bgBlur path (bgBlur path uses drawRect inside layer loop)
      if (rectMode) {
        const rImg = circleImgRefsArr.current[0];
        if (rImg && !(s.bgBlurEnabled && fgMaskImgRef.current) && !videoModeRef.current) {
          const { top: _rtPv, bottom: _rbPv, left: _rlPv } = rectBandRef.current;
          const _rl  = _rlPv / DISPLAY_SCALE;
          const _rt  = _rtPv / DISPLAY_SCALE;
          const _rw  = W - _rl * 2;
          const _rh  = (_rbPv - _rtPv) / DISPLAY_SCALE;
          const SHIFT_CV = Math.round(50 / DISPLAY_SCALE);
          const _pos = circlePosRefsArr.current[0];
          const _cr  = _pos ? Math.round(circleRadsArr.current[0] / DISPLAY_SCALE) : Math.min(_rh, _rw) / 2 - Math.round(4 / DISPLAY_SCALE);
          const _cx  = _pos ? _pos.x / DISPLAY_SCALE : W / 2 + SHIFT_CV;
          const _cy  = _pos ? _pos.y / DISPLAY_SCALE : _rt + _rh / 2;
          ctx.save();
          ctx.beginPath(); ctx.arc(_cx, _cy, _cr, 0, Math.PI * 2); ctx.clip();
          const _cs  = Math.max((_cr * 2) / rImg.naturalWidth, (_cr * 2) / rImg.naturalHeight);
          const _ecs = _cs * circleImgScalesArr.current[0];
          const _off = circleImgOffsetsArr.current[0];
          const _cdw = rImg.naturalWidth * _ecs, _cdh = rImg.naturalHeight * _ecs;
          ctx.drawImage(rImg, _cx - _cdw / 2 + _off.x, _cy - _cdh / 2 + _off.y, _cdw, _cdh);
          ctx.restore();
        }
      }

      ctx.textBaseline = 'alphabetic';

      const editHead = !targetCanvas && richEditTargetRef.current === 'headline';
      const editSub  = !targetCanvas && richEditTargetRef.current === 'sub';
      const headColor = s.headlineColor ?? '#ffffff';
      const subColor  = s.subheadlineColor ?? '#ffffff';
      const headLift = s.headlineShadow?.lift ?? 0;
      const subLift  = s.subShadow?.lift ?? 0;

      applyShadow(ctx, s.headlineShadow);
      if (text && !editHead) {
        ctx.fillStyle = headColor;
        setLS(lsPx); ctx.font = fs(hSize);
        if (s.headlineSpans && s.headlineSpans.length > 0) {
          const dispSpans = s.allCaps ? s.headlineSpans.map(sp => ({ ...sp, text: sp.text.toUpperCase() })) : s.headlineSpans;
          const linesWO = wrapTextOffsets(ctx, text, MAX_W);
          let y = blockTop - headLift + hLineH * 0.82;
          for (const { line, offset } of linesWO) {
            drawSpanLine(ctx, getLineSpanSegs(dispSpans, offset, line), y, s.textAlign, padX, MAX_W, W, fontDef.css, hSize, s.fontWeight, s.italic, headColor, lsPx, sc);
            y += hLineH;
          }
        } else {
          let y = blockTop - headLift + hLineH * 0.82;
          hLines.forEach((line, i) => { drawAligned(ctx, line, y, i === hLines.length - 1, s.textAlign, padX, MAX_W, W); y += hLineH; });
        }
      }
      clearShadow(ctx);
      applyShadow(ctx, s.subShadow);
      if (subText && !editSub) {
        ctx.fillStyle = subColor;
        setLS(subLsPx); ctx.font = sfs(sSize);
        if (s.subSpans && s.subSpans.length > 0) {
          const dispSpans = s.subAllCaps ? s.subSpans.map(sp => ({ ...sp, text: sp.text.toUpperCase() })) : s.subSpans;
          const linesWO = wrapTextOffsets(ctx, subText, MAX_W);
          let y = blockTop - subLift + hBlockH + gap + sLineH * 0.82;
          for (const { line, offset } of linesWO) {
            drawSpanLine(ctx, getLineSpanSegs(dispSpans, offset, line), y, s.subTextAlign, padX, MAX_W, W, subFontDef.css, sSize, s.subFontWeight, s.subItalic, subColor, subLsPx, sc);
            y += sLineH;
          }
        } else {
          let y = blockTop - subLift + hBlockH + gap + sLineH * 0.82;
          sLines.forEach((line, i) => { drawAligned(ctx, line, y, i === sLines.length - 1, s.subTextAlign, padX, MAX_W, W); y += sLineH; });
        }
      }
      clearShadow(ctx);

      // ── Free elements (image + text boxes) — drawn in unified layer order; hidden ones skipped ──
      const drawImageBox = (b: ImageBox, mode: 'all' | 'bg' | 'fg' = 'all') => {
        if (b.glow) {
          // Light leak: a radial colour gradient (centre → transparent) blended over the canvas. No image.
          ctx.save();
          ctx.globalAlpha = (b.opacity ?? 100) / 100;
          ctx.globalCompositeOperation = (b.blend ?? 'screen') as GlobalCompositeOperation;
          ctx.translate(b.x + b.width / 2, b.y + b.height / 2);
          ctx.scale(Math.max(1, b.width) / 2, Math.max(1, b.height) / 2);   // unit circle → ellipse filling the box
          const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
          const core = Math.max(0, Math.min(0.6, (1 - (b.glow.softness ?? 70) / 100) * 0.6));   // bigger core = harder edge
          grad.addColorStop(0, hexToRgba(b.glow.color, 1));
          if (core > 0) grad.addColorStop(core, hexToRgba(b.glow.color, 1));
          grad.addColorStop(1, hexToRgba(b.glow.color, 0));
          ctx.fillStyle = grad;
          ctx.fillRect(-1, -1, 2, 2);
          ctx.restore();
          return;
        }
        // Video box: paint the live video frame (simple path — opacity/blend/shadow/corner-radius/crop).
        // The image fx/cache/split path below assumes a static source, so videos take this branch instead.
        if (b.videoUrl) {
          const v = videoBoxElsRef.current.get(b.videoUrl);
          if (!v || v.readyState < 2 || !v.videoWidth) return;
          const cp = b.crop;
          const cL = cp?.left ?? 0, cR = cp?.right ?? 0, cT = cp?.top ?? 0, cB = cp?.bottom ?? 0;
          const vsx = cL * v.videoWidth, vsy = cT * v.videoHeight;
          const vsw = Math.max(1, (1 - cL - cR) * v.videoWidth), vsh = Math.max(1, (1 - cT - cB) * v.videoHeight);
          ctx.save();
          ctx.globalAlpha = (b.opacity ?? 100) / 100;
          if (b.blend) ctx.globalCompositeOperation = b.blend as GlobalCompositeOperation;
          applyShadow(ctx, b.shadow);
          if ((b.cornerRadius ?? 0) > 0) { roundRectPath(ctx, b.x, b.y, b.width, b.height, b.cornerRadius); ctx.clip(); }
          ctx.drawImage(v, vsx, vsy, vsw, vsh, b.x, b.y, b.width, b.height);
          ctx.restore();
          return;
        }
        const img = imageBoxImgsRef.current.get(b.url);
        if (!img || !img.complete || !img.naturalWidth) {
          // Empty image placeholder (slot): no drawable image yet. In the EDITOR draw a dashed frame
          // + image glyph + label so the slot is visible and selectable. Draw NOTHING for any export:
          //  • staticMode → the headless render page (/render), and
          //  • targetCanvas set → every blob/download/video render (renderImageBlob for IG publish,
          //    startDownload, video export) — which run on the interactive (staticMode=false) canvas.
          // So empty slots always export blank, keeping the original empty-url bail.
          if (b.placeholder && (previewPlaceholdersRef.current || (!staticMode && !targetCanvas && !enforceLocksRef.current)) && mode === 'all') {
            const r = Math.max(0, b.cornerRadius ?? 0);
            const bg = '#e8ebef';   // classic light-grey image-placeholder fill
            const fg = '#647082';   // slate-grey glyph
            const markerLabel = b.name || b.placeholderLabel || 'Image Layer';   // caption = layer name (default 'Image Layer')
            const hasLabel = !!markerLabel;
            ctx.save();
            ctx.globalAlpha = (b.opacity ?? 100) / 100;
            // Solid grey fill (respects cornerRadius)
            roundRectPath(ctx, b.x, b.y, b.width, b.height, r);
            ctx.fillStyle = bg;
            ctx.fill();
            // Centered image glyph: rounded-square frame + sun + mountains, all in slate grey
            const cx = b.x + b.width / 2;
            const cy = b.y + b.height / 2 - (hasLabel ? Math.min(b.width, b.height) * 0.05 : 0);
            const gs = Math.max(40, Math.min(220, Math.min(b.width, b.height) * 0.34));
            const gx = cx - gs / 2, gy = cy - gs / 2;
            ctx.strokeStyle = fg; ctx.fillStyle = fg;
            ctx.lineWidth = Math.max(3, gs * 0.075);
            ctx.lineJoin = 'round';
            roundRectPath(ctx, gx, gy, gs, gs, gs * 0.12);
            ctx.stroke();
            // Sun + mountains, clipped to the frame interior so they sit cleanly inside
            ctx.save();
            roundRectPath(ctx, gx, gy, gs, gs, gs * 0.12);
            ctx.clip();
            ctx.beginPath();
            ctx.arc(gx + gs * 0.32, gy + gs * 0.34, gs * 0.10, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(gx,               gy + gs);
            ctx.lineTo(gx + gs * 0.38,   gy + gs * 0.56);
            ctx.lineTo(gx + gs * 0.55,   gy + gs * 0.72);
            ctx.lineTo(gx + gs * 0.72,   gy + gs * 0.50);
            ctx.lineTo(gx + gs,          gy + gs);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            // Optional slot label under the glyph
            if (hasLabel) {
              const fontPx = Math.max(16, Math.min(30, gs * 0.22));
              ctx.font = `600 ${fontPx}px ${resolveCarouselFont('Inter').css}`;
              setLS(0);
              ctx.fillStyle = fg;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              ctx.fillText(markerLabel!, cx, gy + gs + gs * 0.16);
            }
            ctx.restore();
          }
          return;
        }
        const radius = b.cornerRadius ?? 0;
        // Crop = source sub-rectangle (fraction off each edge) drawn into the box.
        const cp = b.crop;
        let cL = cp?.left ?? 0, cR = cp?.right ?? 0, cT = cp?.top ?? 0, cB = cp?.bottom ?? 0;
        // A filled placeholder SLOT with no explicit crop covers its frame like CSS
        // object-fit: cover — preserve the image's aspect, centre, crop the overflow —
        // instead of stretching. An explicit crop (user re-framed the slot) wins.
        if ((b.placeholder || b.fit === 'cover') && !cp && b.width > 0 && b.height > 0) {
          const boxA = b.width / b.height;
          const imgA = img.naturalWidth / img.naturalHeight;
          if (imgA > boxA)      { const f = (1 - boxA / imgA) / 2; cL = f; cR = f; }
          else if (imgA < boxA) { const f = (1 - imgA / boxA) / 2; cT = f; cB = f; }
        }
        const sx = cL * img.naturalWidth;
        const sy = cT * img.naturalHeight;
        const sw = Math.max(1, (1 - cL - cR) * img.naturalWidth);
        const sh = Math.max(1, (1 - cT - cB) * img.naturalHeight);
        // Foreground/background adjustments. When "detect background" is on and the cut-out is ready,
        // the foreground effects apply to the subject and the background effects to the rest; otherwise
        // the foreground effects apply to the WHOLE image. (Effects: brightness/blur/noise. Edge fade is
        // applied over the composited result.)
        const fgImg = imageBoxFgImgsRef.current.get(b.url);
        const split    = !!b.splitEnabled && !!fgImg && fgImg.complete && !!fgImg.naturalWidth;
        const fgActive = imageEffectsActive(b.fgEffects);
        const bgActive = split && imageEffectsActive(b.bgEffects);
        // Edge fade is per-layer: b.fade = foreground (subject when split, whole image otherwise);
        // b.bgFade = background (split only).
        const fgFadeActive = imageFadeActive(b.fade);
        const bgFadeActive = split && imageFadeActive(b.bgFade);
        // Subject outline: a tinted, dilated silhouette of the cut-out drawn between the background
        // and the subject. Only meaningful once the split cut-out is ready; forces the layered path
        // (the plain whole-image draw has no between-layers gap to put it in).
        const strokeActive = split && !!b.fgStroke && b.fgStroke.width > 0;
        const layered  = split && (fgActive || bgActive || fgFadeActive || bgFadeActive || strokeActive);
        // Perspective: warp the finished box buffer onto the destination quad (WebGL). Forces the
        // buffered path so there is always a rectangular source texture to warp.
        const persp = perspectiveActive(b.perspective) ? b.perspective! : null;
        // mode: 'all' = whole box (default). 'bg'/'fg' render only the background / subject of a split host,
        // so other image boxes (behindSubjectOf) can be drawn in the gap between them. Subject-only with no
        // ready cut-out has nothing to draw.
        if (mode === 'fg' && !split) return;
        ctx.save();
        ctx.globalAlpha = (b.opacity ?? 100) / 100;
        if (b.blend) ctx.globalCompositeOperation = b.blend as GlobalCompositeOperation;
        if (mode !== 'bg') applyShadow(ctx, b.shadow);   // the bare-background pass casts no shadow
        if (mode !== 'all' || radius > 0 || fgFadeActive || bgFadeActive || fgActive || bgActive || persp || strokeActive) {
          // Composite into an offscreen buffer (device px) so the drop shadow follows the silhouette and
          // filters render cleanly. The buffer is CACHED per box: position/opacity/blend/shadow/perspective
          // are all applied at blit time below, so they don't invalidate it — only content/effects/size do.
          // This avoids recomputing the expensive per-pixel noise + blur on every drag/redraw.
          const w = Math.max(1, Math.round(b.width  * sc));
          const h = Math.max(1, Math.round(b.height * sc));
          // Subject-outline buffer: the cut-out stamped (same source rect → same destination mapping
          // as the real fg draw) around a circle of radius = fgStroke.width, plus a half-radius ring
          // and a centre stamp for solidity, then tinted via source-in → a solid expanded silhouette.
          // Cached per box (see imageBoxStrokeCacheRef) — ~50 stamps only run when the key changes.
          const strokeBufferFor = (bw: number, bh: number): HTMLCanvasElement | null => {
            const st = b.fgStroke!;
            const sKey = JSON.stringify([fgImg!.src, st.color, st.width, bw, bh, sc, sx, sy, sw, sh]);
            const cached = imageBoxStrokeCacheRef.current.get(b.id);
            if (cached && cached.key === sKey) return cached.canvas;
            const sbuf = cached?.canvas ?? document.createElement('canvas');
            sbuf.width = bw; sbuf.height = bh;   // assigning size also clears the buffer
            const sctx = sbuf.getContext('2d');
            if (!sctx) return null;
            // fgStroke.width is design px; the buffer is device px — scale like blur (imageEffectsFilter).
            const r = st.width * sc;
            const OUTER = 32, INNER = 12;
            for (let k = 0; k < OUTER; k++) {
              const a = (k / OUTER) * Math.PI * 2;
              sctx.drawImage(fgImg!, sx, sy, sw, sh, Math.cos(a) * r, Math.sin(a) * r, bw, bh);
            }
            for (let k = 0; k < INNER; k++) {
              const a = (k / INNER) * Math.PI * 2;
              sctx.drawImage(fgImg!, sx, sy, sw, sh, Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, bw, bh);
            }
            sctx.drawImage(fgImg!, sx, sy, sw, sh, 0, 0, bw, bh);
            sctx.globalCompositeOperation = 'source-in';   // tint the accumulated silhouette
            sctx.fillStyle = st.color;
            sctx.fillRect(0, 0, bw, bh);
            sctx.globalCompositeOperation = 'source-over';
            imageBoxStrokeCacheRef.current.set(b.id, { canvas: sbuf, key: sKey });
            return sbuf;
          };
          const fxKey = JSON.stringify([
            mode, b.url, w, h, sc, radius, b.crop ?? 0,
            split, split ? fgImg!.src : 0,
            b.fgEffects ?? 0, b.bgEffects ?? 0, b.fade ?? 0, b.bgFade ?? 0,
            b.fgStroke ?? 0,
          ]);
          const cacheKey = b.id + '::' + mode;   // bg/fg/all buffers for one box coexist
          let entry = imageBoxFxCacheRef.current.get(cacheKey);
          if (!entry || entry.key !== fxKey || entry.canvas.width !== w || entry.canvas.height !== h) {
            const buf = entry?.canvas ?? document.createElement('canvas');
            buf.width = w; buf.height = h;   // assigning size also clears the buffer
            const bctx = buf.getContext('2d');
            if (bctx) {
              bctx.save();
              if (radius > 0) { roundRectPath(bctx, 0, 0, w, h, radius * sc); bctx.clip(); }
              if (mode === 'bg') {
                // Background only: the full image. Split → background effects/fade; otherwise the box's own.
                const eff  = split ? b.bgEffects : b.fgEffects;
                const fade = split ? b.bgFade    : b.fade;
                paintLayer(bctx, img, eff, hashStr(b.id), w, h, sc, sx, sy, sw, sh, !eff?.blurEdgeFade);
                if (imageFadeActive(fade)) { bctx.save(); bctx.scale(sc, sc); paintImageBoxFades(bctx, fade!, b.width, b.height); bctx.restore(); }
              } else if (mode === 'fg') {
                // Subject only (transparent elsewhere): the cut-out + fg effects + fg edge fade.
                // With an outline: the outline first (it rings the silhouette from below), then the
                // subject composited via the scratch fg buffer so fg noise (getImageData over the
                // whole layer) can't grain the outline ring.
                if (strokeActive) {
                  const sbuf = strokeBufferFor(w, h);
                  if (sbuf) bctx.drawImage(sbuf, 0, 0);
                  const fbuf = imageBoxFgBufRef.current ?? (imageBoxFgBufRef.current = document.createElement('canvas'));
                  fbuf.width = w; fbuf.height = h;
                  const fctx = fbuf.getContext('2d');
                  if (fctx) {
                    paintLayer(fctx, fgImg!, b.fgEffects, hashStr(b.id) ^ 0x9e3779b9, w, h, sc, sx, sy, sw, sh, false);
                    if (fgFadeActive) { fctx.save(); fctx.scale(sc, sc); paintImageBoxFades(fctx, b.fade!, b.width, b.height); fctx.restore(); }
                    bctx.save(); bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.drawImage(fbuf, 0, 0); bctx.restore();
                  }
                } else {
                  paintLayer(bctx, fgImg!, b.fgEffects, hashStr(b.id) ^ 0x9e3779b9, w, h, sc, sx, sy, sw, sh, false);
                  if (fgFadeActive) { bctx.save(); bctx.scale(sc, sc); paintImageBoxFades(bctx, b.fade!, b.width, b.height); bctx.restore(); }
                }
              } else if (layered) {
                // Background = full image + bg effects, then the background edge fade.
                paintLayer(bctx, img, b.bgEffects, hashStr(b.id), w, h, sc, sx, sy, sw, sh, !b.bgEffects?.blurEdgeFade);
                if (bgFadeActive) { bctx.save(); bctx.scale(sc, sc); paintImageBoxFades(bctx, b.bgFade!, b.width, b.height); bctx.restore(); }
                // Subject outline: over the (blurred) background, under the subject drawn next.
                if (strokeActive) { const sbuf = strokeBufferFor(w, h); if (sbuf) bctx.drawImage(sbuf, 0, 0); }
                // Foreground = subject cut-out + fg effects, then the foreground edge fade, composited on top.
                const fbuf = imageBoxFgBufRef.current ?? (imageBoxFgBufRef.current = document.createElement('canvas'));
                fbuf.width = w; fbuf.height = h;
                const fctx = fbuf.getContext('2d');
                if (fctx) {
                  paintLayer(fctx, fgImg!, b.fgEffects, hashStr(b.id) ^ 0x9e3779b9, w, h, sc, sx, sy, sw, sh, false);
                  if (fgFadeActive) { fctx.save(); fctx.scale(sc, sc); paintImageBoxFades(fctx, b.fade!, b.width, b.height); fctx.restore(); }
                  bctx.save(); bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.drawImage(fbuf, 0, 0); bctx.restore();
                }
              } else {
                // Not separated: the foreground effects + edge fade apply to the whole image.
                paintLayer(bctx, img, b.fgEffects, hashStr(b.id), w, h, sc, sx, sy, sw, sh, !b.fgEffects?.blurEdgeFade);
                if (fgFadeActive) { bctx.save(); bctx.scale(sc, sc); paintImageBoxFades(bctx, b.fade!, b.width, b.height); bctx.restore(); }
              }
              bctx.restore();
            }
            entry = { canvas: buf, key: fxKey };
            imageBoxFxCacheRef.current.set(cacheKey, entry);
          }
          const buf = entry.canvas;
          if (persp) {
            // Destination quad corners (canvas px) = box rect corners + per-corner offsets.
            const cr = [
              { x: b.x + persp.tl.x,           y: b.y + persp.tl.y },
              { x: b.x + b.width + persp.tr.x, y: b.y + persp.tr.y },
              { x: b.x + b.width + persp.br.x, y: b.y + b.height + persp.br.y },
              { x: b.x + persp.bl.x,           y: b.y + b.height + persp.bl.y },
            ];
            const minX = Math.min(cr[0].x, cr[1].x, cr[2].x, cr[3].x);
            const minY = Math.min(cr[0].y, cr[1].y, cr[2].y, cr[3].y);
            const qw = Math.max(1, Math.max(cr[0].x, cr[1].x, cr[2].x, cr[3].x) - minX);
            const qh = Math.max(1, Math.max(cr[0].y, cr[1].y, cr[2].y, cr[3].y) - minY);
            // Corners relative to the bounding box, in device px (the GL output space).
            const gc = cr.map(p => ({ x: (p.x - minX) * sc, y: (p.y - minY) * sc })) as [WarpPt, WarpPt, WarpPt, WarpPt];
            const warped = warpImageToQuad(buf, gc, qw * sc, qh * sc);
            if (warped) ctx.drawImage(warped, minX, minY, qw, qh);
            else ctx.drawImage(buf, b.x, b.y, b.width, b.height);   // WebGL unavailable / degenerate quad
          } else {
            ctx.drawImage(buf, b.x, b.y, b.width, b.height);
          }
        } else {
          ctx.drawImage(img, sx, sy, sw, sh, b.x, b.y, b.width, b.height);
        }
        ctx.restore();
      };

      const drawTextBox = (tb: TextBoxStyle) => {
        if (!tb) return;
        // Placeholder "highlight": alternate primary/secondary weight per word, computed live from the
        // current weights. Otherwise use the box's own per-run spans (manual styling).
        const placeholderAlt = !!tb.fillPlaceholder && tb.secondaryWeight != null && tb.secondaryWeight !== tb.fontWeight && !!tb.text;
        const renderSpans = placeholderAlt ? alternateWeightSpans(tb.text, tb.fontWeight, tb.secondaryWeight!) : tb.spans;
        const hasSpans = !!(renderSpans && renderSpans.length > 0);
        if (!hasSpans && !tb.text) return;
        const tbFont  = resolveCarouselFont(tb.fontLabel);
        const tbW     = tb.width  ?? 540;
        const tbH     = tb.height ?? 200;
        const tbVA    = tb.vAlign ?? 'top';
        const tbLineH = tb.fontSize * (1.0 + ((tb.lineHeight ?? 15) / 100) * 1.2);
        ctx.save();
        ctx.globalAlpha  = (tb.opacity ?? 100) / 100;
        applyShadow(ctx, tb.shadow);
        ctx.textBaseline = 'top';
        ctx.font         = `${tb.italic ? 'italic ' : ''}${tb.fontWeight} ${tb.fontSize}px ${tbFont.css}`;
        setLS(tb.letterSpacing ?? 0);

        if (tb.fitToWidth) {
          // Poster mode: auto-break + scale each line's font size to fill the box width.
          const secW = tb.secondaryWeight ?? tb.fontWeight;   // secondary runs resolve to this at render
          const fitSpans: TextSpan[] = hasSpans
            ? renderSpans!.map(s => ({ ...s, text: tb.allCaps ? s.text.toUpperCase() : s.text, ...(s.secondary ? { weight: secW } : {}) }))
            : [{ text: tb.allCaps ? (tb.text ?? '').toUpperCase() : (tb.text ?? '') }];
          const factor = 1.0 + ((tb.lineHeight ?? 15) / 100) * 1.2;
          // autoHeight: lines come from the manual breaks; the box height hugs the content (kept in sync
          // by the fit-to-width height effect). The vAlign offset positions the block at the anchored edge.
          const { lines, totalHeight } = layoutFitToWidth(ctx, fitSpans, tbW, tbH, factor, tbFont.css, tb.fontWeight, tb.italic, true);
          const canvasW = 2 * tb.x + tbW;
          let y = tb.y + (tbVA === 'middle' ? (tbH - totalHeight) / 2 : tbVA === 'bottom' ? (tbH - totalHeight) : 0);
          for (const ln of lines) {
            // textBaseline is 'top', so the ink starts topPad BELOW the origin and that padding
            // scales with the line's size. Subtract it and every line's INK starts at y, which
            // is what keeps the gaps even when line sizes differ (see layoutFitToWidth).
            drawSpanLine(ctx, ln.segs, y - (ln.topPad ?? 0), 'left', tb.x, tbW, canvasW, tbFont.css, ln.size, tb.fontWeight, tb.italic, tb.color ?? '#ffffff', 0, sc);
            y += ln.height;
          }
          clearShadow(ctx);
          ctx.restore();
          return;
        }

        if (tb.singleLine) {
          // HARD single line (fitToWidth wins above): never wrap — the whole text renders as ONE line
          // ('\n' draws as a space) at the box's fixed font size. Text wider than the box (legacy/bad
          // data — editing refuses such input) simply overflows visually: no clip, no shrink.
          const lineAlign = tb.align === 'justify' ? 'center' : tb.align;   // justify needs 2+ lines; centre like its final line
          const slY = tb.y + (tbVA === 'middle' ? (tbH - tbLineH) / 2 : tbVA === 'bottom' ? (tbH - tbLineH) : 0);
          if (hasSpans) {
            const secW = tb.secondaryWeight ?? tb.fontWeight;   // secondary runs resolve to this at render
            const eSpans = renderSpans!.map(sp => ({ ...sp, text: (tb.allCaps ? sp.text.toUpperCase() : sp.text).replace(/\n/g, ' '), ...(sp.secondary ? { weight: secW } : {}) }));
            const line = eSpans.map(sp => sp.text).join('');
            const canvasW = 2 * tb.x + tbW;   // makes drawSpanLine's centre/right alignment box-relative
            drawSpanLine(ctx, getLineSpanSegs(eSpans, 0, line), slY, lineAlign, tb.x, tbW, canvasW, tbFont.css, tb.fontSize, tb.fontWeight, tb.italic, tb.color ?? '#ffffff', tb.letterSpacing ?? 0, sc);
          } else {
            ctx.fillStyle = tb.color ?? '#ffffff';
            const line = (tb.allCaps ? tb.text.toUpperCase() : tb.text).replace(/\n/g, ' ');
            ctx.textAlign = lineAlign === 'center' ? 'center' : lineAlign === 'right' ? 'right' : 'left';
            const ax = lineAlign === 'center' ? tb.x + tbW / 2 : lineAlign === 'right' ? tb.x + tbW : tb.x;
            ctx.fillText(line, ax, slY);
          }
          clearShadow(ctx);
          ctx.restore();
          return;
        }

        if (hasSpans) {
          // Rich per-run styling: wrap (approximated with the base font), then draw each line's segments.
          const secW = tb.secondaryWeight ?? tb.fontWeight;   // secondary runs resolve to this at render
          const eSpans = renderSpans!.map(sp => ({ ...sp, text: tb.allCaps ? sp.text.toUpperCase() : sp.text, ...(sp.secondary ? { weight: secW } : {}) }));
          const plain = eSpans.map(sp => sp.text).join('');
          const wrapped: { line: string; offset: number; last: boolean }[] = [];
          let g = 0;
          for (const para of plain.split('\n')) {
            if (para === '') { wrapped.push({ line: '', offset: g, last: true }); g += 1; continue; }
            const wls = wrapSpanLines(ctx, eSpans, para, g, tbW, tbFont.css, tb.fontSize, tb.fontWeight, tb.italic);
            wls.forEach((wl, k) => wrapped.push({ line: wl.line, offset: g + wl.offset, last: k === wls.length - 1 }));
            g += para.length + 1;
          }
          const textH  = wrapped.length * tbLineH;
          const canvasW = 2 * tb.x + tbW;   // makes drawSpanLine's centre/right alignment box-relative
          let y = tb.y + (tbVA === 'middle' ? (tbH - textH) / 2 : tbVA === 'bottom' ? (tbH - textH) : 0);
          for (const { line, offset, last } of wrapped) {
            // justify: stretch every line except the final (short) one, which is centred
            const lineAlign = tb.align === 'justify' && last ? 'center' : tb.align;
            drawSpanLine(ctx, getLineSpanSegs(eSpans, offset, line), y, lineAlign, tb.x, tbW, canvasW, tbFont.css, tb.fontSize, tb.fontWeight, tb.italic, tb.color ?? '#ffffff', tb.letterSpacing ?? 0, sc, tb.align === 'justify' && !last);
            y += tbLineH;
          }
        } else {
          ctx.fillStyle = tb.color ?? '#ffffff';
          const tbText = tb.allCaps ? tb.text.toUpperCase() : tb.text;
          const tbLines: { line: string; last: boolean }[] = [];
          for (const para of tbText.split('\n')) {
            if (para === '') { tbLines.push({ line: '', last: true }); continue; }
            const wls = wrapText(ctx, para, tbW);
            wls.forEach((wl, k) => tbLines.push({ line: wl, last: k === wls.length - 1 }));
          }
          const tbTextH   = tbLines.length * tbLineH;
          const isJustify = tb.align === 'justify';
          const tbAX      = tb.align === 'center' ? tb.x + tbW / 2 : tb.align === 'right' ? tb.x + tbW : tb.x;
          let   tbY       = tb.y + (tbVA === 'middle' ? (tbH - tbTextH) / 2 : tbVA === 'bottom' ? (tbH - tbTextH) : 0);
          const spc = ctx as CanvasRenderingContext2D & { wordSpacing?: string };
          spc.wordSpacing = '0px';
          for (const { line, last } of tbLines) {
            if (isJustify && !last) {
              // stretch: widen word gaps so the line fills the box width
              ctx.textAlign = 'left';
              const natural = ctx.measureText(line).width;
              const gaps = (line.match(/ /g) || []).length;
              spc.wordSpacing = gaps > 0 && tbW > natural ? `${((tbW - natural) / gaps).toFixed(2)}px` : '0px';
              ctx.fillText(line, tb.x, tbY);
              spc.wordSpacing = '0px';
            } else if (isJustify) {
              // justify's final (short) line is centred
              ctx.textAlign = 'center';
              ctx.fillText(line, tb.x + tbW / 2, tbY);
            } else {
              ctx.textAlign = tb.align === 'center' ? 'center' : tb.align === 'right' ? 'right' : 'left';
              ctx.fillText(line, tbAX, tbY);
            }
            tbY += tbLineH;
          }
        }
        clearShadow(ctx);
        ctx.restore();
      };

      const editingTbId = editingTextBoxRef.current != null ? txtBoxes[editingTextBoxRef.current]?.id : null;
      // "Behind subject" inserts: image boxes set to render between a detect-background host's background and
      // its subject. They're drawn inside the host's group (bg -> insert(s) -> subject), not at their own z.
      const insertsByHost = new Map<string, ImageBox[]>();
      const insertedIds   = new Set<string>();
      for (const ib of imgBoxes) {
        const hostId = ib.behindSubjectOf;
        if (!hostId || ib.hidden) continue;
        const host = imgBoxes.find(x => x.id === hostId);
        if (host && host.splitEnabled && !host.hidden && host.id !== ib.id) {
          let arr = insertsByHost.get(hostId);
          if (!arr) { arr = []; insertsByHost.set(hostId, arr); }
          arr.push(ib);
          insertedIds.add(ib.id);
        }
      }
      // A box has its background removed wherever it's drawn — standalone, as a split host, OR sent
      // behind another image's subject: bgHidden on, split on, and the subject cut-out loaded.
      const bgRemoved = (bx: ImageBox): boolean => {
        if (!bx.bgHidden || !bx.splitEnabled) return false;
        const f = imageBoxFgImgsRef.current.get(bx.url);
        return !!f && f.complete && !!f.naturalWidth;
      };
      for (const { kind, id } of layers) {
        if (kind === 'fade')       { if (fadeShown && !fadeAtBottom) drawFade(); }
        else if (kind === 'image') {
          const b = imgBoxes.find(x => x.id === id);
          if (!b || b.hidden || insertedIds.has(b.id)) continue;   // inserts draw inside their host's group
          // "Remove background": render only the subject (transparent behind) and skip the
          // background layer. Falls back to the whole image until the cut-out has loaded.
          const removeBg = bgRemoved(b);
          const inserts = insertsByHost.get(b.id);
          if (inserts && inserts.length) {
            if (!removeBg) drawImageBox(b, 'bg');                  // host background (skipped when removed)
            // Each inserted image keeps its OWN remove-background: subject-only when it has it on.
            for (const ins of inserts) drawImageBox(ins, bgRemoved(ins) ? 'fg' : 'all');
            drawImageBox(b, 'fg');                                 // host subject on top
          } else if (removeBg) {
            drawImageBox(b, 'fg');                                 // subject only — background removed
          } else {
            drawImageBox(b, 'all');
          }
        }
        else if (kind === 'chart') {
          const cb = chartBoxesArr.find(x => x.id === id);
          if (cb && !cb.hidden) drawChart(ctx, cb, sc, imageBoxImgsRef.current, cb.animate ? chartAnimTimeRef.current : null);
        }
        else                       { const tb = txtBoxes.find(x => x.id === id); if (tb && !tb.hidden && tb.id !== editingTbId) drawTextBox(tb); }
      }
      setLS(0);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const settingsRef = useRef(settings);
    useEffect(() => { settingsRef.current = settings; });
    useEffect(() => { slotsRef.current = slots; });
    const onBgLayerStateChangeRef = useRef(onBgLayerStateChange);
    useEffect(() => { onBgLayerStateChangeRef.current = onBgLayerStateChange; });
    useEffect(() => {
      onBgLayerStateChangeRef.current?.({ fgMaskReady: !!fgMaskSrc, isBgProcessing, bgProcessError });
    }, [fgMaskSrc, isBgProcessing, bgProcessError]);

    // Surface the selected image box upward so the settings panel can edit it
    const onSelectedImageBoxChangeRef = useRef(onSelectedImageBoxChange);
    useEffect(() => { onSelectedImageBoxChangeRef.current = onSelectedImageBoxChange; });
    // Surface inline text-edit state (which box + whether a run is selected) for the settings panel's rich-text controls
    const onTextEditStateChangeRef = useRef(onTextEditStateChange);
    useEffect(() => { onTextEditStateChangeRef.current = onTextEditStateChange; });
    useEffect(() => { onSelectedImageBoxChangeRef.current?.(selectedImageBox); }, [selectedImageBox]);
    // Unified selection signal (text OR image) so the inspector knows which element is active.
    const onSelectionChangeRef = useRef(onSelectionChange);
    useEffect(() => { onSelectionChangeRef.current = onSelectionChange; });
    useEffect(() => {
      onSelectionChangeRef.current?.(
        selectedTextBox  != null ? { kind: 'text',  index: selectedTextBox }
        : selectedImageBox != null ? { kind: 'image', index: selectedImageBox }
        : selectedChartBox != null ? { kind: 'chart', index: selectedChartBox }
        : null
      );
    }, [selectedTextBox, selectedImageBox, selectedChartBox]);
    // Mirror the aspect-lock into a ref so the resize mousemove handler reads the latest value
    const lockImageAspectRef = useRef(lockImageAspect);
    useEffect(() => { lockImageAspectRef.current = lockImageAspect; });
    // Snap-guide set: the fade's floor line joins the standard Y guides, so elements
    // snap to it and the normal guide line shows while dragging (it IS a guideline).
    const yGuidesRef = useRef<number[]>(Y_GUIDES);
    useEffect(() => {
      const s = settingsRef.current;
      let floor: number | null = null;
      // A deleted fade layer has no floor to snap to.
      if (!s.fadeRemoved && s.showFade) {
        if (s.fadeFloorAnchor) {
          const tb = (s.textBoxes ?? []).find(t => t.id === s.fadeFloorAnchor);
          if (tb) floor = tb.y;
        }
        if (floor == null) floor = H - H * 0.6 * (s.fadeFloor / 100);
      }
      yGuidesRef.current = floor != null ? [...Y_GUIDES, Math.round(floor)] : Y_GUIDES;
    });
    const previewPlaceholdersRef = useRef(previewPlaceholders);
    const enforceLocksRef = useRef(enforceLocks);
    useEffect(() => { enforceLocksRef.current = enforceLocks; }, [enforceLocks]);
    useEffect(() => { previewPlaceholdersRef.current = previewPlaceholders; redraw(cachedImgRef.current); }, [previewPlaceholders]);
    // Clear selection if the selected box disappears (e.g. removed from the settings panel)
    useEffect(() => {
      if (selectedImageBox !== null && !(settings.imageBoxes ?? [])[selectedImageBox]) setSelectedImageBox(null);
    }, [settings.imageBoxes, selectedImageBox]);
    // Same guard for text boxes — without it a removed text box leaves a stale selectedTextBox that
    // would keep the wrong inspector section expanded and draw selection handles on the wrong box.
    useEffect(() => {
      if (selectedTextBox !== null && !(settings.textBoxes ?? [])[selectedTextBox]) setSelectedTextBox(null);
    }, [settings.textBoxes, selectedTextBox]);
    useEffect(() => {
      if (selectedChartBox !== null && !(settings.chartBoxes ?? [])[selectedChartBox]) setSelectedChartBox(null);
    }, [settings.chartBoxes, selectedChartBox]);
    // Selection exclusivity: selecting a text/image box anywhere clears the chart selection (the
    // chart frame's own mousedown clears text/image directly) — keeps one element selected at a time.
    useEffect(() => {
      if (selectedImageBox != null || selectedTextBox != null) setSelectedChartBox(null);
    }, [selectedImageBox, selectedTextBox]);

    const redraw = useCallback((img: HTMLImageElement | null) => {
      drawCanvas(img, imgOffsetRef.current.x, imgOffsetRef.current.y, imgScaleRef.current, settingsRef.current);
    }, [drawCanvas]);

    // Sync isDraggingElement / invertedSlots into refs so drawCanvas can access the latest value
    useEffect(() => {
      isDraggingElementRef.current = isDraggingElement;
      redraw(cachedImgRef.current);
    }, [isDraggingElement, redraw]);
    useEffect(() => {
      invertedSlotsRef.current = invertedSlots;
      redraw(cachedImgRef.current);
    }, [invertedSlots, redraw]);

    // Text-only redraw — stable drawCanvas means this won't cascade into image-reset effects
    useEffect(() => {
      redraw(cachedImgRef.current);
    }, [headline, subheadline]); // eslint-disable-line react-hooks/exhaustive-deps

    // Rich text edit mode — sync ref, redraw (hides canvas text), then init contentEditable
    useEffect(() => {
      richEditTargetRef.current = richEditTarget;
      redraw(cachedImgRef.current);
      if (!richEditTarget || !richEditRef.current) return;
      const s = settingsRef.current;
      const isHead = richEditTarget === 'headline';
      const spans = isHead ? s.headlineSpans : s.subSpans;
      const plainText = isHead
        ? (s.allCaps ? headlineRef.current.toUpperCase() : headlineRef.current)
        : (s.subAllCaps ? subheadlineRef.current.toUpperCase() : subheadlineRef.current);
      richEditRef.current.innerHTML = (spans && spans.length > 0)
        ? spansToHtml(spans)
        : plainText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      richEditRef.current.focus();
      const range = document.createRange();
      range.selectNodeContents(richEditRef.current);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }, [richEditTarget, redraw]);  

    // Track text selection inside contentEditable to show floating toolbar
    useEffect(() => {
      if (!richEditTarget) { setToolbarPos(null); return; }
      function onSelChange() {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !richEditRef.current?.contains(sel.anchorNode)) {
          setToolbarPos(null); return;
        }
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        const wrap = wrapperRef.current?.getBoundingClientRect();
        if (!wrap) return;
        setToolbarPos({
          top:  rect.top  - wrap.top  - 44,
          left: Math.max(4, Math.min(rect.left - wrap.left, CAROUSEL_PREVIEW_W - 200)),
        });
      }
      document.addEventListener('selectionchange', onSelChange);
      return () => document.removeEventListener('selectionchange', onSelChange);
    }, [richEditTarget]);

    // Commit a free text box change (used by inline editing + drag/resize handlers)
    const updateTextBox = useCallback((idx: number, patch: Partial<TextBoxStyle>) => {
      const cur = [...(settingsRef.current.textBoxes ?? [])];
      if (!cur[idx]) return;
      cur[idx] = { ...cur[idx], ...patch };
      settingsRef.current = { ...settingsRef.current, textBoxes: cur };
      onSettingsChange?.({ textBoxes: cur });
      redraw(cachedImgRef.current);
    }, [onSettingsChange, redraw]);

    // Fit-to-width auto-height: width is the control, the box height hugs the laid-out text. We measure
    // on a scratch canvas and rewrite height (+ y, so the vAlign-anchored edge stays put). Committed via
    // the ref + a `changed` fixed-point guard so it settles instead of looping on its own update.
    const measureCtxRef = useRef<CanvasRenderingContext2D | null>(null);
    const syncFitToWidthHeights = useCallback(() => {
      const boxes = settingsRef.current.textBoxes ?? [];
      if (!boxes.some(b => b.fitToWidth)) return;
      if (!measureCtxRef.current) measureCtxRef.current = document.createElement('canvas').getContext('2d');
      const mctx = measureCtxRef.current;
      if (!mctx) return;
      let changed = false;
      const next = boxes.map(tb => {
        if (!tb.fitToWidth) return tb;
        const placeholderAlt = !!tb.fillPlaceholder && tb.secondaryWeight != null && tb.secondaryWeight !== tb.fontWeight && !!tb.text;
        const renderSpans = placeholderAlt ? alternateWeightSpans(tb.text, tb.fontWeight, tb.secondaryWeight!) : tb.spans;
        const hasSpans = !!(renderSpans && renderSpans.length > 0);
        if (!hasSpans && !tb.text) return tb;
        const tbFont = resolveCarouselFont(tb.fontLabel);
        const tbW  = tb.width  ?? 540;
        const tbH  = tb.height ?? 200;
        const tbVA = tb.vAlign ?? 'top';
        const secW = tb.secondaryWeight ?? tb.fontWeight;
        const fitSpans: TextSpan[] = hasSpans
          ? renderSpans!.map(s => ({ ...s, text: tb.allCaps ? s.text.toUpperCase() : s.text, ...(s.secondary ? { weight: secW } : {}) }))
          : [{ text: tb.allCaps ? (tb.text ?? '').toUpperCase() : (tb.text ?? '') }];
        const factor = 1.0 + ((tb.lineHeight ?? 15) / 100) * 1.2;
        const { totalHeight } = layoutFitToWidth(mctx, fitSpans, tbW, tbH, factor, tbFont.css, tb.fontWeight, tb.italic, true);
        const newH = Math.round(totalHeight);
        if (newH <= 0) return tb;
        // Anchor with the ROUNDED height (newH), not the float totalHeight, so the anchored edge is
        // exact: for bottom-align, newY + newH === tb.y + tbH (the bottom stays put). Using totalHeight
        // left a ±1px rounding gap, so the box appeared to "shift" vertically as text changed.
        // No Math.max(0,…) clamp: clamping the top to 0 fought a drag off the top edge (each drag set a
        // negative y, the clamp forced it back to 0 → a change that re-triggered this effect → infinite
        // loop). Letting y go negative matches every other edge (off-canvas is allowed) and settles.
        const newY = Math.round(tb.y + (tbVA === 'middle' ? (tbH - newH) / 2 : tbVA === 'bottom' ? (tbH - newH) : 0));
        if (newH === tbH && newY === tb.y) return tb;
        changed = true;
        return { ...tb, height: newH, y: newY };
      });
      if (changed) {
        settingsRef.current = { ...settingsRef.current, textBoxes: next };
        onSettingsChangeRef.current?.({ textBoxes: next });
      }
    }, []);

    // Save the editor's current rich content as spans (+ plain text fallback) onto the text box.
    const commitTextSpans = useCallback((spans: TextSpan[]) => {
      const idx = editingTextBoxRef.current;
      if (idx == null) return;
      const text = spans.map(sp => sp.text).join('');
      const hasStyle = spans.some(sp => sp.color || sp.bold || sp.italic || sp.weight || sp.secondary);
      // Editing claims the box: stop auto-filling so the user's content is never overwritten.
      updateTextBox(idx, { spans: hasStyle ? spans : undefined, text, fillPlaceholder: false });
    }, [updateTextBox]);

    // ── HARD single-line editing guards ─────────────────────────────────────────────────────────
    // The box currently under inline edit, IF it's in hard single-line mode (fitToWidth wins over
    // singleLine, so that combo is ignored). Read from settingsRef so a mid-edit toggle applies.
    const singleLineTbUnderEdit = useCallback((): TextBoxStyle | null => {
      const idx = editingTextBoxRef.current;
      const tb = idx != null ? (settingsRef.current.textBoxes ?? [])[idx] : undefined;
      return tb && tb.singleLine && !tb.fitToWidth ? tb : null;
    }, []);

    // Measure `spans` as ONE rendered line ('\n' counts as a space), replicating the draw path's font
    // construction exactly — per-run weight/italic (drawSpanLine's segWeight rule), secondary-weight
    // resolution, allCaps, and canvas letterSpacing — at design scale (sc = 1, same space as tb.width).
    const measureSingleLineWidth = useCallback((tb: TextBoxStyle, spans: TextSpan[]): number => {
      if (!measureCtxRef.current) measureCtxRef.current = document.createElement('canvas').getContext('2d');
      const mctx = measureCtxRef.current;
      if (!mctx) return 0;
      const font = resolveCarouselFont(tb.fontLabel);
      const secW = tb.secondaryWeight ?? tb.fontWeight;
      const sp = mctx as CanvasRenderingContext2D & { letterSpacing?: string; wordSpacing?: string };
      sp.letterSpacing = `${(tb.letterSpacing ?? 0).toFixed(2)}px`;
      sp.wordSpacing = '0px';
      let w = 0;
      for (const s of spans) {
        const text = (tb.allCaps ? s.text.toUpperCase() : s.text).replace(/\n/g, ' ');
        if (!text) continue;
        const weight = s.secondary ? secW : (s.weight ?? (s.bold ? Math.max(700, tb.fontWeight) : tb.fontWeight));
        const italic = s.italic ?? tb.italic;
        mctx.font = `${italic ? 'italic ' : ''}${weight} ${tb.fontSize}px ${font.css}`;
        w += mctx.measureText(text).width;
      }
      sp.letterSpacing = '0px';
      return w;
    }, []);

    // Current selection inside the inline editor as global character offsets (htmlToSpans counting).
    const editorSelectionRange = useCallback((el: HTMLElement): { start: number; end: number } => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
        const len = htmlToSpans(el).reduce((n, s) => n + s.text.length, 0);
        return { start: len, end: len };   // no usable selection → treat as caret at the end
      }
      const r = sel.getRangeAt(0);
      return {
        start: editorOffsetOf(el, r.startContainer, r.startOffset),
        end:   editorOffsetOf(el, r.endContainer, r.endOffset),
      };
    }, []);

    // Rollback snapshot for insertions that reach the DOM uncancelled (IME composition text): the last
    // content that fit, plus the caret, so a refused edit lands the user exactly where they were.
    const lastGoodSingleLineRef = useRef<{ html: string; caret: number } | null>(null);

    // Swallow Enter and refuse width-overflowing insertions BEFORE they hit the DOM; truncate pastes
    // to what fits. Native listeners (not React's onBeforeInput synthetic) so `inputType` is available.
    useEffect(() => {
      const el = editTextRef.current;
      if (editingTextBox == null || !el) { lastGoodSingleLineRef.current = null; return; }
      // (The initial rollback snapshot is seeded by the inline-edit effect below, AFTER it fills the
      // editor's innerHTML — this effect runs first, when the editor is still empty.)

      const onBeforeInput = (e: InputEvent) => {
        const tb = singleLineTbUnderEdit();
        if (!tb) return;
        const t = e.inputType;
        if (t === 'insertParagraph' || t === 'insertLineBreak') { e.preventDefault(); return; }
        if (!t.startsWith('insert')) return;   // deletions / history / formatting are always allowed
        // Pastes are truncated-to-fit in onPaste below and re-enter here as a plain insertText.
        const data = (e.data ?? e.dataTransfer?.getData('text/plain') ?? '').replace(/\r\n|\r|\n/g, ' ');
        if (!data) return;
        const { start, end } = editorSelectionRange(el);
        const wouldBe = spliceSpansAt(htmlToSpans(el), start, end, data);
        if (measureSingleLineWidth(tb, wouldBe) > (tb.width ?? 540) + SINGLE_LINE_EPS) e.preventDefault();
      };

      const onPaste = (e: ClipboardEvent) => {
        const tb = singleLineTbUnderEdit();
        if (!tb) return;
        e.preventDefault();   // single-line boxes always paste as plain text, truncated to what fits
        const raw = (e.clipboardData?.getData('text/plain') ?? '').replace(/\r\n|\r|\n/g, ' ');
        if (!raw) return;
        const { start, end } = editorSelectionRange(el);
        const cur = htmlToSpans(el);
        const maxW = (tb.width ?? 540) + SINGLE_LINE_EPS;
        let fit = '';
        for (const ch of raw) {   // longest prefix that still fits, character by character
          if (measureSingleLineWidth(tb, spliceSpansAt(cur, start, end, fit + ch)) > maxW) break;
          fit += ch;
        }
        if (fit) document.execCommand('insertText', false, fit);
      };

      el.addEventListener('beforeinput', onBeforeInput);
      el.addEventListener('paste', onPaste);
      return () => {
        el.removeEventListener('beforeinput', onBeforeInput);
        el.removeEventListener('paste', onPaste);
      };
    }, [editingTextBox, singleLineTbUnderEdit, editorSelectionRange, measureSingleLineWidth]);

    // Commit the inline editor's content. For a single-line box, an insertion that slipped past
    // beforeinput uncancelled (IME composition text is not cancelable) and overflows the width is
    // rolled back to the last fitting content — the keystroke simply doesn't land. Deletions and
    // in-flight composition updates always pass (the final check runs at compositionend).
    const handleInlineEditorInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const tb = singleLineTbUnderEdit();
      if (tb) {
        const native = e.nativeEvent as InputEvent;
        const composing = !!native.isComposing;
        const overflow = measureSingleLineWidth(tb, htmlToSpans(el)) > (tb.width ?? 540) + SINGLE_LINE_EPS;
        if (overflow && !composing && (native.inputType ?? '').startsWith('insert') && lastGoodSingleLineRef.current) {
          el.innerHTML = lastGoodSingleLineRef.current.html;
          restoreEditorCaret(el, lastGoodSingleLineRef.current.caret);
        } else if (!composing) {
          lastGoodSingleLineRef.current = { html: el.innerHTML, caret: editorSelectionRange(el).end };
        }
      }
      commitTextSpans(htmlToSpans(el));
    }, [commitTextSpans, singleLineTbUnderEdit, measureSingleLineWidth, editorSelectionRange]);

    // IME safety net: Chrome fires the composition's input events with isComposing=true (uncancelable,
    // not rolled back above), so the final overflow check happens when the composition commits.
    const handleInlineEditorCompositionEnd = useCallback((e: React.CompositionEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const tb = singleLineTbUnderEdit();
      if (!tb) return;
      if (measureSingleLineWidth(tb, htmlToSpans(el)) > (tb.width ?? 540) + SINGLE_LINE_EPS && lastGoodSingleLineRef.current) {
        el.innerHTML = lastGoodSingleLineRef.current.html;
        restoreEditorCaret(el, lastGoodSingleLineRef.current.caret);
      } else {
        lastGoodSingleLineRef.current = { html: el.innerHTML, caret: editorSelectionRange(el).end };
      }
      commitTextSpans(htmlToSpans(el));
    }, [commitTextSpans, singleLineTbUnderEdit, measureSingleLineWidth, editorSelectionRange]);
    // Italic / colour via execCommand on the inline editor's selection; then re-read the DOM into spans.
    const richTextCmd = useCallback((cmd: string, val?: string) => {
      const el = editTextRef.current;
      if (editingTextBoxRef.current == null || !el) return;
      document.execCommand(cmd, false, val);
      commitTextSpans(htmlToSpans(el));
    }, [commitTextSpans]);
    // Apply a font weight to the current selection (no execCommand for arbitrary weight) — wrap the
    // range in a weight span, stripping any inner weight so the new one wins.
    const applyTextWeight = useCallback((weight: number) => {
      const el = editTextRef.current;
      const sel = window.getSelection();
      if (editingTextBoxRef.current == null || !el || !sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (range.collapsed || !el.contains(range.commonAncestorContainer)) return;
      const frag = range.extractContents();
      frag.querySelectorAll<HTMLElement>('[style]').forEach(n => { n.style.fontWeight = ''; });
      const span = document.createElement('span');
      span.style.fontWeight = String(weight);
      span.appendChild(frag);
      range.insertNode(span);
      const r = document.createRange();
      r.selectNodeContents(span);
      sel.removeAllRanges();
      sel.addRange(r);
      commitTextSpans(htmlToSpans(el));
    }, [commitTextSpans]);

    // Toggle the current selection between primary and secondary style. Role-based: the run is tagged
    // data-secondary so it tracks the box's secondaryWeight (resolved at render), not a baked weight.
    const applySelectionSecondary = useCallback(() => {
      const el = editTextRef.current;
      const sel = window.getSelection();
      const idx = editingTextBoxRef.current;
      if (idx == null || !el || !sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (range.collapsed || !el.contains(range.commonAncestorContainer)) return;
      const anchorEl = (range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement) as HTMLElement | null;
      const makeSecondary = anchorEl?.closest('[data-secondary="1"]') == null;   // currently primary → go secondary
      // Ensure a secondary weight exists so the effect is visible; default to a contrasting weight.
      const box = settingsRef.current.textBoxes?.[idx];
      let secW = box?.secondaryWeight;
      if (makeSecondary && (secW == null || secW === box?.fontWeight)) {
        secW = (box?.fontWeight ?? 400) >= 600 ? 300 : 800;
        updateTextBox(idx, { secondaryWeight: secW });
      }
      const displayWeight = makeSecondary ? (secW ?? box?.fontWeight ?? 700) : (box?.fontWeight ?? 400);
      const frag = range.extractContents();
      frag.querySelectorAll<HTMLElement>('[data-secondary]').forEach(n => n.removeAttribute('data-secondary'));
      frag.querySelectorAll<HTMLElement>('[style]').forEach(n => { n.style.fontWeight = ''; });
      const span = document.createElement('span');
      span.setAttribute('data-secondary', makeSecondary ? '1' : '0');
      span.style.fontWeight = String(displayWeight);
      span.appendChild(frag);
      range.insertNode(span);
      const r = document.createRange();
      r.selectNodeContents(span);
      sel.removeAllRanges();
      sel.addRange(r);
      commitTextSpans(htmlToSpans(el));
    }, [commitTextSpans, updateTextBox]);

    // Inline text-box edit mode — sync ref, redraw (hides that box's canvas text), seed the editor + focus
    useEffect(() => {
      editingTextBoxRef.current = editingTextBox;
      redraw(cachedImgRef.current);
      onTextEditStateChangeRef.current?.({ boxIndex: editingTextBox, hasSelection: false });
      if (editingTextBox == null || !editTextRef.current) return;
      const tb = (settingsRef.current.textBoxes ?? [])[editingTextBox];
      if (!tb) return;
      editTextRef.current.innerHTML = spansToHtml(tb.spans && tb.spans.length > 0 ? tb.spans : [{ text: tb.text ?? '' }], tb.secondaryWeight);
      editTextRef.current.focus();
      const range = document.createRange();
      range.selectNodeContents(editTextRef.current);
      range.collapse(false);   // cursor at end
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      // Seed the single-line rollback snapshot with the just-filled content (caret sits at the end).
      lastGoodSingleLineRef.current = {
        html: editTextRef.current.innerHTML,
        caret: htmlToSpans(editTextRef.current).reduce((n, s) => n + s.text.length, 0),
      };
    }, [editingTextBox, redraw]);

    // Report selection state (which box is being edited + whether a run is selected) so the settings
    // panel can light up its rich-text controls for that box.
    useEffect(() => {
      if (editingTextBox == null) return;
      function onSel() {
        const sel = window.getSelection();
        const has = !!sel && !sel.isCollapsed && !!editTextRef.current?.contains(sel.anchorNode) && sel.toString().trim().length > 0;
        onTextEditStateChangeRef.current?.({ boxIndex: editingTextBoxRef.current, hasSelection: has });
      }
      document.addEventListener('selectionchange', onSel);
      return () => document.removeEventListener('selectionchange', onSel);
    }, [editingTextBox]);

    // Drop inline-edit if its box disappears
    useEffect(() => {
      if (editingTextBox !== null && !(settings.textBoxes ?? [])[editingTextBox]) setEditingTextBox(null);
    }, [settings.textBoxes, editingTextBox]);

    // Clean view hides the inline editor; exit edit mode so the box renders normally on the canvas.
    useEffect(() => { if (cleanView) setEditingTextBox(null); }, [cleanView]);

    const drawCropOverlay = useCallback((r: { x: number; y: number; w: number; h: number }) => {
      const vc = cropOverlayRef.current;
      if (!vc) return;
      const ctx = vc.getContext('2d');
      if (!ctx) return;
      const PW = CAROUSEL_PREVIEW_W, PH = CAROUSEL_PREVIEW_H;
      ctx.clearRect(0, 0, PW, PH);
      // Dim the 4 strips outside the crop rect
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, PW, r.y);
      ctx.fillRect(0, r.y, r.x, r.h);
      ctx.fillRect(r.x + r.w, r.y, PW - r.x - r.w, r.h);
      ctx.fillRect(0, r.y + r.h, PW, PH - r.y - r.h);
      // Crop border
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      // Rule-of-thirds grid
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 0.5;
      for (let i = 1; i <= 2; i++) {
        const gx = r.x + r.w * i / 3, gy = r.y + r.h * i / 3;
        ctx.beginPath(); ctx.moveTo(gx, r.y); ctx.lineTo(gx, r.y + r.h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(r.x, gy); ctx.lineTo(r.x + r.w, gy); ctx.stroke();
      }
    }, []);

    function handleLogoFile(idx: number, e: React.ChangeEvent<HTMLInputElement>) {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        logoImgsRef.current[idx] = img;
        const next = [...slotsRef.current] as (SlotContent | null)[];
        next[idx] = { type: 'image', url };
        slotsRef.current = next;
        setSlots(next);
        const curTagSlots   = [...(settingsRef.current.tagSlots   ?? Array(6).fill(null))];
        const curQuoteSlots = [...(settingsRef.current.quoteSlots ?? Array(6).fill(null))];
        const hadTag   = !!curTagSlots[idx];
        const hadQuote = !!curQuoteSlots[idx];
        curTagSlots[idx]   = null;
        curQuoteSlots[idx] = null;
        if (hadTag || hadQuote) onSettingsChange?.({ tagSlots: curTagSlots, quoteSlots: curQuoteSlots });
        redraw(cachedImgRef.current);
      };
      img.src = url;
    }

    function removeSlot(idx: number) {
      const imgSlot = slotsRef.current[idx];
      if (imgSlot?.type === 'image') URL.revokeObjectURL(imgSlot.url);
      logoImgsRef.current[idx] = null;
      const next = [...slotsRef.current] as (SlotContent | null)[];
      next[idx] = null;
      slotsRef.current = next;
      setSlots(next);
      const curTagSlots   = [...(settingsRef.current.tagSlots   ?? Array(3).fill(null))];
      const curQuoteSlots = [...(settingsRef.current.quoteSlots ?? Array(3).fill(null))];
      const curLogoAligns = [...(settingsRef.current.logoSlotAligns ?? Array(3).fill('center'))] as ('left'|'center'|'right')[];
      const curLogoRow    = [...(settingsRef.current.logoRowSlots ?? Array(3).fill(null))];
      curTagSlots[idx]   = null;
      curQuoteSlots[idx] = null;
      curLogoAligns[idx] = 'center';
      curLogoRow[idx]    = null;
      settingsRef.current = { ...settingsRef.current, tagSlots: curTagSlots, quoteSlots: curQuoteSlots, logoSlotAligns: curLogoAligns, logoRowSlots: curLogoRow };
      onSettingsChange?.({ tagSlots: curTagSlots, quoteSlots: curQuoteSlots, logoSlotAligns: curLogoAligns, logoRowSlots: curLogoRow });
      redraw(cachedImgRef.current);
    }

    const [openSlot, setOpenSlot] = useState<number | null>(null);
    const [slotDropdownPos, setSlotDropdownPos] = useState<{ x: number; y: number } | null>(null);
    const slotContainerRefs = useRef<(HTMLDivElement | null)[]>(Array(3).fill(null));
    const [openSubSlot, setOpenSubSlot] = useState<number | null>(null);
    const [showSubCustom, setShowSubCustom] = useState(false);
    const subSlotBtnRefs = useRef<(HTMLButtonElement | null)[]>(Array(3).fill(null));
    const [subDropdownPos, setSubDropdownPos] = useState<{ x: number; y: number } | null>(null);
    const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);
    const [dragOverZone, setDragOverZone] = useState<'left' | 'center' | 'right' | null>(null);
    const [isDividerDrag, setIsDividerDrag] = useState(false);
    const [subDragOverSlot, setSubDragOverSlot] = useState<number | null>(null);
    const [subSlotFilled, setSubSlotFilled] = useState<boolean[]>(() =>
      (settings.dividerSubSlots ?? Array(3).fill(null)).map((s: DividerSubSlotContent | null) => s !== null)
    );
    useEffect(() => {
      setSubSlotFilled((settings.dividerSubSlots ?? Array(3).fill(null)).map((s: DividerSubSlotContent | null) => s !== null));
    }, [settings.dividerSubSlots]);
    const pendingSlotZoneRef = useRef<'left' | 'center' | 'right'>('center');

    // Close slot dropdown when clicking outside any slot or the portal dropdown
    useEffect(() => {
      if (openSlot === null) return;
      function onDoc(e: MouseEvent) {
        if ((e.target as Element).closest('[data-carousel-slot]')) return;
        if ((e.target as Element).closest('[data-slot-dropdown]')) return;
        setOpenSlot(null);
        setSlotDropdownPos(null);
        setShowCustom(false);
      }
      document.addEventListener('mousedown', onDoc);
      return () => document.removeEventListener('mousedown', onDoc);
    }, [openSlot]);

    useEffect(() => {
      if (openSubSlot === null) return;
      function onDoc(e: MouseEvent) {
        if ((e.target as Element).closest('[data-carousel-slot]')) return;
        setOpenSubSlot(null);
        setSubDropdownPos(null);
        setShowSubCustom(false);
      }
      document.addEventListener('mousedown', onDoc);
      return () => document.removeEventListener('mousedown', onDoc);
    }, [openSubSlot]);

    // Load sub-slot images when settings change (e.g. on remount or external settings update)
    useEffect(() => {
      (settings.dividerSubSlots ?? []).forEach((sub, i) => {
        if (sub?.type === 'image' && !subImgRefsArr.current[i]) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => { subImgRefsArr.current[i] = img; redraw(cachedImgRef.current); };
          img.src = sub.url;
        }
        if (!sub || sub.type !== 'image') subImgRefsArr.current[i] = null;
      });
    }, [settings.dividerSubSlots]); // eslint-disable-line react-hooks/exhaustive-deps

    // Restore zone logo images when settings are hydrated from DB
    useEffect(() => {
      (settings.zoneLogoSlots ?? []).forEach((logoUrl, fi) => {
        if (!logoUrl) { zoneLogoImgsRef.current[fi] = null; return; }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => { zoneLogoImgsRef.current[fi] = img; redraw(cachedImgRef.current); };
        img.src = logoUrl;
        if (img.complete && img.naturalWidth > 0) { zoneLogoImgsRef.current[fi] = img; redraw(cachedImgRef.current); }
      });
    }, [settings.zoneLogoSlots]); // eslint-disable-line react-hooks/exhaustive-deps

    // Restore row-slot logo images when settings are hydrated from DB
    useEffect(() => {
      (settings.logoRowSlots ?? []).forEach((logoUrl, idx) => {
        if (!logoUrl) { logoImgsRef.current[idx] = null; return; }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const apply = () => {
          logoImgsRef.current[idx] = img;
          const next = [...slotsRef.current] as (SlotContent | null)[];
          next[idx] = { type: 'image', url: logoUrl };
          slotsRef.current = next;
          setSlots(next);
          redraw(cachedImgRef.current);
        };
        img.onload = apply;
        img.src = logoUrl;
        if (img.complete && img.naturalWidth > 0) apply();
      });
    }, [settings.logoRowSlots]); // eslint-disable-line react-hooks/exhaustive-deps

    // Brand assets may be video (mp4/webm/mov). Logo SLOTS draw from HTMLImageElement
    // refs and SlotContent is image-only, so a video cannot go in one — `new Image()`
    // would simply never fire onload and the slot would stay empty with no error.
    // Video branding belongs in an image BOX (videoUrl), which the canvas renders
    // frame-by-frame: drag the asset onto the canvas instead of clicking a slot.
    const isVideoAsset = (u?: string) => !!u && /\.(mp4|webm|mov|m4v)($|\?)/i.test(u);

    function selectBrandLogo(idx: number) {
      if (!brandLogoSrc) return;
      if (isVideoAsset(brandLogoSrc)) {
        console.warn('Brand asset is a video: logo slots hold stills only. Drag it onto the canvas to add it as a playing video element.');
        return;
      }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let applied = false;
      const apply = () => {
        if (applied) return;
        applied = true;
        logoImgsRef.current[idx] = img;
        const next = [...slotsRef.current] as (SlotContent | null)[];
        next[idx] = { type: 'image', url: brandLogoSrc };
        slotsRef.current = next;
        setSlots(next);
        const curTagSlots   = [...(settingsRef.current.tagSlots   ?? Array(3).fill(null))];
        const curQuoteSlots = [...(settingsRef.current.quoteSlots ?? Array(3).fill(null))];
        const curLogoRow    = [...(settingsRef.current.logoRowSlots ?? Array(3).fill(null))];
        curTagSlots[idx]   = null;
        curQuoteSlots[idx] = null;
        curLogoRow[idx]    = brandLogoSrc;
        settingsRef.current = { ...settingsRef.current, tagSlots: curTagSlots, quoteSlots: curQuoteSlots, logoRowSlots: curLogoRow };
        onSettingsChange?.({ tagSlots: curTagSlots, quoteSlots: curQuoteSlots, logoRowSlots: curLogoRow });
        redraw(cachedImgRef.current);
      };
      img.onload = apply;
      img.src = brandLogoSrc;
      if (img.complete && img.naturalWidth > 0) apply();
    }

    function selectTag(idx: number, text: string, style: TagStyle) {
      const imgSlot = slotsRef.current[idx];
      if (imgSlot?.type === 'image') URL.revokeObjectURL(imgSlot.url);
      logoImgsRef.current[idx] = null;
      const next = [...slotsRef.current] as (SlotContent | null)[];
      next[idx] = null;
      slotsRef.current = next;
      setSlots(next);
      const curTagSlots   = [...(settingsRef.current.tagSlots   ?? Array(3).fill(null))];
      const curQuoteSlots = [...(settingsRef.current.quoteSlots ?? Array(3).fill(null))];
      curTagSlots[idx]   = { text, style };
      curQuoteSlots[idx] = null;
      settingsRef.current = { ...settingsRef.current, tagSlots: curTagSlots, quoteSlots: curQuoteSlots };
      onSettingsChange?.({ tagSlots: curTagSlots, quoteSlots: curQuoteSlots });
    }

    const ZONES = ['left', 'center', 'right'] as const;
    function ziFromZone(z: 'left' | 'center' | 'right') { return z === 'left' ? 0 : z === 'center' ? 1 : 2; }

    function selectTagZone(row: number, zone: 'left' | 'center' | 'right', text: string, style: TagStyle) {
      const fi = row * 3 + ziFromZone(zone);
      const cur = [...(settingsRef.current.tagZoneSlots ?? Array(9).fill(null))];
      cur[fi] = { text, style };
      settingsRef.current = { ...settingsRef.current, tagZoneSlots: cur };
      onSettingsChange?.({ tagZoneSlots: cur });
      redraw(cachedImgRef.current);
    }

    function selectBrandLogoZone(row: number, zone: 'left' | 'center' | 'right') {
      if (!brandLogoSrc) return;
      if (isVideoAsset(brandLogoSrc)) {
        console.warn('Brand asset is a video: logo zones hold stills only. Drag it onto the canvas to add it as a playing video element.');
        return;
      }
      const fi = row * 3 + ziFromZone(zone);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let applied = false;
      const apply = () => {
        if (applied) return;
        applied = true;
        zoneLogoImgsRef.current[fi] = img;
        const cur = [...(settingsRef.current.zoneLogoSlots ?? Array(9).fill(null))];
        cur[fi] = brandLogoSrc;
        settingsRef.current = { ...settingsRef.current, zoneLogoSlots: cur };
        onSettingsChange?.({ zoneLogoSlots: cur });
        redraw(cachedImgRef.current);
      };
      img.onload = apply;
      img.src = brandLogoSrc;
      if (img.complete && img.naturalWidth > 0) apply();
    }

    function selectQuoteZone(row: number, zone: 'left' | 'center' | 'right', styleId: string) {
      const fi = row * 3 + ziFromZone(zone);
      const cur = [...(settingsRef.current.quoteZoneSlots ?? Array(9).fill(null))];
      cur[fi] = styleId;
      settingsRef.current = { ...settingsRef.current, quoteZoneSlots: cur };
      onSettingsChange?.({ quoteZoneSlots: cur });
      redraw(cachedImgRef.current);
    }

    function selectSwipeZone(row: number, zone: 'left' | 'center' | 'right', style: SwipeStyle) {
      const fi = row * 3 + ziFromZone(zone);
      const cur = [...(settingsRef.current.swipeZoneSlots ?? Array(9).fill(null))];
      cur[fi] = style;
      settingsRef.current = { ...settingsRef.current, swipeZoneSlots: cur };
      onSettingsChange?.({ swipeZoneSlots: cur });
      redraw(cachedImgRef.current);
    }

    function removeZoneSlot(row: number, zone: 'left' | 'center' | 'right') {
      const fi = row * 3 + ziFromZone(zone);
      const curTag   = [...(settingsRef.current.tagZoneSlots   ?? Array(9).fill(null))];
      const curQuo   = [...(settingsRef.current.quoteZoneSlots ?? Array(9).fill(null))];
      const curLogo  = [...(settingsRef.current.zoneLogoSlots  ?? Array(9).fill(null))];
      const curSwipe = [...(settingsRef.current.swipeZoneSlots ?? Array(9).fill(null))];
      curTag[fi]  = null;
      curQuo[fi]  = null;
      curLogo[fi] = null;
      curSwipe[fi] = null;
      zoneLogoImgsRef.current[fi] = null;
      settingsRef.current = { ...settingsRef.current, tagZoneSlots: curTag, quoteZoneSlots: curQuo, zoneLogoSlots: curLogo, swipeZoneSlots: curSwipe };
      onSettingsChange?.({ tagZoneSlots: curTag, quoteZoneSlots: curQuo, zoneLogoSlots: curLogo, swipeZoneSlots: curSwipe });
      redraw(cachedImgRef.current);
    }

    function setTagSlotAlign(idx: number, align: 'left' | 'center' | 'right') {
      const cur = [0, 1, 2].map(k =>
        (settingsRef.current.tagSlotAligns?.[k] ?? 'center') as 'left' | 'center' | 'right'
      );
      cur[idx] = align;
      settingsRef.current = { ...settingsRef.current, tagSlotAligns: cur };
      onSettingsChange?.({ tagSlotAligns: cur });
      redraw(cachedImgRef.current);
    }

    function setLogoSlotAlign(idx: number, align: 'left' | 'center' | 'right') {
      const cur = [0, 1, 2].map(k =>
        (settingsRef.current.logoSlotAligns?.[k] ?? 'center') as 'left' | 'center' | 'right'
      );
      cur[idx] = align;
      settingsRef.current = { ...settingsRef.current, logoSlotAligns: cur };
      onSettingsChange?.({ logoSlotAligns: cur });
      redraw(cachedImgRef.current);
    }

    function selectQuote(idx: number, styleId: string) {
      const imgSlot = slotsRef.current[idx];
      if (imgSlot?.type === 'image') URL.revokeObjectURL(imgSlot.url);
      logoImgsRef.current[idx] = null;
      const next = [...slotsRef.current] as (SlotContent | null)[];
      next[idx] = null;
      slotsRef.current = next;
      setSlots(next);
      const curTagSlots   = [...(settingsRef.current.tagSlots   ?? Array(3).fill(null))];
      const curQuoteSlots = [...(settingsRef.current.quoteSlots ?? Array(3).fill(null))];
      curTagSlots[idx]   = null;
      curQuoteSlots[idx] = styleId;
      settingsRef.current = { ...settingsRef.current, tagSlots: curTagSlots, quoteSlots: curQuoteSlots };
      onSettingsChange?.({ tagSlots: curTagSlots, quoteSlots: curQuoteSlots });
    }

    function handleSubSlotFile(idx: number, e: React.ChangeEvent<HTMLInputElement>) {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        subImgRefsArr.current[idx] = img;
        const cur = [...(settingsRef.current.dividerSubSlots ?? Array(3).fill(null))] as (DividerSubSlotContent | null)[];
        cur[idx] = { type: 'image', url };
        settingsRef.current = { ...settingsRef.current, dividerSubSlots: cur };
        onSettingsChange?.({ dividerSubSlots: cur });
        redraw(cachedImgRef.current);
      };
      img.src = url;
    }

    function selectSubBrandLogo(idx: number) {
      if (!brandLogoSrc) return;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let applied = false;
      const apply = () => {
        if (applied) return;
        applied = true;
        subImgRefsArr.current[idx] = img;
        const cur = [...(settingsRef.current.dividerSubSlots ?? Array(3).fill(null))] as (DividerSubSlotContent | null)[];
        cur[idx] = { type: 'image', url: brandLogoSrc };
        settingsRef.current = { ...settingsRef.current, dividerSubSlots: cur };
        onSettingsChange?.({ dividerSubSlots: cur });
        redraw(cachedImgRef.current);
      };
      img.onload = apply;
      img.src = brandLogoSrc;
      if (img.complete && img.naturalWidth > 0) apply();
      setSubSlotFilled(prev => { const n = [...prev]; n[idx] = true; return n; });
    }

    function selectSubTag(idx: number, text: string, style: TagStyle) {
      const cur = [...(settingsRef.current.dividerSubSlots ?? Array(3).fill(null))] as (DividerSubSlotContent | null)[];
      cur[idx] = { type: 'tag', text, style };
      settingsRef.current = { ...settingsRef.current, dividerSubSlots: cur };
      onSettingsChange?.({ dividerSubSlots: cur });
      redraw(cachedImgRef.current);
      setSubSlotFilled(prev => { const n = [...prev]; n[idx] = true; return n; });
    }

    function selectSubSwipe(idx: number, style: SwipeStyle) {
      const cur = [...(settingsRef.current.dividerSubSlots ?? Array(3).fill(null))] as (DividerSubSlotContent | null)[];
      cur[idx] = { type: 'swipe', style };
      settingsRef.current = { ...settingsRef.current, dividerSubSlots: cur };
      onSettingsChange?.({ dividerSubSlots: cur });
      redraw(cachedImgRef.current);
      setSubSlotFilled(prev => { const n = [...prev]; n[idx] = true; return n; });
    }

    function clearSubSlot(idx: number) {
      const sub = settingsRef.current.dividerSubSlots?.[idx];
      if (sub?.type === 'image') URL.revokeObjectURL(sub.url);
      subImgRefsArr.current[idx] = null;
      const cur = [...(settingsRef.current.dividerSubSlots ?? Array(3).fill(null))] as (DividerSubSlotContent | null)[];
      cur[idx] = null;
      settingsRef.current = { ...settingsRef.current, dividerSubSlots: cur };
      onSettingsChange?.({ dividerSubSlots: cur });
      redraw(cachedImgRef.current);
      setSubSlotFilled(prev => { const n = [...prev]; n[idx] = false; return n; });
    }

    // Image load — reset transform + crop + clear bg mask
    useEffect(() => {
      imgOffsetRef.current  = { x: 0, y: 0 };
      imgScaleRef.current   = 1; setImgScale(1);
      imgSrcCropRef.current = null;
      fgMaskImgRef.current  = null;
      fgMaskSrcRef.current  = null;
      setFgMaskSrc(null);
      setBgProcessError(false);
      onSettingsChange?.({ bgBlurEnabled: false });
      if (!imageSrc) { cachedImgRef.current = null; redraw(null); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => { cachedImgRef.current = img; redraw(img); runBgRemovalRef.current('split'); };
      img.onerror = () => { cachedImgRef.current = null; redraw(null); };
      img.src = imageSrc;
    }, [imageSrc, redraw]);   // eslint-disable-line react-hooks/exhaustive-deps

    // Video mode: reset transform on src change + run animation loop for live draw
    useEffect(() => {
      if (!videoSrc) { if (animFrameRef.current !== null) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; } return; }
      imgOffsetRef.current = { x: 0, y: 0 };
      imgScaleRef.current  = 1; setImgScale(1);
      imgSrcCropRef.current = null;
      trimStartRef.current = 0;
      trimEndRef.current   = Infinity;
    }, [videoSrc]);  

    useEffect(() => {
      if (!videoSrc) return;
      let id: number;
      let lastDrawTime = 0;
      const loop = () => {
        const v = videoRef.current;
        if (v && !v.paused) {
          const end = trimEndRef.current === Infinity ? v.duration : trimEndRef.current;
          if (!isNaN(end) && v.currentTime >= end) {
            v.currentTime = trimStartRef.current;
          }
          lastDrawTime = 0; // reset throttle so next paused check draws immediately
          redraw(null);
        } else {
          const now = performance.now();
          if (now - lastDrawTime >= 100) {
            lastDrawTime = now;
            redraw(null);
          }
        }
        id = requestAnimationFrame(loop);
      };
      id = requestAnimationFrame(loop);
      animFrameRef.current = id;
      return () => { cancelAnimationFrame(id); animFrameRef.current = null; };
    }, [videoSrc, redraw]);

    // Pulse animation loop for divider placeholder boxes
    useEffect(() => {
      const hasDivSlots = (settings.dividerSlots ?? []).some(d => d !== null);
      if (!hasDivSlots) {
        if (pulseRafRef.current !== null) { cancelAnimationFrame(pulseRafRef.current); pulseRafRef.current = null; }
        pulseAlphaRef.current = 0.12;
        return;
      }
      let id: number;
      const tick = (t: number) => {
        pulseAlphaRef.current = 0.08 + 0.06 * Math.sin(t / 900 * Math.PI * 2);
        if (!videoModeRef.current) redraw(cachedImgRef.current);
        id = requestAnimationFrame(tick);
      };
      id = requestAnimationFrame(tick);
      pulseRafRef.current = id;
      return () => { cancelAnimationFrame(id); pulseRafRef.current = null; };
    }, [settings.dividerSlots, redraw]);  

    // Load foreground mask image when mask src changes
    useEffect(() => {
      if (!fgMaskSrc) { fgMaskImgRef.current = null; return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { fgMaskImgRef.current = img; redraw(cachedImgRef.current); };
      img.src = fgMaskSrc;
    }, [fgMaskSrc, redraw]);

    // Circle image loads (separate effects so changing one src doesn't re-trigger the other)
    const [circleSrc0, circleSrc1] = [circleSrcs[0], circleSrcs[1]];
    useEffect(() => {
      if (!circleSrc0) { circleImgRefsArr.current[0] = null; redraw(cachedImgRef.current); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { circleImgRefsArr.current[0] = img; redraw(cachedImgRef.current); };
      img.src = circleSrc0;
    }, [circleSrc0, redraw]);
    useEffect(() => {
      if (!circleSrc1) { circleImgRefsArr.current[1] = null; redraw(cachedImgRef.current); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { circleImgRefsArr.current[1] = img; redraw(cachedImgRef.current); };
      img.src = circleSrc1;
    }, [circleSrc1, redraw]);

    // Font async redraw
    useEffect(() => {
      const f1 = resolveCarouselFont(settings.fontLabel);
      const f2 = resolveCarouselFont(settings.subFontLabel);
      Promise.all([
        ensureFontLoaded(f1, settings.fontWeight, settings.italic),
        ensureFontLoaded(f2, settings.subFontWeight, settings.subItalic),
      ]).then(() => redraw(cachedImgRef.current));
    }, [settings.fontLabel, settings.fontWeight, settings.italic, settings.subFontLabel, settings.subFontWeight, settings.subItalic, redraw]);

    // Redraw when an uploaded font finishes loading (or the custom-font set changes)
    const customFonts = useCustomFonts();
    useEffect(() => { redraw(cachedImgRef.current); }, [customFonts, redraw]);

    // Preload fonts used by free text boxes, then redraw. Loads the secondary (highlight) weight too —
    // otherwise the canvas falls back to the nearest loaded weight and the alternation looks uniform.
    useEffect(() => {
      const boxes = settings.textBoxes ?? [];
      if (!boxes.length) return;
      Promise.all(boxes.flatMap(tb => {
        const f = resolveCarouselFont(tb.fontLabel);
        const loads = [ensureFontLoaded(f, tb.fontWeight, tb.italic)];
        if (tb.secondaryWeight != null) loads.push(ensureFontLoaded(f, tb.secondaryWeight, tb.italic));
        return loads;
      })).then(() => { syncFitToWidthHeights(); redraw(cachedImgRef.current); });
    }, [settings.textBoxes, redraw, syncFitToWidthHeights]);

    // Fill placeholder text boxes with their chosen number of lorem words (alternating primary/secondary
    // weight when a secondary is set). Skips a box being inline-edited; the `changed` guard makes the write
    // a fixed point so it doesn't loop on its own settings update.
    useEffect(() => {
      const boxes = settings.textBoxes ?? [];
      if (!boxes.some(b => b.fillPlaceholder)) return;
      const editingId = editingTextBoxRef.current;
      let changed = false;
      const next = boxes.map((b, i) => {
        if (!b.fillPlaceholder || i === editingId) return b;
        const text = buildFiller(b.placeholderWords ?? 8);
        // Store plain text only — the primary/secondary alternation is applied at render time.
        if (text !== b.text || (b.spans && b.spans.length)) { changed = true; return { ...b, text, spans: undefined }; }
        return b;
      });
      if (changed) {
        settingsRef.current = { ...settingsRef.current, textBoxes: next };
        // Via the ref (not the prop) so this effect doesn't re-run on every parent render — the
        // onSettingsChange prop is a fresh closure each render, which would otherwise re-enter this
        // setState-bearing effect and can spiral into "Maximum update depth exceeded".
        onSettingsChangeRef.current?.({ textBoxes: next });
      }
    }, [settings.textBoxes, editingTextBox]);

    // Sync redraw on any settings change
    useEffect(() => {
      drawCanvas(cachedImgRef.current, imgOffsetRef.current.x, imgOffsetRef.current.y, imgScaleRef.current, settings);
    }, [drawCanvas, settings]);

    // (Background scroll-wheel zoom removed — the background stays at its set scale; reposition by dragging.)

    // Drag
    useEffect(() => {
      function onMove(e: MouseEvent) {
        if (!isDragging) return;
        const dx = (e.clientX - dragStartRef.current.mx) / DISPLAY_SCALE;
        const dy = (e.clientY - dragStartRef.current.my) / DISPLAY_SCALE;
        imgOffsetRef.current = { x: dragStartRef.current.ox + dx, y: dragStartRef.current.oy + dy };
        redraw(cachedImgRef.current);
      }
      function onUp() { setIsDragging(false); }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    }, [isDragging, redraw]);

    // Circle drag (handles whichever circle is active)
    // Circle drag wired synchronously in the circle element's onMouseDown (see render) — releases on mouse-up.

    // Free text box drag — wired synchronously in the text box onMouseDown (see render) so it
    // releases on mouse-up; moves the active box and snaps edges + centre to canvas guides.

    // Free text box resize — wired synchronously in the resize-handle onMouseDown (see render) so
    // it releases on mouse-up; drag a handle to resize the frame (text rewraps).

    // Free text box keyboard — Delete/Backspace removes, arrows nudge (Shift = 10px), Escape deselects
    useEffect(() => {
      if (selectedTextBox === null) return;
      const idx = selectedTextBox;
      function onKey(e: KeyboardEvent) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (e.key === 'Escape') { setSelectedTextBox(null); return; }
        if ((settingsRef.current.textBoxes ?? [])[idx]?.locked) return;   // locked: no delete/move
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          const cur = [...(settingsRef.current.textBoxes ?? [])];
          if (!cur[idx]) return;
          cur.splice(idx, 1);
          settingsRef.current = { ...settingsRef.current, textBoxes: cur };
          onSettingsChange?.({ textBoxes: cur });
          setSelectedTextBox(null);
          redraw(cachedImgRef.current);
          return;
        }
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const cur = [...(settingsRef.current.textBoxes ?? [])];
        const tb = cur[idx];
        if (!tb || tb.locked) return;
        if (enforceLocks && hasGeometryLock(tb)) return;   // posts: template froze this box's geometry
        let nx = tb.x, ny = tb.y;
        if (e.key === 'ArrowLeft')  nx -= step;
        if (e.key === 'ArrowRight') nx += step;
        if (e.key === 'ArrowUp')    ny -= step;
        if (e.key === 'ArrowDown')  ny += step;
        const bw = tb.width ?? 540, bh = tb.height ?? 200;   // allow nudging off any edge (matches drag)
        cur[idx] = { ...tb, x: Math.max(-bw, Math.min(W, nx)), y: Math.max(-bh, Math.min(H, ny)) };
        settingsRef.current = { ...settingsRef.current, textBoxes: cur };
        onSettingsChange?.({ textBoxes: cur });
        redraw(cachedImgRef.current);
      }
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [selectedTextBox, redraw, onSettingsChange, enforceLocks]);

    // Option/Alt while a text, image, or chart box is selected → show edge-to-canvas spacing measurements
    useEffect(() => {
      if (selectedTextBox === null && selectedImageBox === null && selectedChartBox === null) { setAltHeld(false); return; }
      function sync(e: KeyboardEvent) { setAltHeld(e.altKey); }
      function clear() { setAltHeld(false); }
      window.addEventListener('keydown', sync);
      window.addEventListener('keyup', sync);
      window.addEventListener('blur', clear);
      return () => {
        window.removeEventListener('keydown', sync);
        window.removeEventListener('keyup', sync);
        window.removeEventListener('blur', clear);
      };
    }, [selectedTextBox, selectedImageBox, selectedChartBox]);

    // ── Image boxes: load sources (redraw on load) ──────────────────────────────
    useEffect(() => {
      const boxes = settings.imageBoxes ?? [];
      // Evict cached source images + cut-outs for urls no longer referenced (e.g. after an
      // expand/replace or a box delete) so the caches don't grow unbounded over a session.
      const liveUrls = new Set(boxes.map(b => b.url));
      for (const url of [...imageBoxImgsRef.current.keys()])   if (!liveUrls.has(url)) imageBoxImgsRef.current.delete(url);
      for (const url of [...imageBoxFgImgsRef.current.keys()]) if (!liveUrls.has(url)) imageBoxFgImgsRef.current.delete(url);
      let pending = false;
      for (const b of boxes) {
        if (b.videoUrl) continue;   // video boxes render from a <video>, not the image cache
        if (!imageBoxImgsRef.current.has(b.url)) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => { setImageBoxSrcTick(t => t + 1); redraw(cachedImgRef.current); };   // tick re-runs the split compute for boxes waiting on this source
          img.onerror = () => {
            // Drop the broken entry so a later settings change can retry the load.
            console.warn('[imageBox] image failed to load (CORS or stale URL?):', b.url);
            imageBoxImgsRef.current.delete(b.url);
          };
          img.src = b.url;
          imageBoxImgsRef.current.set(b.url, img);
          pending = true;
        }
      }
      if (pending) redraw(cachedImgRef.current);
    }, [settings.imageBoxes, redraw]);

    // Preload chart release album-art into the shared image cache (drawChart reads from it for the
    // round x-axis markers); redraw as each loads so markers appear in the editor and exports.
    useEffect(() => {
      if ((settings.chartBoxes?.length ?? 0) > 0) {
        // Chart text renders in Geist (the trading site's font); redraw when it finishes loading.
        ensureChartFont(() => redraw(cachedImgRef.current));
      }
      const urls = new Set<string>();
      for (const cb of settings.chartBoxes ?? []) for (const u of chartImageUrls(cb)) urls.add(u);
      let pending = false;
      for (const url of urls) {
        if (imageBoxImgsRef.current.has(url)) continue;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload  = () => { setImageBoxSrcTick(t => t + 1); redraw(cachedImgRef.current); };
        img.onerror = () => { imageBoxImgsRef.current.delete(url); };
        img.src = url;
        imageBoxImgsRef.current.set(url, img);
        pending = true;
      }
      if (pending) redraw(cachedImgRef.current);
    }, [settings.chartBoxes, redraw]);

    // ── Video boxes: one <video> per source, drawn frame-by-frame. Keyed by videoUrl so shared sources
    //    reuse one element; detached elements are fine for canvas drawing. Created PAUSED + muted (showing
    //    the first frame); the on-canvas play button plays the chosen one with sound. ──
    useEffect(() => {
      const boxes = settings.imageBoxes ?? [];
      const liveVideoUrls = new Set(boxes.filter(b => b.videoUrl).map(b => b.videoUrl!));
      for (const [url, el] of [...videoBoxElsRef.current.entries()]) {
        if (!liveVideoUrls.has(url)) { el.pause(); el.removeAttribute('src'); el.load(); videoBoxElsRef.current.delete(url); }
      }
      // If the playing video was removed (slide change / delete), drop playback state.
      setPlayingVideoUrl(prev => (prev && !liveVideoUrls.has(prev)) ? null : prev);
      for (const b of boxes) {
        if (!b.videoUrl || videoBoxElsRef.current.has(b.videoUrl)) continue;
        const el = document.createElement('video');
        el.crossOrigin = 'anonymous';
        el.loop = true;
        el.playsInline = true;
        el.muted = true;          // muted until the user presses play (then it plays with sound)
        el.preload = 'auto';
        el.onloadeddata = () => redraw(cachedImgRef.current);
        el.src = b.videoUrl;
        videoBoxElsRef.current.set(b.videoUrl, el);
      }
    }, [settings.imageBoxes, redraw]);

    // Drive a rAF redraw only while a video is actually playing, so its frames animate on the canvas.
    // Paused video boxes show a static frame (redrawn on the usual triggers), costing nothing per frame.
    useEffect(() => {
      if (!playingVideoUrl) return;
      let raf = 0;
      const tick = () => { redraw(cachedImgRef.current); raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }, [playingVideoUrl, redraw]);

    // Animated-chart preview loop: while any visible chart has animate on (and we're not exporting,
    // which drives the time itself), play the 20s timeline on the canvas and reset — looping.
    const chartAnimActive = !staticMode && (settings.chartBoxes ?? []).some(c => c.animate && !c.hidden);
    useEffect(() => {
      if (!chartAnimActive) { chartAnimTimeRef.current = null; redraw(cachedImgRef.current); return; }
      let raf = 0;
      const start = performance.now();
      const tick = (now: number) => {
        if (!isVideoExportingRef.current) {   // the exporter owns the clock during an export
          chartAnimTimeRef.current = (now - start) % CHART_ANIM_TOTAL_MS;
          redraw(cachedImgRef.current);
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => { cancelAnimationFrame(raf); chartAnimTimeRef.current = null; };
    }, [chartAnimActive, redraw]);

    // Play one video box with sound (pausing/muting any other), or pause it if it's the one playing.
    const toggleVideoPlay = useCallback((videoUrl: string) => {
      const el = videoBoxElsRef.current.get(videoUrl);
      if (!el) return;
      setPlayingVideoUrl(prev => {
        if (prev === videoUrl) { el.pause(); return null; }
        for (const [u, other] of videoBoxElsRef.current) { if (u !== videoUrl) { other.pause(); other.muted = true; } }
        el.muted = false;
        el.play().catch(() => {});
        return videoUrl;
      });
    }, []);

    // Release all video elements on unmount (stop playback + downloads). Mount-scoped so it doesn't fire
    // on every imageBoxes change like the sync effect above. Captures the ref Map (stable identity).
    useEffect(() => {
      const els = videoBoxElsRef.current;
      return () => { for (const el of els.values()) { el.pause(); el.removeAttribute('src'); el.load(); } els.clear(); };
    }, []);

    // ── Image boxes: subject split — load/compute the cut-out per split-enabled box ──
    // For each box with splitEnabled: load its persisted cut-out (fgUrl) if present,
    // else run removeBackground once on the source image, cache it, persist the PNG to
    // storage (via onUploadImage → box.fgUrl), and redraw. Cut-outs are keyed by the
    // source url so identical sources share one model run; guards dedupe in-flight work.
    useEffect(() => {
      const boxes = settings.imageBoxes ?? [];
      for (const b of boxes) {
        if (!b.splitEnabled || b.isOverlay) continue;
        const key = b.url;
        if (imageBoxFgImgsRef.current.has(key) || imageBoxFgPendingRef.current.has(key)) continue;

        // Persisted cut-out → load directly, no model run.
        if (b.fgUrl) {
          imageBoxFgPendingRef.current.add(key);
          const fimg = new Image();
          fimg.crossOrigin = 'anonymous';
          const p = new Promise<void>(resolve => {
            fimg.onload = () => {
              imageBoxFgImgsRef.current.set(key, fimg);
              imageBoxFgPendingRef.current.delete(key);
              imageBoxFgPromisesRef.current.delete(key);
              redraw(cachedImgRef.current);
              resolve();
            };
            fimg.onerror = () => {
              // Stale/404 fgUrl — drop the guard so a later pass recomputes from source.
              imageBoxFgPendingRef.current.delete(key);
              imageBoxFgPromisesRef.current.delete(key);
              resolve();
            };
          });
          imageBoxFgPromisesRef.current.set(key, p);
          fimg.src = b.fgUrl;
          continue;
        }

        // No cut-out yet — need the source image loaded before we can compute.
        const srcImg = imageBoxImgsRef.current.get(b.url);
        if (!srcImg || !srcImg.complete || !srcImg.naturalWidth) continue;   // retry on a later pass
        const boxId = b.id;
        imageBoxFgPendingRef.current.add(key);
        const p = (async () => {
          setImageBoxBgStatus(prev => ({ ...prev, [boxId]: 'processing' }));
          try {
            const pngBlob = await removeBackgroundBlob(srcImg);
            const objUrl  = URL.createObjectURL(pngBlob);
            const fimg = new Image();
            fimg.crossOrigin = 'anonymous';
            await new Promise<void>((res, rej) => { fimg.onload = () => res(); fimg.onerror = () => rej(new Error('cut-out load failed')); fimg.src = objUrl; });
            imageBoxFgImgsRef.current.set(key, fimg);
            redraw(cachedImgRef.current);
            setImageBoxBgStatus(prev => { const n = { ...prev }; delete n[boxId]; return n; });
            // Persist the cut-out so it survives reload/export without re-running the model.
            const publicUrl = await onUploadImageRef.current?.(pngBlob, `cutout-${boxId}.png`);
            if (publicUrl) {
              const cur = [...(settingsRef.current.imageBoxes ?? [])];
              const idx = cur.findIndex(x => x.id === boxId);
              if (idx >= 0) {
                cur[idx] = { ...cur[idx], fgUrl: publicUrl };
                settingsRef.current = { ...settingsRef.current, imageBoxes: cur };
                onSettingsChangeRef.current?.({ imageBoxes: cur });
              }
            }
          } catch (err) {
            console.error('[imageBox split] removeBackground failed:', err);
            setImageBoxBgStatus(prev => ({ ...prev, [boxId]: 'error' }));
          } finally {
            imageBoxFgPendingRef.current.delete(key);
            imageBoxFgPromisesRef.current.delete(key);
          }
        })();
        imageBoxFgPromisesRef.current.set(key, p);
      }
    }, [settings.imageBoxes, imageBoxSrcTick, redraw]);

    // Image box drag — move; reuses the text-box snap guides
    // NOTE: image-box dragging is wired synchronously inside each frame's onMouseDown (see the
    // image box frames in the render below) — NOT from a state-driven effect here. Binding the
    // window mousemove/mouseup at mousedown guarantees the release is caught; an effect keyed on
    // activeDragImageBox binds a render too late and can drop a quick mouseup, leaving the box
    // stuck to the cursor until the next click.

    // Image box resize — wired synchronously in the corner-handle onMouseDown (see render) so it
    // releases on mouse-up; 8 handles, aspect kept when the panel lock is on or Shift is held.

    // Image box crop — wired synchronously in the centre-edge-handle onMouseDown (see render) so
    // it releases on mouse-up; drags the box edge over a fixed-scale image (always changes aspect).

    // Image box keyboard — Delete/Backspace removes, arrows nudge (Shift = 10px), Escape deselects
    useEffect(() => {
      if (selectedImageBox === null) return;
      const idx = selectedImageBox;
      function onKey(e: KeyboardEvent) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (e.key === 'Escape') { setSelectedImageBox(null); return; }
        if ((settingsRef.current.imageBoxes ?? [])[idx]?.locked) return;   // locked: no delete/move
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          const cur = [...(settingsRef.current.imageBoxes ?? [])];
          if (!cur[idx]) return;
          cur.splice(idx, 1);
          settingsRef.current = { ...settingsRef.current, imageBoxes: cur };
          onSettingsChange?.({ imageBoxes: cur });
          setSelectedImageBox(null);
          redraw(cachedImgRef.current);
          return;
        }
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const cur = [...(settingsRef.current.imageBoxes ?? [])];
        const b = cur[idx];
        if (!b) return;
        if (enforceLocks && hasGeometryLock(b)) return;   // posts: template froze this box's geometry
        let nx = b.x, ny = b.y;
        if (e.key === 'ArrowLeft')  nx -= step;
        if (e.key === 'ArrowRight') nx += step;
        if (e.key === 'ArrowUp')    ny -= step;
        if (e.key === 'ArrowDown')  ny += step;
        const bw = b.width, bh = b.height;   // allow nudging off any edge (matches drag)
        cur[idx] = { ...b, x: Math.max(-bw, Math.min(W, nx)), y: Math.max(-bh, Math.min(H, ny)) };
        settingsRef.current = { ...settingsRef.current, imageBoxes: cur };
        onSettingsChange?.({ imageBoxes: cur });
        redraw(cachedImgRef.current);
      }
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [selectedImageBox, redraw, onSettingsChange, enforceLocks]);

    // Keyboard for the selected chart box — Escape deselect, Delete remove, arrows nudge (mirrors images)
    useEffect(() => {
      if (selectedChartBox === null) return;
      const idx = selectedChartBox;
      function onKey(e: KeyboardEvent) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (e.key === 'Escape') { setSelectedChartBox(null); return; }
        if ((settingsRef.current.chartBoxes ?? [])[idx]?.locked) return;
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          const cur = [...(settingsRef.current.chartBoxes ?? [])];
          if (!cur[idx]) return;
          cur.splice(idx, 1);
          settingsRef.current = { ...settingsRef.current, chartBoxes: cur };
          onSettingsChange?.({ chartBoxes: cur });
          setSelectedChartBox(null);
          redraw(cachedImgRef.current);
          return;
        }
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const cur = [...(settingsRef.current.chartBoxes ?? [])];
        const b = cur[idx];
        if (!b) return;
        let nx = b.x, ny = b.y;
        if (e.key === 'ArrowLeft')  nx -= step;
        if (e.key === 'ArrowRight') nx += step;
        if (e.key === 'ArrowUp')    ny -= step;
        if (e.key === 'ArrowDown')  ny += step;
        cur[idx] = { ...b, x: Math.max(-b.width, Math.min(W, nx)), y: Math.max(-b.height, Math.min(H, ny)) };
        settingsRef.current = { ...settingsRef.current, chartBoxes: cur };
        onSettingsChange?.({ chartBoxes: cur });
        redraw(cachedImgRef.current);
      }
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [selectedChartBox, redraw, onSettingsChange]);

    // Create an image box from a dropped Uploads image (probe aspect, centre on drop point)
    const addImageBox = useCallback((url: string, cxCanvas: number, cyCanvas: number) => {
      const finalize = (aspect: number) => {
        const a = aspect || 1;
        const w = Math.round(Math.min(450, W * 0.6));
        const h = Math.max(20, w / a);  // full precision so width/height === native aspect exactly
        const x = Math.round(Math.max(0, Math.min(W - w, cxCanvas - w / 2)));
        const y = Math.round(Math.max(0, Math.min(H - h, cyCanvas - h / 2)));
        const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
          ? crypto.randomUUID()
          : `ib-${Math.floor(Math.random() * 1e9).toString(36)}`;
        const box = { id, url, x, y, width: w, height: h, opacity: 100, cornerRadius: 0, aspect: a };
        const cur = [...(settingsRef.current.imageBoxes ?? []), box];
        // Template's image-layer marker: when the order carries the __images__ sentinel
        // (posts cloned from a template with a marker), new images insert AT that spot in
        // the stack (below the sentinel, so later adds land above earlier ones) instead of
        // on top. No sentinel (templates, marker-less posts) → fallback append on top.
        const orderNow = settingsRef.current.layerOrderIds;
        const sentinelAt = orderNow?.indexOf(IMAGES_LAYER_ID) ?? -1;
        const orderPatch = orderNow && sentinelAt >= 0
          ? { layerOrderIds: [...orderNow.slice(0, sentinelAt), id, ...orderNow.slice(sentinelAt)] }
          : {};
        settingsRef.current = { ...settingsRef.current, imageBoxes: cur, ...orderPatch };
        onSettingsChange?.({ imageBoxes: cur, ...orderPatch });
        setSelectedTextBox(null);
        setSelectedImageBox(cur.length - 1);
        redraw(cachedImgRef.current);
      };
      const cached = imageBoxImgsRef.current.get(url);
      if (cached && cached.complete && cached.naturalWidth) { finalize(cached.naturalWidth / cached.naturalHeight); return; }
      const probe = new Image();
      probe.crossOrigin = 'anonymous';
      probe.onload = () => { imageBoxImgsRef.current.set(url, probe); finalize(probe.naturalWidth / probe.naturalHeight || 1); };
      probe.onerror = () => console.warn('[imageBox] dropped image failed to load (CORS or bad URL?):', url);
      probe.src = url;
    }, [redraw, onSettingsChange]);

    // Create a VIDEO box from a dropped Uploads video — same as addImageBox, but the box renders the
    // video (videoUrl) instead of a static image. Aspect is probed from the file's intrinsic dimensions.
    const addVideoBox = useCallback((url: string, cxCanvas: number, cyCanvas: number) => {
      const finalize = (aspect: number) => {
        const a = aspect || (W / H);
        const w = Math.round(Math.min(450, W * 0.6));
        const h = Math.max(20, Math.round(w / a));
        const x = Math.round(Math.max(0, Math.min(W - w, cxCanvas - w / 2)));
        const y = Math.round(Math.max(0, Math.min(H - h, cyCanvas - h / 2)));
        const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
          ? crypto.randomUUID() : `vb-${Math.floor(Math.random() * 1e9).toString(36)}`;
        const box: ImageBox = { id, url, videoUrl: url, x, y, width: w, height: h, opacity: 100, cornerRadius: 0, aspect: a };
        const cur = [...(settingsRef.current.imageBoxes ?? []), box];
        settingsRef.current = { ...settingsRef.current, imageBoxes: cur };
        onSettingsChange?.({ imageBoxes: cur });
        setSelectedTextBox(null);
        setSelectedImageBox(cur.length - 1);
        redraw(cachedImgRef.current);
      };
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.crossOrigin = 'anonymous';
      probe.onloadedmetadata = () => finalize(probe.videoWidth / probe.videoHeight || (W / H));
      probe.onerror = () => { console.warn('[videoBox] probe failed to load (CORS or bad URL?):', url); finalize(W / H); };
      probe.src = url;
    }, [redraw, onSettingsChange]);

    // Drop-to-fill: if a dropped image lands on the TOP-MOST empty image placeholder (slot) under the
    // point, set THAT box's url (keeping placeholder: true) instead of creating a new box. Returns true
    // when it filled a slot; the drop handlers fall back to addImageBox otherwise.
    const fillPlaceholderBoxAt = useCallback((url: string, cx: number, cy: number): boolean => {
      // Posts: placeholders are template-only visuals (as-if-deleted; unfilled ones are
      // stripped at post creation) — drops/pastes always become normal image layers.
      if (enforceLocks) return false;
      const s = settingsRef.current;
      const boxes = s.imageBoxes ?? [];
      const fadeOn = !!(s.showFade || s.showTopFade);
      const order = orderedLayerIds(boxes, s.textBoxes ?? [], s.layerOrderIds, fadeOn, s.chartBoxes ?? []);
      for (let k = order.length - 1; k >= 0; k--) {   // top → bottom
        if (order[k].kind !== 'image') continue;
        const idx = boxes.findIndex(b => b.id === order[k].id);
        const b = boxes[idx];
        const fillable = b && b.placeholder && !b.hidden && !b.locked && !b.url;
        if (!fillable) continue;
        if (cx < b.x || cx > b.x + b.width || cy < b.y || cy > b.y + b.height) continue;
        const cur = boxes.map((bx, j) => (j === idx ? { ...bx, url } : bx));
        settingsRef.current = { ...s, imageBoxes: cur };
        onSettingsChange?.({ imageBoxes: cur });
        setSelectedTextBox(null);
        setSelectedImageBox(idx);
        const cached = imageBoxImgsRef.current.get(url);
        if (cached && cached.complete) { redraw(cachedImgRef.current); }
        else {
          const probe = new Image();
          probe.crossOrigin = 'anonymous';
          probe.onload = () => { imageBoxImgsRef.current.set(url, probe); redraw(cachedImgRef.current); };
          probe.onerror = () => console.warn('[placeholder] fill image failed to load:', url);
          probe.src = url;
          redraw(cachedImgRef.current);
        }
        return true;
      }
      return false;
    }, [redraw, onSettingsChange, enforceLocks]);

    // Paste the clipboard layer into the current canvas (a fresh id, placed on top, selected). Works across
    // slides/templates since the clipboard is a module singleton. Overlays keep their full-canvas position;
    // other layers nudge slightly so a same-canvas paste is visibly distinct from the original.
    const pasteLayer = useCallback(() => {
      if (!layerClipboard) return;
      const clip = layerClipboard;
      const elementItems = clip.items.filter(i => i.kind !== 'fade') as Array<
        { kind: 'text'; box: TextBoxStyle; srcId: string } | { kind: 'image'; box: ImageBox; srcId: string } | { kind: 'chart'; box: ChartBox; srcId: string }>;
      if (elementItems.length === 0) return;
      const s = settingsRef.current;
      const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID() : `pl-${Math.floor(Math.random() * 1e9).toString(36)}`;
      const textBoxes  = [...(s.textBoxes ?? [])];
      const imageBoxes = [...(s.imageBoxes ?? [])];
      const chartBoxes = [...(s.chartBoxes ?? [])];
      // Same slide if a copied element still lives here → duplicate (copies on top, leave the fade).
      // Different slide → replicate the exact composition (order incl. the fade marker + fade settings).
      const sameSlide = elementItems.some(it =>
        (s.textBoxes ?? []).some(t => t.id === it.srcId) || (s.imageBoxes ?? []).some(b => b.id === it.srcId)
        || (s.chartBoxes ?? []).some(c => c.id === it.srcId));
      const srcToNew = new Map<string, string>();
      const pasted: Array<{ kind: 'text' | 'image' | 'chart'; id: string }> = [];
      const newImageBoxes: ImageBox[] = [];
      for (const it of elementItems) {
        const box = { ...JSON.parse(JSON.stringify(it.box)), id: newId() };   // exact clone, fresh id
        if (it.kind === 'text') textBoxes.push(box as TextBoxStyle);
        else if (it.kind === 'chart') chartBoxes.push(box as ChartBox);
        else { imageBoxes.push(box as ImageBox); newImageBoxes.push(box as ImageBox); }
        srcToNew.set(it.srcId, box.id);
        pasted.push({ kind: it.kind, id: box.id });
      }
      // Re-point each "behind subject of" reference at the COPIED host so the relationship survives the
      // paste (the original host id won't exist on a different slide). Hosts not in the copy keep theirs.
      for (const box of newImageBoxes) {
        if (box.behindSubjectOf && srcToNew.has(box.behindSubjectOf)) box.behindSubjectOf = srcToNew.get(box.behindSubjectOf);
      }
      const fadeOn = !!(s.showFade || s.showTopFade);
      const curOrder = orderedLayerIds(s.imageBoxes ?? [], s.textBoxes ?? [], s.layerOrderIds, fadeOn, s.chartBoxes ?? []).map(x => x.id);
      const hasFadeInClip = clip.items.some(i => i.kind === 'fade');
      let layerOrderIds: string[];
      let fadePatch: Partial<CarouselSettings> = {};
      if (sameSlide) {
        layerOrderIds = [...curOrder, ...pasted.map(p => p.id)];   // copies on top, same internal order
      } else {
        // rebuild the source's bottom→top order with new ids; the fade marker keeps its place
        const seqIds = clip.items
          .map(it => it.kind === 'fade' ? FADE_LAYER_ID : srcToNew.get(it.srcId))
          .filter((x): x is string => !!x);
        if (hasFadeInClip) {
          const existing = curOrder.filter(id => id !== FADE_LAYER_ID);   // clip re-places the single fade
          layerOrderIds = [...existing, ...seqIds];
          if (clip.fade) fadePatch = clip.fade;                            // bring the fade's look across too
        } else {
          layerOrderIds = [...curOrder, ...seqIds];
        }
      }
      // Posts: strip slide-wide fade settings the template locked — pasting a fade layer from
      // another slide must not override them (template mode: enforceLocks is false, no-op).
      if (enforceLocks && s.lockedSettings?.length) {
        const lockedNames = new Set(s.lockedSettings);
        fadePatch = Object.fromEntries(Object.entries(fadePatch).filter(([k]) => !lockedNames.has(k))) as Partial<CarouselSettings>;
      }
      settingsRef.current = { ...s, textBoxes, imageBoxes, chartBoxes, layerOrderIds, ...fadePatch };
      onSettingsChange?.({ textBoxes, imageBoxes, chartBoxes, layerOrderIds, ...fadePatch });
      if (pasted.length === 1) {
        // single paste → normal single selection so handles + inspector show
        const p = pasted[0];
        if (p.kind === 'text')       { setSelectedImageBox(null); setSelectedChartBox(null); setSelectedTextBox(textBoxes.length - 1); }
        else if (p.kind === 'chart') { setSelectedTextBox(null); setSelectedImageBox(null); setSelectedChartBox(chartBoxes.length - 1); }
        else                         { setSelectedTextBox(null); setSelectedChartBox(null); setSelectedImageBox(imageBoxes.length - 1); }
      } else {
        setSelectedTextBox(null); setSelectedImageBox(null); setSelectedChartBox(null);
        setMultiSel(pasted);   // keep the whole pasted group selected (charts included)
      }
      redraw(cachedImgRef.current);
    }, [onSettingsChange, redraw, enforceLocks]);

    // Copy (⌘/Ctrl+C) the selected layer to the clipboard; paste (⌘/Ctrl+V) into the current canvas.
    // Ignored while typing (inline text edit / inputs) so normal text copy/paste still works.
    useEffect(() => {
      function onKey(e: KeyboardEvent) {
        if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
        const k = e.key.toLowerCase();
        if (k !== 'c' && k !== 'v') return;
        const el = document.activeElement as HTMLElement | null;
        const typing = editingTextBoxRef.current != null
          || (!!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
        if (typing) return;
        const s = settingsRef.current;
        if (k === 'c') {
          const ms = multiSelRef.current;
          // A removed fade layer has nothing to copy; and a pasted fade must
          // RESTORE the layer (fadeRemoved:false) — writing showFade:true onto a
          // removed slide produced a fade that never drew and had no card.
          const fadeSnapshot = (): Partial<CarouselSettings> | null => (!s.fadeRemoved && (s.showFade || s.showTopFade)) ? {
            fadeRemoved: false,
            showFade: s.showFade, fadeFloor: s.fadeFloor, fadeReach: s.fadeReach, fadeIntensity: s.fadeIntensity,
            showTopFade: s.showTopFade, topFadeFloor: s.topFadeFloor, topFadeReach: s.topFadeReach, topFadeIntensity: s.topFadeIntensity,
            fadeHidden: s.fadeHidden, fadeLocked: s.fadeLocked,
          } : null;
          if (ms.length > 0) {
            // Capture the selected layers in TRUE bottom→top stacking order, INCLUDING a 'fade' marker
            // at the fade's position, so paste reproduces the exact layer order (fade included).
            const selIds = new Set(ms.map(m => m.id));
            const fadeOn = !s.fadeRemoved && !!(s.showFade || s.showTopFade);
            const seq = orderedLayerIds(s.imageBoxes ?? [], s.textBoxes ?? [], s.layerOrderIds, fadeOn, s.chartBoxes ?? [])
              .filter(o => o.kind === 'fade' || selIds.has(o.id));
            const items: LayerClipItem[] = [];
            for (const o of seq) {
              if (o.kind === 'fade') items.push({ kind: 'fade' });
              else if (o.kind === 'text')  { const t = (s.textBoxes ?? []).find(x => x.id === o.id);  if (t) items.push({ kind: 'text',  box: JSON.parse(JSON.stringify(t)), srcId: t.id }); }
              else if (o.kind === 'image') { const b = (s.imageBoxes ?? []).find(x => x.id === o.id); if (b) items.push({ kind: 'image', box: JSON.parse(JSON.stringify(b)), srcId: b.id }); }
              else if (o.kind === 'chart') { const c = (s.chartBoxes ?? []).find(x => x.id === o.id); if (c) items.push({ kind: 'chart', box: JSON.parse(JSON.stringify(c)), srcId: c.id }); }
            }
            if (items.some(i => i.kind !== 'fade')) { layerClipboard = { items, fade: fadeSnapshot() }; e.preventDefault(); }
          } else if (selectedTextBox != null && s.textBoxes?.[selectedTextBox]) {
            const t = s.textBoxes[selectedTextBox];
            layerClipboard = { items: [{ kind: 'text', box: JSON.parse(JSON.stringify(t)), srcId: t.id }], fade: null };
            e.preventDefault();
          } else if (selectedImageBox != null && s.imageBoxes?.[selectedImageBox]) {
            const b = s.imageBoxes[selectedImageBox];
            layerClipboard = { items: [{ kind: 'image', box: JSON.parse(JSON.stringify(b)), srcId: b.id }], fade: null };
            e.preventDefault();
          } else if (selectedChartBox != null && s.chartBoxes?.[selectedChartBox]) {
            // Deep clone carries the full snapshot (series, releases, every toggle) — the paste is
            // an exact replica of the chart as copied, on this slide or any other.
            const c = s.chartBoxes[selectedChartBox];
            layerClipboard = { items: [{ kind: 'chart', box: JSON.parse(JSON.stringify(c)), srcId: c.id }], fade: null };
            e.preventDefault();
          }
        } else if (layerClipboard) {
          e.preventDefault();
          pasteLayer();
        }
      }
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [selectedTextBox, selectedImageBox, selectedChartBox, pasteLayer]);

    // Select all (⌘/Ctrl+A) → multi-select every element. While a multi-selection is active, Delete
    // removes them all and Escape clears it. Ignored while typing so ⌘A still works inside inputs.
    useEffect(() => {
      function onKey(e: KeyboardEvent) {
        const el = document.activeElement as HTMLElement | null;
        const typing = editingTextBoxRef.current != null
          || (!!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
        if (typing) return;
        const s = settingsRef.current;
        if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'a') {
          const all = [
            ...(s.textBoxes  ?? []).map(t => ({ kind: 'text'  as const, id: t.id })),
            ...(s.imageBoxes ?? []).map(b => ({ kind: 'image' as const, id: b.id })),
            ...(s.chartBoxes ?? []).map(c => ({ kind: 'chart' as const, id: c.id })),
          ];
          if (all.length === 0) return;
          e.preventDefault();
          setSelectedTextBox(null);
          setSelectedImageBox(null);
          setSelectedChartBox(null);
          setMultiSel(all);
          return;
        }
        if (multiSelRef.current.length === 0) return;
        if (e.key === 'Escape') { setMultiSel([]); return; }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          const sel = new Set(multiSelRef.current.map(m => m.id));
          const textBoxes  = (s.textBoxes  ?? []).filter(t => !sel.has(t.id));
          const imageBoxes = (s.imageBoxes ?? []).filter(b => !sel.has(b.id));
          const chartBoxes = (s.chartBoxes ?? []).filter(c => !sel.has(c.id));
          const layerOrderIds = (s.layerOrderIds ?? []).filter(id => !sel.has(id));
          settingsRef.current = { ...s, textBoxes, imageBoxes, chartBoxes, layerOrderIds };
          onSettingsChange?.({ textBoxes, imageBoxes, chartBoxes, layerOrderIds });
          setMultiSel([]);
          redraw(cachedImgRef.current);
        }
      }
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [onSettingsChange, redraw]);

    // Add a developer overlay texture: full-canvas image box, Screen blend, placed on the top layer + selected.
    const addOverlay = useCallback((url: string) => {
      const s = settingsRef.current;
      const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID()
        : `ov-${Math.floor(Math.random() * 1e9).toString(36)}`;
      const box = { id, url, x: 0, y: 0, width: W, height: H, opacity: 100, cornerRadius: 0, blend: 'screen', isOverlay: true };
      const fadeOn = !!(s.showFade || s.showTopFade);
      const order = orderedLayerIds(s.imageBoxes ?? [], s.textBoxes ?? [], s.layerOrderIds, fadeOn).map(x => x.id);
      const imageBoxes = [...(s.imageBoxes ?? []), box];
      const layerOrderIds = [...order, id];   // top of the stack
      settingsRef.current = { ...s, imageBoxes, layerOrderIds };
      onSettingsChange?.({ imageBoxes, layerOrderIds });
      setSelectedTextBox(null);
      setSelectedImageBox(imageBoxes.length - 1);
      // preload so it draws immediately (the imageBoxes effect also loads it)
      const cached = imageBoxImgsRef.current.get(url);
      if (cached && cached.complete) { redraw(cachedImgRef.current); }
      else {
        const probe = new Image();
        probe.crossOrigin = 'anonymous';
        probe.onload = () => { imageBoxImgsRef.current.set(url, probe); redraw(cachedImgRef.current); };
        probe.onerror = () => console.warn('[overlay] failed to load:', url);
        probe.src = url;
        redraw(cachedImgRef.current);
      }
    }, [redraw, onSettingsChange]);

    const addLightLeak = useCallback((color: string) => {
      const s = settingsRef.current;
      const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID()
        : `ll-${Math.floor(Math.random() * 1e9).toString(36)}`;
      // Default: a soft glow centred near the top-right corner (extends off the top/right edges).
      const w = Math.round(W * 0.8), h = Math.round(H * 0.6);
      const box: ImageBox = {
        id, url: '', x: Math.round(W - w * 0.65), y: Math.round(-h * 0.35),
        width: w, height: h, opacity: 80, cornerRadius: 0, blend: 'screen',
        glow: { color, softness: 70 },
      };
      const fadeOn = !!(s.showFade || s.showTopFade);
      const order = orderedLayerIds(s.imageBoxes ?? [], s.textBoxes ?? [], s.layerOrderIds, fadeOn).map(x => x.id);
      const imageBoxes = [...(s.imageBoxes ?? []), box];
      const layerOrderIds = [...order, id];   // top of the stack
      settingsRef.current = { ...s, imageBoxes, layerOrderIds };
      onSettingsChange?.({ imageBoxes, layerOrderIds });
      setSelectedTextBox(null);
      setSelectedImageBox(imageBoxes.length - 1);
      redraw(cachedImgRef.current);
    }, [redraw, onSettingsChange]);

    // Circle resize / image pan / zoom — all wired synchronously in their respective onMouseDown
    // handlers (the resize handle, the circle element in edit mode, and the zoom handle; see
    // render) so each releases on mouse-up.

    // Circle image wheel zoom — attach to each circle element
    useEffect(() => {
      const els = [circleEl0Ref.current, circleEl1Ref.current];
      const cleanups: (() => void)[] = [];
      els.forEach((el, idx) => {
        if (!el || !circleSrcs[idx]) return;
        function onWheel(e: WheelEvent) {
          e.preventDefault(); e.stopPropagation();
          const next = Math.max(0.5, Math.min(10, circleImgScalesArr.current[idx] * (1 + (-e.deltaY) * 0.005)));
          circleImgScalesArr.current[idx] = next;
          redraw(cachedImgRef.current);
        }
        el.addEventListener('wheel', onWheel, { passive: false });
        cleanups.push(() => el.removeEventListener('wheel', onWheel));
      });
      return () => cleanups.forEach(c => c());
    }, [circleSrcs, redraw]);

    // Escape exits circle image edit mode
    useEffect(() => {
      if (!circleImgEditModes.some(Boolean)) return;
      function onKey(e: KeyboardEvent) {
        if (e.key === 'Escape') setCircleImgEditModes([false, false]);
      }
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [circleImgEditModes]);

    // Escape exits crop mode and restores pre-entry state
    useEffect(() => {
      if (!isCropMode) return;
      function onKey(e: KeyboardEvent) {
        if (e.key !== 'Escape') return;
        const saved = cropEntryStateRef.current;
        if (saved) {
          imgSrcCropRef.current = saved.crop;
          imgOffsetRef.current  = { x: saved.ox, y: saved.oy };
          imgScaleRef.current   = saved.sc;
          setImgScale(saved.sc);
          onScaleChange?.(saved.sc);
          redraw(cachedImgRef.current);
          cropEntryStateRef.current = null;
        }
        setIsCropMode(false);
      }
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [isCropMode, redraw, onScaleChange]);

    // Redraw overlay whenever cropRect changes (e.g. snap to 4:5, reset)
    useEffect(() => { if (isCropMode) drawCropOverlay(cropRect); }, [cropRect, isCropMode, drawCropOverlay]);
    // Draw overlay on enter; clear on exit
    useEffect(() => {
      if (isCropMode) { drawCropOverlay(cropRectRef.current); }
      else { cropOverlayRef.current?.getContext('2d')?.clearRect(0, 0, CAROUSEL_PREVIEW_W, CAROUSEL_PREVIEW_H); }
    }, [isCropMode, drawCropOverlay]);

    // Crop handle drag
    useEffect(() => {
      if (!isCropMode) return;
      const MIN = 40, PW = CAROUSEL_PREVIEW_W, PH = CAROUSEL_PREVIEW_H;
      const AR  = 4 / 5; // width / height for 4:5

      function computeRect(
        handle: string, dx: number, dy: number,
        s: { x: number; y: number; w: number; h: number },
        lock: 'free' | '4:5',
      ) {
        let { x, y, w, h } = s;
        const clW = (v: number) => Math.min(Math.max(v, MIN), PW);
        const clH = (v: number) => Math.min(Math.max(v, MIN), PH);
        switch (handle) {
          case 'se': w = clW(s.w + dx); h = lock === '4:5' ? w / AR : clH(s.h + dy); break;
          case 'sw': w = clW(s.w - dx); x = s.x + s.w - w; h = lock === '4:5' ? w / AR : clH(s.h + dy); break;
          case 'ne': w = clW(s.w + dx); h = lock === '4:5' ? w / AR : clH(s.h - dy); y = s.y + s.h - h; break;
          case 'nw': w = clW(s.w - dx); x = s.x + s.w - w; h = lock === '4:5' ? w / AR : clH(s.h - dy); y = s.y + s.h - h; break;
          case 'e':  w = clW(s.w + dx); if (lock === '4:5') { h = w / AR; y = s.y + (s.h - h) / 2; } break;
          case 'w':  w = clW(s.w - dx); x = s.x + s.w - w; if (lock === '4:5') { h = w / AR; y = s.y + (s.h - h) / 2; } break;
          case 's':  h = clH(s.h + dy); if (lock === '4:5') { w = h * AR; x = s.x + (s.w - w) / 2; } break;
          case 'n':  h = clH(s.h - dy); y = s.y + s.h - h; if (lock === '4:5') { w = h * AR; x = s.x + (s.w - w) / 2; } break;
        }
        // Clamp to canvas bounds
        if (x < 0) { w += x; x = 0; }
        if (y < 0) { h += y; y = 0; }
        if (x + w > PW) w = PW - x;
        if (y + h > PH) h = PH - y;
        return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
      }

      function onMove(e: MouseEvent) {
        if (!cropActiveHandle.current) return;
        const dx = e.clientX - cropDragStart.current.mx;
        const dy = e.clientY - cropDragStart.current.my;
        const nr = computeRect(cropActiveHandle.current, dx, dy, cropDragStart.current.rect, cropLockRef.current);
        cropRectRef.current = nr;
        setCropRect(nr);
        drawCropOverlay(nr);
      }
      function onUp() { cropActiveHandle.current = null; }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    }, [isCropMode, drawCropOverlay]);

    const runBgRemovalRef = useRef<(mode: 'split' | 'blur') => void>(() => {});
    async function runBgRemoval(mode: 'split' | 'blur' = 'split') {
      const img = cachedImgRef.current;
      if (!img || isBgProcessing) return;
      // If mask already exists, just switch mode
      if (fgMaskSrcRef.current) {
        const cur = settingsRef.current;
        if (mode === 'split') {
          onSettingsChange?.({ bgBlurEnabled: !(cur.bgBlurEnabled && cur.bgBlurAmount === 0), bgBlurAmount: 0 });
        } else {
          const newEnabled = !(cur.bgBlurEnabled && cur.bgBlurAmount > 0);
          onSettingsChange?.({ bgBlurEnabled: newEnabled, bgBlurAmount: newEnabled ? (cur.bgBlurAmount > 0 ? cur.bgBlurAmount : 10) : 0 });
        }
        return;
      }
      setIsBgProcessing(true);
      setBgProcessError(false);
      try {
        const blob = await removeBackgroundBlob(img);
        const url = URL.createObjectURL(blob);
        fgMaskSrcRef.current = url;
        setFgMaskSrc(url);
        // Default to split (0 blur); blur mode activates only when explicitly requested
        onSettingsChange?.({ bgBlurEnabled: true, bgBlurAmount: mode === 'blur' ? (settingsRef.current.bgBlurAmount > 0 ? settingsRef.current.bgBlurAmount : 10) : 0 });
      } catch (err) {
        console.error('[BG Blur] removeBackground failed:', err);
        setBgProcessError(true);
      } finally {
        setIsBgProcessing(false);
      }
    }
    runBgRemovalRef.current = runBgRemoval;

    const startVideoExportRef = useRef<() => Promise<void>>(async () => {});
    const startVideoBoxExportRef = useRef<(opts?: { returnBlob?: boolean }) => Promise<Blob | void>>(async () => {});

    // mp4box.js ships no type declarations; these cover only the fields the exports below read.
    interface Mp4BoxTrackInfo { id: number; type: string; timescale?: number }
    interface Mp4BoxInfo { tracks?: Mp4BoxTrackInfo[] }
    interface Mp4BoxSample { data: Uint8Array; cts: number; duration: number; is_sync: boolean }
    // mp4box needs every appended ArrayBuffer to carry its byte offset in `fileStart`.
    type Mp4BoxBuffer = ArrayBuffer & { fileStart: number };

    // mediabunny is imported dynamically; borrow its types without pulling it into the bundle.
    type MediabunnyModule = typeof import('mediabunny');
    type MbEncodedAudioPacketSource = InstanceType<MediabunnyModule['EncodedAudioPacketSource']>;
    type MbEncodedPacket = InstanceType<MediabunnyModule['EncodedPacket']>;
    // Packet timestamps get re-based in place before muxing, but mediabunny declares `timestamp`
    // readonly — this is the same object seen through a locally-writable view.
    type MutableTsPacket = Omit<MbEncodedPacket, 'timestamp'> & { timestamp: number };

    async function startVideoExport(): Promise<void> {
      const srcUrl = videoSrcRef.current;
      if (!srcUrl || isVideoExporting) return;

      const abortController = new AbortController();
      videoExportAbortRef.current = abortController;
      const signal = abortController.signal;

      const emit = (progress: number, status: string) => {
        setVideoExportProgress(progress);
        setVideoExportStatus(status);
        onRecordingStateChangeRef.current?.({ isRecording: true, recProgress: progress, recStatus: status });
      };

      setIsVideoExporting(true);
      emit(0, 'Initializing...');

      try {
        // @ts-expect-error mp4box.js ships no type declarations
        const MP4BoxLib = (await import('mp4box')).default;
        const mediabunny = await import('mediabunny');
        const {
          Output, Mp4OutputFormat, BufferTarget, VideoSample, VideoSampleSource,
          Input, BlobSource, ALL_FORMATS, QUALITY_HIGH, EncodedAudioPacketSource, EncodedPacketSink,
        } = mediabunny;

        const EXPORT_FPS = 30;
        const EXPORT_FRAME_DURATION = 1 / EXPORT_FPS;

        emit(0, 'Downloading video...');
        const response = await fetch(srcUrl, { signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();

        if (signal.aborted) throw new Error('Cancelled');

        emit(0.05, 'Parsing video...');
        const MP4BoxFile = MP4BoxLib.createFile();
        const videoSamples: Array<{ data: Uint8Array; timestamp: number; duration: number; isKeyframe: boolean }> = [];
        const audioSamples: Array<{ data: Uint8Array; timestamp: number; duration: number }> = [];
        let videoTrackId: number | null = null;
        let audioTrackId: number | null = null;
        let videoTimescale = 90000;
        let audioTimescale = 44100;

        MP4BoxFile.onReady = (info: Mp4BoxInfo) => {
          for (const track of info.tracks || []) {
            if (track.type === 'video' && !videoTrackId) { videoTrackId = track.id; videoTimescale = track.timescale || 90000; }
            if (track.type === 'audio' && !audioTrackId) { audioTrackId = track.id; audioTimescale = track.timescale || 44100; }
          }
          if (videoTrackId) MP4BoxFile.setExtractionOptions(videoTrackId, null, { nbSamples: Infinity });
          if (audioTrackId) MP4BoxFile.setExtractionOptions(audioTrackId, null, { nbSamples: Infinity });
          MP4BoxFile.start();
        };
        MP4BoxFile.onSamples = (id: number, _user: unknown, samples: Mp4BoxSample[]) => {
          if (id === videoTrackId) {
            for (const s of samples) videoSamples.push({ data: new Uint8Array(s.data), timestamp: s.cts / videoTimescale, duration: s.duration / videoTimescale, isKeyframe: s.is_sync });
          }
          if (id === audioTrackId) {
            for (const s of samples) audioSamples.push({ data: new Uint8Array(s.data), timestamp: s.cts / audioTimescale, duration: s.duration / audioTimescale });
          }
        };
        MP4BoxFile.onError = (e: unknown) => console.error('[MP4Box carousel]', e);

        const copy = arrayBuffer.slice(0) as Mp4BoxBuffer;
        copy.fileStart = 0;
        MP4BoxFile.appendBuffer(copy);
        MP4BoxFile.flush();

        await new Promise<void>((resolve, reject) => {
          const t = Date.now();
          const id = setInterval(() => {
            if (videoSamples.length > 0) { clearInterval(id); resolve(); }
            else if (Date.now() - t > 10000) { clearInterval(id); reject(new Error('Timeout extracting video samples')); }
          }, 100);
        });

        if (videoSamples.length === 0) throw new Error('No video samples found');

        const lastSample = videoSamples[videoSamples.length - 1];
        const fullDuration = lastSample.timestamp + lastSample.duration;
        const clipStart = trimStartRef.current;
        const clipEnd = trimEndRef.current > 0 && trimEndRef.current <= fullDuration ? trimEndRef.current : fullDuration;
        const clipDuration = Math.max(0.1, clipEnd - clipStart);
        const totalFrames = Math.floor(clipDuration * EXPORT_FPS);

        emit(0.1, 'Decoding video...');

        const decodedFrames: Array<{ frame: VideoFrame; timestamp: number }> = [];
        const decoder = new VideoDecoder({
          output: (frame: VideoFrame) => { decodedFrames.push({ frame, timestamp: frame.timestamp / 1_000_000 }); },
          error: (e: Error) => console.error('[VideoDecoder carousel]', e),
        });

        let description: Uint8Array | undefined;
        if (typeof MP4BoxFile.getSampleDescription === 'function') {
          const descs = MP4BoxFile.getSampleDescription(videoTrackId);
          if (descs?.[0]) description = descs[0].avcC?.config || descs[0].avcC;
        }
        if (!description) {
          try {
            const stsd = MP4BoxFile.getTrackById(videoTrackId)?.mdia?.minf?.stbl?.stsd;
            const entry = stsd?.entries?.[0];
            if (entry?.avcC?.config?.length > 0) description = new Uint8Array(entry.avcC.config);
            else if (typeof entry?.avcC?.subarray === 'function') description = entry.avcC.subarray();
            else if (typeof entry?.avcC?.start !== 'undefined' && entry?.avcC?.size) description = new Uint8Array(arrayBuffer, entry.avcC.start + 8, entry.avcC.size - 8);
          } catch { /* ignore */ }
        }

        decoder.configure({ codec: 'avc1.64001F', codedWidth: 1080, codedHeight: 1920, description });

        for (let i = 0; i < videoSamples.length; i++) {
          if (signal.aborted) { decoder.close(); throw new Error('Cancelled'); }
          const vs = videoSamples[i];
          await decoder.decode(new EncodedVideoChunk({ type: vs.isKeyframe ? 'key' : 'delta', timestamp: vs.timestamp * 1_000_000, data: vs.data }));
          emit(0.1 + (i / videoSamples.length) * 0.2, 'Decoding video...');
        }
        await decoder.flush();
        decoder.close();

        emit(0.3, 'Preparing output...');

        const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
        const videoSource = new VideoSampleSource({ codec: 'avc', bitrate: QUALITY_HIGH });
        output.addVideoTrack(videoSource);

        let audioSource: MbEncodedAudioPacketSource | null = null;
        let audioPackets: MutableTsPacket[] = [];
        let audioDecoderConfigForExport: AudioDecoderConfig | null = null;

        if (audioSamples.length > 0) {
          try {
            const input = new Input({ source: new BlobSource(new Blob([arrayBuffer], { type: 'video/mp4' })), formats: ALL_FORMATS });
            const audioTrack = await input.getPrimaryAudioTrack();
            if (audioTrack) {
              audioDecoderConfigForExport = await audioTrack.getDecoderConfig();
              audioSource = new EncodedAudioPacketSource('aac');
              output.addAudioTrack(audioSource);
              const sink = new EncodedPacketSink(audioTrack);
              for await (const packet of sink.packets()) audioPackets.push(packet);
              const firstTs = audioPackets[0]?.timestamp || 0;
              for (const p of audioPackets) p.timestamp -= firstTs;
              audioPackets = audioPackets.filter((p) => p.timestamp >= clipStart && p.timestamp < clipEnd);
              if (audioPackets.length > 0) {
                const firstTrim = audioPackets[0].timestamp;
                for (const p of audioPackets) p.timestamp -= firstTrim;
              }
            }
          } catch (e) { console.error('[carousel audio]', e); }
        }

        emit(0.35, 'Rendering frames...');
        await output.start();

        const offscreen = new OffscreenCanvas(W, H);

        for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
          if (signal.aborted) { await output.finalize(); throw new Error('Cancelled'); }

          const targetTs = frameIdx * EXPORT_FRAME_DURATION + clipStart;
          let sourceFrame = decodedFrames[0];
          for (const f of decodedFrames) {
            if (f.timestamp <= targetTs) sourceFrame = f;
            else break;
          }

          const vw = sourceFrame.frame.displayWidth;
          const vh = sourceFrame.frame.displayHeight;
          drawCanvas(
            null,
            imgOffsetRef.current.x, imgOffsetRef.current.y, imgScaleRef.current,
            settingsRef.current,
            offscreen,
            { source: sourceFrame.frame, vw, vh },
          );

          const sample = new VideoSample(offscreen, { timestamp: targetTs, duration: EXPORT_FRAME_DURATION });
          await videoSource.add(sample);
          sample.close();
          emit(0.35 + (frameIdx / totalFrames) * 0.55, `Rendering frame ${frameIdx + 1}/${totalFrames}`);
        }

        for (const { frame } of decodedFrames) frame.close();

        if (audioSource && audioPackets.length > 0) {
          for (let i = 0; i < audioPackets.length; i++) {
            // audioSource is only non-null on the path that already awaited the decoder config
            await audioSource.add(audioPackets[i], i === 0 ? { decoderConfig: audioDecoderConfigForExport! } : undefined);
          }
        }

        emit(0.95, 'Finalizing...');
        await output.finalize();

        const buffer = output.target.buffer;
        if (!buffer) throw new Error('No buffer received from output');

        const blob = new Blob([buffer], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);
        Object.assign(document.createElement('a'), { href: url, download: `carousel-${Date.now()}.mp4` }).click();
        URL.revokeObjectURL(url);

        emit(1, 'Done!');

      } catch (error) {
        if (error instanceof Error && error.message !== 'Cancelled') {
          console.error('[carousel video export]', error);
          setVideoExportStatus(`Error: ${error.message}`);
          onRecordingStateChangeRef.current?.({ isRecording: false, recProgress: 0, recStatus: `Error: ${error.message}` });
          setTimeout(() => setVideoExportStatus(''), 3000);
        }
      } finally {
        setIsVideoExporting(false);
        setVideoExportProgress(0);
        setVideoExportStatus('');
        onRecordingStateChangeRef.current?.({ isRecording: false, recProgress: 0, recStatus: '' });
        videoExportAbortRef.current = null;
      }
    }
    startVideoExportRef.current = startVideoExport;

    // Per-slide VIDEO export: composite the slide frame-by-frame (each video box seeked to the frame's
    // timestamp) → .mp4 via mediabunny, muxing the longest box's audio. Visuals reuse drawCanvas so every
    // layer (images, text, fade, each video frame) is included. mp4/H.264, 30fps, full 1080×1350.
    async function startVideoBoxExport(opts?: { returnBlob?: boolean }): Promise<Blob | void> {
      // When returnBlob is set (the Posts → Instagram publisher) the .mp4 is returned to the caller
      // instead of being downloaded, and errors are re-thrown rather than shown in the canvas chrome.
      const returnBlob = !!opts?.returnBlob;
      let outBlob: Blob | undefined;
      if (isVideoExporting) return;
      const boxes = (settingsRef.current.imageBoxes ?? []).filter(b => b.videoUrl);
      const vEls = boxes
        .map(b => ({ b, el: videoBoxElsRef.current.get(b.videoUrl!) }))
        .filter((x): x is { b: ImageBox; el: HTMLVideoElement } => !!x.el);
      // Animated charts make the slide a video even without video boxes (20s chart timeline).
      const animCharts = (settingsRef.current.chartBoxes ?? []).filter(c => c.animate && !c.hidden);
      if (vEls.length === 0 && animCharts.length === 0) { if (returnBlob) throw new Error('Slide has no loaded video to export'); return; }

      const abortController = new AbortController();
      videoExportAbortRef.current = abortController;
      const signal = abortController.signal;
      const emit = (progress: number, status: string) => {
        setVideoExportProgress(progress);
        setVideoExportStatus(status);
        onRecordingStateChangeRef.current?.({ isRecording: true, recProgress: progress, recStatus: status });
      };
      setIsVideoExporting(true);
      emit(0, 'Initializing...');
      setPlayingVideoUrl(null);          // stop preview playback during export
      vEls.forEach(x => x.el.pause());   // drive frames by seeking, not playback

      try {
        const mediabunny = await import('mediabunny');
        const { Output, Mp4OutputFormat, BufferTarget, VideoSample, VideoSampleSource,
                Input, BlobSource, ALL_FORMATS, QUALITY_HIGH, EncodedAudioPacketSource, EncodedPacketSink } = mediabunny;

        const EXPORT_FPS = 60, FRAME_DUR = 1 / EXPORT_FPS;
        const durations = vEls.map(x => (isFinite(x.el.duration) && x.el.duration > 0 ? x.el.duration : 0));
        // Longest video box — or the 20s chart-animation timeline — capped at 30s.
        const maxDur = Math.min(30, Math.max(0.1, ...durations, animCharts.length ? CHART_ANIM_TOTAL_MS / 1000 : 0));
        const totalFrames = Math.max(1, Math.floor(maxDur * EXPORT_FPS));
        const audioUrl = vEls.length > 0 ? (vEls[durations.indexOf(Math.max(...durations))]?.b.videoUrl ?? vEls[0].b.videoUrl!) : null;

        emit(0.05, 'Preparing output...');
        const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
        const videoSource = new VideoSampleSource({ codec: 'avc', bitrate: QUALITY_HIGH });
        output.addVideoTrack(videoSource);

        // Audio: copy the chosen box's AAC packets (no re-encode), clipped to the export length.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let audioSource: any = null; let audioPackets: any[] = []; let audioDecoderConfig: unknown = null;
        try {
          if (!audioUrl) throw new Error('no-audio-source');
          const resp = await fetch(audioUrl, { signal });
          if (resp.ok) {
            const ab = await resp.arrayBuffer();
            const input = new Input({ source: new BlobSource(new Blob([ab], { type: 'video/mp4' })), formats: ALL_FORMATS });
            const at = await input.getPrimaryAudioTrack();
            if (at) {
              audioDecoderConfig = await at.getDecoderConfig();
              audioSource = new EncodedAudioPacketSource('aac');
              output.addAudioTrack(audioSource);
              const sink = new EncodedPacketSink(at);
              for await (const p of sink.packets()) audioPackets.push(p);
              const first = audioPackets[0]?.timestamp || 0;
              for (const p of audioPackets) p.timestamp -= first;
              audioPackets = audioPackets.filter((p) => p.timestamp < maxDur);
            }
          }
        } catch (e) { if (!signal.aborted && (e as Error)?.message !== 'no-audio-source') console.warn('[video export] audio skipped:', e); }

        await output.start();
        const offscreen = new OffscreenCanvas(W, H);
        const seekTo = (el: HTMLVideoElement, t: number) => new Promise<void>(res => {
          if (Math.abs(el.currentTime - t) < 1e-3 && el.readyState >= 2) { res(); return; }
          let done = false;
          const finish = () => { if (done) return; done = true; el.removeEventListener('seeked', finish); res(); };
          el.addEventListener('seeked', finish);
          try { el.currentTime = t; } catch { finish(); }
          setTimeout(finish, 500);   // fallback so a missed 'seeked' can't stall the export
        });

        emit(0.1, 'Rendering frames...');
        for (let i = 0; i < totalFrames; i++) {
          if (signal.aborted) { await output.finalize(); throw new Error('Cancelled'); }
          const t = i * FRAME_DUR;
          await Promise.all(vEls.map((x, k) => seekTo(x.el, durations[k] > 0 ? (t % durations[k]) : 0)));
          if (animCharts.length) chartAnimTimeRef.current = (t * 1000) % CHART_ANIM_TOTAL_MS;
          drawCanvas(cachedImgRef.current, imgOffsetRef.current.x, imgOffsetRef.current.y, imgScaleRef.current, settingsRef.current, offscreen);
          const sample = new VideoSample(offscreen, { timestamp: t, duration: FRAME_DUR });
          await videoSource.add(sample);
          sample.close();
          emit(0.1 + (i / totalFrames) * 0.8, `Rendering frame ${i + 1}/${totalFrames}`);
        }

        if (audioSource && audioPackets.length > 0) {
          for (let i = 0; i < audioPackets.length; i++) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await audioSource.add(audioPackets[i], i === 0 ? { decoderConfig: audioDecoderConfig as any } : undefined);
          }
        }

        emit(0.95, 'Finalizing...');
        await output.finalize();
        const buffer = output.target.buffer;
        if (!buffer) throw new Error('No buffer received from output');
        const blob = new Blob([buffer], { type: 'video/mp4' });
        outBlob = blob;
        if (!returnBlob) {
          const url = URL.createObjectURL(blob);
          Object.assign(document.createElement('a'), { href: url, download: `video-${Date.now()}.mp4` }).click();
          URL.revokeObjectURL(url);
        }
        emit(1, 'Done!');
      } catch (error) {
        if (error instanceof Error && error.message !== 'Cancelled') {
          console.error('[video box export]', error);
          if (!returnBlob) {
            setVideoExportStatus(`Error: ${error.message}`);
            onRecordingStateChangeRef.current?.({ isRecording: false, recProgress: 0, recStatus: `Error: ${error.message}` });
            setTimeout(() => setVideoExportStatus(''), 3000);
          }
        }
        if (returnBlob) throw error;   // surface to the batch publisher
      } finally {
        setIsVideoExporting(false);
        setVideoExportProgress(0);
        setVideoExportStatus('');
        onRecordingStateChangeRef.current?.({ isRecording: false, recProgress: 0, recStatus: '' });
        videoExportAbortRef.current = null;
        vEls.forEach(x => { try { x.el.pause(); x.el.muted = true; x.el.currentTime = 0; } catch { /* ignore */ } });
        chartAnimTimeRef.current = null;   // hand the clock back to the preview loop
        redraw(cachedImgRef.current);   // restore the static first-frame view
      }
      return outBlob;   // defined only in returnBlob mode (Instagram publish); undefined for a normal download
    }
    startVideoBoxExportRef.current = startVideoBoxExport;

    useImperativeHandle(ref, () => ({
      selectElement(sel: SelectedElement | null) {
        if (sel == null)            { setSelectedTextBox(null); setSelectedImageBox(null); setSelectedChartBox(null); setMultiSel([]); }
        else if (sel.kind === 'text')  { setSelectedTextBox(sel.index); setSelectedImageBox(null); setSelectedChartBox(null); }
        else if (sel.kind === 'chart') { setSelectedChartBox(sel.index); setSelectedTextBox(null); setSelectedImageBox(null); }
        else                          { setSelectedImageBox(sel.index); setSelectedTextBox(null); setSelectedChartBox(null); }
      },
      // Place a pasted/uploaded image: fill an empty placeholder at the canvas centre, else drop a
      // new image box there (mirrors the drag-drop-onto-canvas handler). Powers ⌘/Ctrl+V paste in
      // the template editor, which has no image tray.
      pasteImageUrl(url: string) {
        if (!fillPlaceholderBoxAt(url, W / 2, H / 2)) addImageBox(url, W / 2, H / 2);
      },
      async downloadVideo() { await startVideoBoxExportRef.current(); },
      // ── Posts → Instagram publish ────────────────────────────────────────────
      // Render the active slide to a JPEG blob (returned, not downloaded). Mirrors the
      // non-video branch of startDownload but emits JPEG at native 1080×1350 (within IG's
      // image limits) and waits on in-flight subject cut-outs so split effects export.
      async renderImageBlob(): Promise<Blob> {
        chartAnimTimeRef.current = null;   // still images capture the chart's static final state
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        if (animFrameRef.current !== null) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
        if (imageBoxFgPromisesRef.current.size > 0) {
          await Promise.all([...imageBoxFgPromisesRef.current.values()]).catch(() => {});
        }
        drawCanvas(
          cachedImgRef.current,
          imgOffsetRef.current.x, imgOffsetRef.current.y, imgScaleRef.current,
          settingsRef.current,
          cv,
        );
        await new Promise(r => setTimeout(r, 30));
        return await new Promise<Blob>((resolve, reject) => {
          cv.toBlob(b => b ? resolve(b) : reject(new Error('Failed to render slide image')), 'image/jpeg', 0.92);
        });
      },
      // Render the slide at Download-PNG quality (4× hi-res PNG) and return the blob —
      // mirrors startDownload's still branch, minus the anchor click ("Export all" names it).
      async renderPngBlob(): Promise<Blob> {
        chartAnimTimeRef.current = null;   // still images capture the chart's static final state
        const EXPORT_SCALE = 4;
        const hiCanvas = document.createElement('canvas');
        hiCanvas.width = W * EXPORT_SCALE;
        hiCanvas.height = H * EXPORT_SCALE;
        if (animFrameRef.current !== null) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
        if (imageBoxFgPromisesRef.current.size > 0) {
          await Promise.all([...imageBoxFgPromisesRef.current.values()]).catch(() => {});
        }
        drawCanvas(
          cachedImgRef.current,
          imgOffsetRef.current.x, imgOffsetRef.current.y, imgScaleRef.current,
          settingsRef.current,
          hiCanvas,
        );
        await new Promise(r => setTimeout(r, 30));
        return await new Promise<Blob>((resolve, reject) => {
          hiCanvas.toBlob(b => b ? resolve(b) : reject(new Error('Failed to render slide PNG')), 'image/png');
        });
      },
      // Render a video slide to an .mp4 blob (returned, not downloaded) via the shared exporter.
      async renderVideoBlob(): Promise<Blob> {
        const blob = await startVideoBoxExportRef.current({ returnBlob: true });
        if (!blob) throw new Error('Video export produced no output (an export may already be running)');
        return blob;
      },
      // True once this slide's assets have finished loading: base image (if any), every image-box
      // image, and every video-box element (metadata + first frame). The batch publisher polls this
      // after switching slides so it never captures a half-loaded frame.
      isReadyForPublish(): boolean {
        if (imageSrc && !(cachedImgRef.current?.complete && cachedImgRef.current.naturalWidth > 0)) return false;
        if (imageBoxFgPromisesRef.current.size > 0) return false;
        const boxes = settingsRef.current.imageBoxes ?? [];
        const boxesReady = boxes.every(b => {
          if (b.videoUrl) {
            const el = videoBoxElsRef.current.get(b.videoUrl);
            return !!el && el.readyState >= 2 && isFinite(el.duration) && el.duration > 0;
          }
          if (!b.url) return true;   // empty image slot (unfilled placeholder) — nothing to load
          const img = imageBoxImgsRef.current.get(b.url);
          return !!img && img.complete && img.naturalWidth > 0;
        });
        if (!boxesReady) return false;
        // Chart release album-art (markers) — wait for each referenced image to load (failed loads
        // are evicted from the cache by onerror, so they don't wedge readiness; markers fall back).
        return (settingsRef.current.chartBoxes ?? []).every(cbx =>
          chartImageUrls(cbx).every(u => {
            const img = imageBoxImgsRef.current.get(u);
            return !img || (img.complete && img.naturalWidth > 0);
          }),
        );
      },
      async startDownload() {
        if (videoModeRef.current) {
          await startVideoExportRef.current();
          return;
        }
        const EXPORT_SCALE = 4;
        const hiCanvas = document.createElement('canvas');
        hiCanvas.width = W * EXPORT_SCALE;
        hiCanvas.height = H * EXPORT_SCALE;
        // Pause animation loop for stable frame capture in video mode
        if (animFrameRef.current !== null) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
        // Wait for any in-flight per-box subject cut-outs so split effects export reliably.
        if (imageBoxFgPromisesRef.current.size > 0) {
          await Promise.all([...imageBoxFgPromisesRef.current.values()]).catch(() => {});
        }
        drawCanvas(
          cachedImgRef.current,
          imgOffsetRef.current.x, imgOffsetRef.current.y, imgScaleRef.current,
          settingsRef.current,
          hiCanvas,
        );
        await new Promise(r => setTimeout(r, 30));
        hiCanvas.toBlob(blob => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = `carousel-${Date.now()}.png`; a.click();
          URL.revokeObjectURL(url);
        }, 'image/png');
      },
      zoomIn() {
        const n = Math.min(8, imgScaleRef.current * 1.25);
        imgScaleRef.current = n; setImgScale(n); onScaleChange?.(n); redraw(cachedImgRef.current);
      },
      zoomOut() {
        const n = Math.max(0.2, imgScaleRef.current / 1.25);
        imgScaleRef.current = n; setImgScale(n); onScaleChange?.(n); redraw(cachedImgRef.current);
      },
      setZoom(s: number) {
        const n = Math.max(0.2, Math.min(8, s));
        imgScaleRef.current = n; setImgScale(n); onScaleChange?.(n); redraw(cachedImgRef.current);
      },
      resetTransform() {
        imgOffsetRef.current  = { x: 0, y: 0 };
        imgScaleRef.current   = 1; setImgScale(1); onScaleChange?.(1);
        imgSrcCropRef.current = null;
        redraw(cachedImgRef.current);
      },
      cancelExport() { videoExportAbortRef.current?.abort(); },
      enterCropMode() { startCropMode(); },
      toggleSplit() { runBgRemovalRef.current('split'); },
      toggleBlur()  { runBgRemovalRef.current('blur');  },
      play()  { videoRef.current?.play(); },
      pause() { videoRef.current?.pause(); },
      seekTo(t: number) { if (videoRef.current) videoRef.current.currentTime = t; },
      setTrimRange(start: number, end: number) {
        trimStartRef.current = start;
        trimEndRef.current   = end;
      },
      resetTrim() {
        trimStartRef.current = 0;
        trimEndRef.current   = Infinity;
      },
      resetBox() {
        imgOffsetRef.current = { x: 0, y: 0 };
        imgScaleRef.current  = 1; setImgScale(1); onScaleChange?.(1);
        redraw(null);
      },
      centerBox() {
        imgOffsetRef.current = { x: 0, y: 0 };
        redraw(null);
      },
      getVideoElement() { return videoRef.current; },
      getTrimState() {
        const dur = videoRef.current?.duration ?? 0;
        return {
          trimStart: trimStartRef.current,
          trimEnd:   trimEndRef.current === Infinity ? dur : trimEndRef.current,
          duration:  dur,
        };
      },
      addOverlay(url: string) { addOverlay(url); },
      addLightLeak(color: string) { addLightLeak(color); },
      setSelectionWeight(weight: number) { applyTextWeight(weight); },
      toggleSelectionItalic() { richTextCmd('italic'); },
      setSelectionColor(color: string) { richTextCmd('foreColor', color); },
      toggleSelectionSecondary() { applySelectionSecondary(); },
    }), [redraw, onScaleChange, drawCanvas, addOverlay, addLightLeak, applyTextWeight, richTextCmd, applySelectionSecondary, imageSrc, fillPlaceholderBoxAt, addImageBox]);

    function startCropMode() {
      const img = cachedImgRef.current;
      if (!img) return;
      const savedCrop = imgSrcCropRef.current;

      // Save current state so Escape can restore it
      cropEntryStateRef.current = {
        crop: imgSrcCropRef.current,
        ox: imgOffsetRef.current.x,
        oy: imgOffsetRef.current.y,
        sc: imgScaleRef.current,
      };

      // Show full original image while in crop mode
      imgSrcCropRef.current = null;
      imgOffsetRef.current  = { x: 0, y: 0 };
      imgScaleRef.current   = 1;
      setImgScale(1);
      onScaleChange?.(1);
      redraw(img);

      // Position handles at the committed crop, or full canvas if none
      if (savedCrop) {
        const baseScale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
        const renderX   = (W - img.naturalWidth  * baseScale) / 2;
        const renderY   = (H - img.naturalHeight * baseScale) / 2;
        const px  = Math.max(0, (renderX + savedCrop.sx * baseScale) * DISPLAY_SCALE);
        const py  = Math.max(0, (renderY + savedCrop.sy * baseScale) * DISPLAY_SCALE);
        const pw  = Math.min(CAROUSEL_PREVIEW_W - px, savedCrop.sw * baseScale * DISPLAY_SCALE);
        const ph  = Math.min(CAROUSEL_PREVIEW_H - py, savedCrop.sh * baseScale * DISPLAY_SCALE);
        const nr  = { x: px, y: py, w: Math.max(10, pw), h: Math.max(10, ph) };
        cropRectRef.current = nr;
        setCropRect(nr);
      } else {
        const full = { x: 0, y: 0, w: CAROUSEL_PREVIEW_W, h: CAROUSEL_PREVIEW_H };
        cropRectRef.current = full;
        setCropRect(full);
      }
      setIsCropMode(true);
    }

    function applyCrop() {
      const img = cachedImgRef.current;
      if (!img) { setIsCropMode(false); return; }

      const r = cropRectRef.current;
      const cx = r.x / DISPLAY_SCALE;  // canvas pixels
      const cy = r.y / DISPLAY_SCALE;
      const cw = r.w / DISPLAY_SCALE;
      const ch = r.h / DISPLAY_SCALE;

      // Current image source region (natural px)
      const prev = imgSrcCropRef.current;
      const srcX = prev?.sx ?? 0;
      const srcY = prev?.sy ?? 0;
      const srcW = prev?.sw ?? img.naturalWidth;
      const srcH = prev?.sh ?? img.naturalHeight;

      // Current draw parameters
      const imgOx      = imgOffsetRef.current.x;
      const imgOy      = imgOffsetRef.current.y;
      const imgSc      = imgScaleRef.current;
      const coverBase  = Math.max(W / srcW, H / srcH);
      const effScale   = coverBase * imgSc;   // canvas-px per source-px
      const renderW    = srcW * effScale;
      const renderH    = srcH * effScale;
      const renderX    = (W - renderW) / 2 + imgOx;
      const renderY    = (H - renderH) / 2 + imgOy;

      // Map canvas crop rect → source image natural coords
      const rawL = srcX + (cx      - renderX) / renderW * srcW;
      const rawT = srcY + (cy      - renderY) / renderH * srcH;
      const rawR = srcX + (cx + cw - renderX) / renderW * srcW;
      const rawB = srcY + (cy + ch - renderY) / renderH * srcH;

      // Clamp to current source bounds
      const newSx = Math.max(srcX,        rawL);
      const newSy = Math.max(srcY,        rawT);
      const newSw = Math.max(1, Math.min(srcX + srcW, rawR) - newSx);
      const newSh = Math.max(1, Math.min(srcY + srcH, rawB) - newSy);

      // Adjust imgScale/imgOffset so the visual stays exactly the same
      // after the source dimensions change from (srcW×srcH) to (newSw×newSh).
      // New coverBase uses the new source dims; imgSc is scaled to compensate.
      const newCoverBase = Math.max(W / newSw, H / newSh);
      const newImgSc     = effScale / newCoverBase;
      // Offset shifts because the "center of the draw" moves when source dims change
      const newImgOx     = imgOx + effScale * ((newSw - srcW) / 2 + (newSx - srcX));
      const newImgOy     = imgOy + effScale * ((newSh - srcH) / 2 + (newSy - srcY));

      imgSrcCropRef.current     = { sx: newSx, sy: newSy, sw: newSw, sh: newSh };
      imgScaleRef.current       = newImgSc;
      imgOffsetRef.current      = { x: newImgOx, y: newImgOy };
      cropEntryStateRef.current = null;
      setImgScale(newImgSc);
      onScaleChange?.(newImgSc);

      const full = { x: 0, y: 0, w: CAROUSEL_PREVIEW_W, h: CAROUSEL_PREVIEW_H };
      cropRectRef.current = full;
      setCropRect(full);
      setCropLock('free');
      redraw(cachedImgRef.current);
      setIsCropMode(false);
    }

    // Dynamic overlay positions — mirror the canvas logo positions exactly
    const padXPv      = Math.round((32 + settings.contentPadding * 0.64) * DISPLAY_SCALE);
    const slotFwPv    = CAROUSEL_PREVIEW_W - 2 * padXPv;
    const aboveHLTop  = Math.max(0, blockTopPv - LOGO_PH - settings.aboveLogoGap);
    const subSlotTop  = CAROUSEL_PREVIEW_H - LOGO_PH - padXPv;
    const slotPosArr: React.CSSProperties[] = [
      { top: padXPv,     left: padXPv },
      { top: aboveHLTop, left: padXPv },
      { top: subSlotTop, left: padXPv },
    ];
    // Slot overlays (the tag/quote/divider/swipe/logo placement zones) are hidden —
    // text boxes are used for content instead, so the empty placeholder boxes never render.
    const showSlotOverlay = [false, false, false];

    // Selected box (text or image) + Alt held → spacing-measurement overlay (purely visual, not drawn to canvas)
    const measBox: { x: number; y: number; width: number; height: number } | null = !altHeld
      ? null
      : selectedTextBox !== null
        ? (() => { const tb = (settings.textBoxes ?? [])[selectedTextBox]; return tb ? { x: tb.x, y: tb.y, width: tb.width ?? 540, height: tb.height ?? 200 } : null; })()
        : selectedImageBox !== null
          ? (() => { const b = (settings.imageBoxes ?? [])[selectedImageBox]; return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null; })()
        : selectedChartBox !== null
          ? (() => { const c = (settings.chartBoxes ?? [])[selectedChartBox]; return c ? { x: c.x, y: c.y, width: c.width, height: c.height } : null; })()
          : null;

    const blurLayerActive = settings.bgBlurEnabled && !!fgMaskSrc;

    // Click priority = visual stacking: each element's frame gets a z-index from its index in the
    // unified bottom→top order, so clicking where layers overlap selects the TOP-most one. An image set
    // "behind the subject of" another is drawn inside that host (between its background and subject), so
    // for clicks it counts as ONE LAYER BELOW its host — re-rank it just under the host here.
    const imgById = new Map((settings.imageBoxes ?? []).map(b => [b.id, b]));
    const baseOrder = orderedLayerIds(settings.imageBoxes ?? [], settings.textBoxes ?? [], settings.layerOrderIds, !!(settings.showFade || settings.showTopFade), settings.chartBoxes ?? []);
    const baseIdx = new Map<string, number>();
    baseOrder.forEach((o, i) => baseIdx.set(o.id, i));
    const stackKey = (o: { kind: string; id: string }) => {
      const host = o.kind === 'image' ? imgById.get(o.id)?.behindSubjectOf : undefined;
      return (host && baseIdx.has(host)) ? (baseIdx.get(host)! - 0.5) : baseIdx.get(o.id)!;
    };
    const layerZ = new Map<string, number>();
    [...baseOrder].sort((a, b) => stackKey(a) - stackKey(b)).forEach((o, i) => layerZ.set(o.id, i));

    // Outline overlay specs — selection (blue) + element (dashed) outlines at NATIVE size, mapped to
    // screen coords for the fixed <body> layer (rendered below). Element px → screen via the wrapper rect.
    const outlineSpecs: { key: string; left: number; top: number; w: number; h: number; style: string }[] = [];
    if (overlayRect) {
      const sx = overlayRect.width / W, sy = overlayRect.height / H;
      const push = (key: string, x: number, y: number, w: number, h: number, style: string) =>
        outlineSpecs.push({ key, left: overlayRect.left + x * sx, top: overlayRect.top + y * sy, w: w * sx, h: h * sy, style });
      (settings.textBoxes ?? []).forEach((tb, idx) => {
        if (tb.hidden) return;
        const sel = selectedTextBox === idx || multiSel.some(m => m.kind === 'text' && m.id === tb.id);
        const style = sel ? `1px ${tb.locked ? 'dashed' : 'solid'} rgba(96,165,250,0.95)` : '';
        if (style) push('t' + tb.id, tb.x, tb.y, tb.width ?? 540, tb.height ?? 200, style);
      });
      (settings.imageBoxes ?? []).forEach((b, idx) => {
        if (b.hidden || b.isOverlay || b.id === expandPreviewBoxId) return;
        const sel = selectedImageBox === idx || multiSel.some(m => m.kind === 'image' && m.id === b.id);
        const style = sel ? `1px ${b.locked ? 'dashed' : 'solid'} rgba(96,165,250,0.95)` : '';
        if (style) push('i' + b.id, b.x, b.y, b.width, b.height, style);
      });
      (settings.chartBoxes ?? []).forEach((c, idx) => {
        if (c.hidden) return;
        const sel = selectedChartBox === idx || multiSel.some(m => m.kind === 'chart' && m.id === c.id);
        const style = sel ? `1px ${c.locked ? 'dashed' : 'solid'} rgba(96,165,250,0.95)` : '';
        if (style) push('c' + c.id, c.x, c.y, c.width, c.height, style);
      });
    }

    return (
      <>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      {/* Native-size outline layer — fixed & portaled to <body> so outlines extend past the canvas edge
          without ever becoming scrollable stage content (frames stay canvas-clamped for clicks). */}
      {outlineSpecs.length > 0 && typeof document !== 'undefined' && createPortal(
        <>{outlineSpecs.map(o => (
          <div key={o.key} style={{ position: 'fixed', left: o.left, top: o.top, width: o.w, height: o.h, outline: o.style, outlineOffset: -1, pointerEvents: 'none', zIndex: 25 }} />
        ))}</>,
        document.body,
      )}
      <div style={{ position: 'relative', flexShrink: 0 }}>
      {/* Element layers panel — floats just left of the canvas */}
      {!staticMode && !hideLayersPanel && (((settings.imageBoxes?.length ?? 0) + (settings.textBoxes?.length ?? 0) + (settings.chartBoxes?.length ?? 0)) > 0 || !!(!settings.fadeRemoved && (settings.showFade || settings.showTopFade))) && (
        <ElementLayersPanel
          imageBoxes={settings.imageBoxes ?? []}
          textBoxes={settings.textBoxes ?? []}
          chartBoxes={settings.chartBoxes ?? []}
          orderIds={settings.layerOrderIds}
          fadeEnabled={!!(!settings.fadeRemoved && (settings.showFade || settings.showTopFade))}
          fadeHidden={!!settings.fadeHidden}
          onToggleFadeHidden={() => onSettingsChange?.({ fadeHidden: !settings.fadeHidden })}
          fadeLocked={!!settings.fadeLocked}
          onToggleFadeLocked={() => onSettingsChange?.({ fadeLocked: !settings.fadeLocked })}
          selectedImageBox={selectedImageBox}
          selectedTextBox={selectedTextBox}
          selectedChartBox={selectedChartBox}
          onSelect={(kind, index) => {
            if (kind === 'image')      { setSelectedImageBox(index); setSelectedTextBox(null); setSelectedChartBox(null); }
            else if (kind === 'chart') { setSelectedChartBox(index); setSelectedImageBox(null); setSelectedTextBox(null); }
            else                       { setSelectedTextBox(index); setSelectedImageBox(null); setSelectedChartBox(null); }
          }}
          onReorder={ids => onSettingsChange?.({ layerOrderIds: ids })}
          onToggleHidden={(kind, index) => {
            if (kind === 'image') {
              const arr = [...(settings.imageBoxes ?? [])];
              if (arr[index]) { arr[index] = { ...arr[index], hidden: !arr[index].hidden }; onSettingsChange?.({ imageBoxes: arr }); }
            } else if (kind === 'chart') {
              const arr = [...(settings.chartBoxes ?? [])];
              if (arr[index]) { arr[index] = { ...arr[index], hidden: !arr[index].hidden }; onSettingsChange?.({ chartBoxes: arr }); }
            } else {
              const arr = [...(settings.textBoxes ?? [])];
              if (arr[index]) { arr[index] = { ...arr[index], hidden: !arr[index].hidden }; onSettingsChange?.({ textBoxes: arr }); }
            }
          }}
          onToggleLocked={(kind, index) => {
            if (kind === 'image') {
              const arr = [...(settings.imageBoxes ?? [])];
              if (arr[index]) { arr[index] = { ...arr[index], locked: !arr[index].locked }; onSettingsChange?.({ imageBoxes: arr }); }
            } else if (kind === 'chart') {
              const arr = [...(settings.chartBoxes ?? [])];
              if (arr[index]) { arr[index] = { ...arr[index], locked: !arr[index].locked }; onSettingsChange?.({ chartBoxes: arr }); }
            } else {
              const arr = [...(settings.textBoxes ?? [])];
              if (arr[index]) { arr[index] = { ...arr[index], locked: !arr[index].locked }; onSettingsChange?.({ textBoxes: arr }); }
            }
          }}
        />
      )}
      <div
        ref={wrapperRef}
        style={{
          // overflow:hidden so layer frames never spill past the canvas — that spill is what turned into
          // scrollable stage content and made the edges "break"/shift when scrolling. A full-canvas box's
          // outline is drawn just inside the edge (outlineOffset -1 on the frames) so it stays visible.
          width: CAROUSEL_PREVIEW_W, height: CAROUSEL_PREVIEW_H,
          position: 'relative', flexShrink: 0, overflow: 'hidden',
          cursor: (imageSrc || videoSrc) ? (isDragging ? 'grabbing' : 'grab') : 'default',
        }}
        onDragOver={e => {
          // Accept in-app element drags (images AND videos) and OS filesystem file drags. Without
          // preventDefault here the browser refuses the drop and onDrop never fires.
          if (e.dataTransfer.types.includes('application/carousel-element-type/image')
            || e.dataTransfer.types.includes('application/carousel-element-type/video')
            || e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={e => {
          // OS filesystem media-file drop → upload then place at the drop point: images via onUploadImage
          // (post-images) as image boxes, mp4 videos via onUploadVideo (post-videos) as video boxes.
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();   // never let the browser navigate to / open the dropped file
            const rect = wrapperRef.current?.getBoundingClientRect();
            if (!rect) return;
            const cx0 = (e.clientX - rect.left) / DISPLAY_SCALE;
            const cy0 = (e.clientY - rect.top)  / DISPLAY_SCALE;
            const all = Array.from(e.dataTransfer.files);
            const imgs = all.filter(f => f.type.startsWith('image/'));
            const vids = all.filter(f => f.type === 'video/mp4');
            const upImg = onUploadImageRef.current, upVid = onUploadVideoRef.current;
            if (upImg) imgs.forEach((file, i) => upImg(file, file.name).then(url => { if (!url) return; const px = cx0 + i * 24, py = cy0 + i * 24; if (!fillPlaceholderBoxAt(url, px, py)) addImageBox(url, px, py); }));
            if (upVid) vids.forEach((file, i) => upVid(file).then(url => { if (url) addVideoBox(url, cx0 + i * 24, cy0 + i * 24); }));
            return;
          }
          const isImg = e.dataTransfer.types.includes('application/carousel-element-type/image');
          const isVid = e.dataTransfer.types.includes('application/carousel-element-type/video');
          if (!isImg && !isVid) return;
          e.preventDefault();
          try {
            const d = JSON.parse(e.dataTransfer.getData('application/carousel-element')) as { type?: string; url?: string };
            if (!d.url) return;
            const rect = wrapperRef.current?.getBoundingClientRect();
            if (!rect) return;
            const cx = (e.clientX - rect.left) / DISPLAY_SCALE, cy = (e.clientY - rect.top) / DISPLAY_SCALE;
            if (d.type === 'video')      addVideoBox(d.url, cx, cy);
            else if (d.type === 'image') { if (!fillPlaceholderBoxAt(d.url, cx, cy)) addImageBox(d.url, cx, cy); }
          } catch { /* ignore malformed drops */ }
        }}
        onMouseDown={e => {
          setSelectedTextBox(null);
          setSelectedImageBox(null);
          setSelectedChartBox(null);
          setMultiSel([]);
          if (!imageSrc && !videoSrc) return;
          if ((e.target as Element).closest('[data-carousel-slot]')) return;
          if ((e.target as Element).closest('[data-crop-handle]')) return;
          e.preventDefault();
          dragStartRef.current = { mx: e.clientX, my: e.clientY, ox: imgOffsetRef.current.x, oy: imgOffsetRef.current.y };
          setIsDragging(true);
        }}
      >
        {/* Layers panel — left of canvas, only in blur-layer mode */}
        {!staticMode && blurLayerActive && (
          <LayersPanel
            layers={settings.layerOrder ?? ['background', 'circle', 'circle2', 'subject']}
            onChange={layers => onSettingsChange?.({ layerOrder: layers })}
          />
        )}

        <canvas
          ref={canvasRef} width={W} height={H}
          style={{
            width: CAROUSEL_PREVIEW_W, height: CAROUSEL_PREVIEW_H, display: 'block', pointerEvents: 'none',
            // Transparent canvas: a checkerboard shows through the canvas's transparent pixels (editor only —
            // it's a CSS background, not part of the exported bitmap).
            ...(settings.canvasTransparent ? {
              backgroundColor: '#ffffff',
              backgroundImage: 'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)',
              backgroundSize: '20px 20px',
              backgroundPosition: '0 0, 10px 10px',
            } : {}),
          }}
        />

        {/* Hidden video element — only mounted in video mode for frame capture */}
        {videoSrc && (
          <video key={videoSrc} ref={videoRef} src={videoSrc}
            style={{ display: 'none' }} autoPlay loop muted playsInline crossOrigin="anonymous"
            onLoadedData={() => redraw(null)}
          />
        )}

        {/* Interactive overlays — hidden in staticMode, and in cleanView (frames/guides/slots) for a clean preview */}
        {!staticMode && !cleanView && <>

        {/* Logo placeholder slots — overlay-only, not part of the canvas bitmap */}
        {Array.from({ length: 3 }, (_, i) => {
          if (!showSlotOverlay[i]) return null;
          const isOpen     = openSlot === i;
          const alignRight = false;
          const inputId    = `logo-${instanceId}-${i}`;

          const slotStyle: React.CSSProperties = {
            position: 'absolute',
            width:    slotFwPv,
            height:   LOGO_PH,
            zIndex:   isOpen ? 50 : 2,
            ...slotPosArr[i],
          };

          return (
            <div
              key={i}
              ref={el => { slotContainerRefs.current[i] = el; }}
              style={slotStyle}
              data-carousel-slot=""
              onDragOver={e => {
                e.preventDefault();
                setDragOverSlot(i);
                const isDiv = e.dataTransfer.types.includes('application/carousel-element-type/divider');
                setIsDividerDrag(isDiv);
                if (!isDiv) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const t = rect.width / 3;
                  setDragOverZone(x < t ? 'left' : x < t * 2 ? 'center' : 'right');
                }
              }}
              onDragEnter={e => {
                e.preventDefault();
                setDragOverSlot(i);
                setIsDividerDrag(e.dataTransfer.types.includes('application/carousel-element-type/divider'));
              }}
              onDragLeave={e => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverSlot(null);
                  setDragOverZone(null);
                  setIsDividerDrag(false);
                }
              }}
              onDrop={e => {
                e.preventDefault();
                setDragOverSlot(null);
                setDragOverZone(null);
                setIsDividerDrag(false);
                try {
                  const d: SidebarElementData = JSON.parse(e.dataTransfer.getData('application/carousel-element'));
                  if (d.type === 'tag' && d.text && d.style) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const t = rect.width / 3;
                    const zone: 'left' | 'center' | 'right' = x < t ? 'left' : x < t * 2 ? 'center' : 'right';
                    selectTagZone(i, zone, d.text, d.style);
                  } else if (d.type === 'logo') {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const t = rect.width / 3;
                    const zone: 'left' | 'center' | 'right' = x < t ? 'left' : x < t * 2 ? 'center' : 'right';
                    selectBrandLogoZone(i, zone);
                  }
                  else if (d.type === 'quote' && d.id) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const t = rect.width / 3;
                    const zone: 'left' | 'center' | 'right' = x < t ? 'left' : x < t * 2 ? 'center' : 'right';
                    selectQuoteZone(i, zone, d.id);
                  } else if (d.type === 'swipe' && d.swipeStyle) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const t = rect.width / 3;
                    const zone: 'left' | 'center' | 'right' = x < t ? 'left' : x < t * 2 ? 'center' : 'right';
                    selectSwipeZone(i, zone, d.swipeStyle);
                  }
                  else if (d.type === 'divider' && d.id) {
                    // Clear ALL slot content — divider overrides everything
                    const imgSlot = slotsRef.current[i];
                    if (imgSlot?.type === 'image') URL.revokeObjectURL(imgSlot.url);
                    logoImgsRef.current[i] = null;
                    subImgRefsArr.current[i] = null;
                    const nextSlots = [...slotsRef.current] as (SlotContent | null)[];
                    nextSlots[i] = null;
                    slotsRef.current = nextSlots;
                    setSlots(nextSlots);
                    const cur       = [...(settingsRef.current.dividerSlots   ?? Array(3).fill(null))];
                    const curSub    = [...(settingsRef.current.dividerSubSlots ?? Array(3).fill(null))] as (DividerSubSlotContent | null)[];
                    const curTag    = [...(settingsRef.current.tagSlots        ?? Array(6).fill(null))];
                    const curQuo    = [...(settingsRef.current.quoteSlots      ?? Array(6).fill(null))];
                    const curLogoRow = [...(settingsRef.current.logoRowSlots   ?? Array(3).fill(null))];
                    cur[i] = d.id; curSub[i] = null; curTag[i] = null; curQuo[i] = null; curLogoRow[i] = null;
                    settingsRef.current = { ...settingsRef.current, dividerSlots: cur, dividerSubSlots: curSub, tagSlots: curTag, quoteSlots: curQuo, logoRowSlots: curLogoRow };
                    onSettingsChange?.({ dividerSlots: cur, dividerSubSlots: curSub, tagSlots: curTag, quoteSlots: curQuo, logoRowSlots: curLogoRow });
                  }
                  onSlotDrop?.(i, d);
                } catch {}
              }}
            >
              {/* File input — always in DOM */}
              <input
                id={inputId}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => { handleLogoFile(i, e); setOpenSlot(null); }}
              />

              {/* Divider drag overlay — covers any existing content, always on top */}
              {dragOverSlot === i && isDividerDrag && (
                <div className="absolute inset-0 rounded ring-2 ring-inset ring-white/70 bg-white/10 animate-pulse pointer-events-none z-20" />
              )}

              {/* Slot content — divider takes full row; uploaded image takes full row; otherwise per-zone independent cells */}
              {(() => {
                const imgSlot     = slots[i];
                const dividerSlot = settings.dividerSlots?.[i] ?? null;

                const RemoveBtn = ({ onRemove }: { onRemove: () => void }) => (
                  <button onClick={onRemove}
                    className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-black/80 border border-label-quaternary text-label-secondary text-micro flex items-center justify-center hover:bg-danger/15 hover:border-danger transition-colors leading-none z-10"
                  >×</button>
                );

                // Divider — occupies the entire row
                if (dividerSlot) {
                  const cbounds = getSubZoneCanvasBounds(dividerSlot, 0, 0, slotFwPv / DISPLAY_SCALE, LOGO_PH / DISPLAY_SCALE);
                  const szB = cbounds ? {
                    x: Math.round(cbounds.x * DISPLAY_SCALE),
                    y: Math.round(cbounds.y * DISPLAY_SCALE),
                    w: Math.round(cbounds.w * DISPLAY_SCALE),
                    h: Math.round(cbounds.h * DISPLAY_SCALE),
                  } : null;
                  const subContent  = settings.dividerSubSlots?.[i] ?? null;
                  const isSubFilled = !!subContent || subSlotFilled[i];
                  const isSubOpen   = openSubSlot === i;
                  const subInputId = `logo-sub-${instanceId}-${i}`;
                  return (
                    <div className="relative w-full h-full overflow-visible">
                      <RemoveBtn onRemove={() => {
                        const cur = [...(settingsRef.current.dividerSlots ?? Array(3).fill(null))];
                        cur[i] = null;
                        const curSub = [...(settingsRef.current.dividerSubSlots ?? Array(3).fill(null))] as (DividerSubSlotContent | null)[];
                        curSub[i] = null;
                        onSettingsChange?.({ dividerSlots: cur, dividerSubSlots: curSub });
                      }} />
                      <input id={subInputId} type="file" accept="image/*" className="hidden"
                        onChange={e => { handleSubSlotFile(i, e); setOpenSubSlot(null); }} />
                      {szB && (
                        <button
                          ref={el => { subSlotBtnRefs.current[i] = el; }}
                          onClick={() => {
                            setOpenSlot(null);
                            setShowSubCustom(false);
                            if (openSubSlot === i) {
                              setOpenSubSlot(null);
                              setSubDropdownPos(null);
                            } else {
                              const btn = subSlotBtnRefs.current[i];
                              if (btn) {
                                const r = btn.getBoundingClientRect();
                                setSubDropdownPos({ x: r.left, y: r.bottom + 4 });
                              }
                              setOpenSubSlot(i);
                            }
                          }}
                          onDragOver={e => { e.preventDefault(); e.stopPropagation(); setSubDragOverSlot(i); }}
                          onDragEnter={e => { e.preventDefault(); e.stopPropagation(); setSubDragOverSlot(i); }}
                          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSubDragOverSlot(null); }}
                          onDrop={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            setSubDragOverSlot(null);
                            try {
                              const d: SidebarElementData = JSON.parse(e.dataTransfer.getData('application/carousel-element'));
                              if (d.type === 'tag' && d.text && d.style) selectSubTag(i, d.text, d.style);
                              else if (d.type === 'logo') selectSubBrandLogo(i);
                              else if (d.type === 'swipe' && d.swipeStyle) selectSubSwipe(i, d.swipeStyle);
                            } catch {}
                          }}
                          style={{ position: 'absolute', left: szB.x, top: szB.y, width: szB.w, height: szB.h }}
                          className={`rounded transition-all ${
                            subDragOverSlot === i
                              ? 'ring-2 ring-inset ring-white/70 bg-white/15'
                              : isSubOpen
                              ? 'ring-2 ring-inset ring-white/60 bg-white/10'
                              : isSubFilled
                              ? 'hover:ring-1 hover:ring-inset hover:ring-white/35 hover:bg-white/8'
                              : 'ring-1 ring-inset ring-dashed ring-white/25 hover:ring-white/50 hover:bg-white/10'
                          }`}
                        />
                      )}
                    </div>
                  );
                }

                // Uploaded image — occupies the entire row
                if (imgSlot) {
                  const OBJ_POS    = ['top left','top center','top right','bottom left','bottom center','bottom right'] as const;
                  const FLEX_ALIGN = ['flex-start','center','flex-end','flex-start','center','flex-end'] as const;
                  const FLEX_JUST  = ['flex-start','center','flex-end','flex-start','center','flex-end'] as const;
                  return (
                    <div
                      className="relative w-full h-full flex"
                      style={{ alignItems: FLEX_ALIGN[i % 3], justifyContent: FLEX_JUST[i % 3], flexDirection: i < 3 ? 'column' : 'column-reverse' }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imgSlot.url} alt="" className="w-full h-full object-contain" style={{ objectPosition: OBJ_POS[i], opacity: (settings.logoOpacity ?? 100) / 100 }} />
                      <button
                        onClick={() => removeSlot(i)}
                        className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-black/80 border border-label-quaternary text-label-secondary text-micro flex items-center justify-center hover:bg-danger/15 hover:border-danger transition-colors leading-none z-10"
                      >×</button>
                    </div>
                  );
                }

                // Per-zone independent cells — each zone can hold a tag, logo, or quote independently
                return (
                  <>
                    <div className="absolute inset-0 flex gap-px">
                      {ZONES.map((zone, zi) => {
                        const fi          = i * 3 + zi;
                        const zoneTag     = settings.tagZoneSlots?.[fi]   ?? null;
                        const zoneLogo    = settings.zoneLogoSlots?.[fi]  ?? false;
                        const zoneQuote   = settings.quoteZoneSlots?.[fi] ?? null;
                        // Legacy slots — shown in the zone that matches their saved alignment
                        const legTagAlign  = (settings.tagSlotAligns?.[i]  ?? 'center') as 'left'|'center'|'right';
                        const legLogoAlign = (settings.logoSlotAligns?.[i] ?? 'center') as 'left'|'center'|'right';
                        const legTag       = settings.tagSlots?.[i]   ?? null;
                        const legQuote     = settings.quoteSlots?.[i]  ?? null;
                        const hasLegTag    = !!legTag   && legTagAlign  === zone;
                        const hasLegLogo   = !!(settingsRef.current.logoSlotAligns?.[i]) && legLogoAlign === zone && logoImgsRef.current[i] != null;
                        const hasLegQuote  = !!legQuote && legLogoAlign === zone;
                        const zoneSwipe    = settings.swipeZoneSlots?.[fi] ?? null;
                        const hasFilled    = !!zoneTag || zoneLogo || !!zoneQuote || !!zoneSwipe || hasLegTag || hasLegLogo || hasLegQuote;

                        if (hasFilled) {
                          return (
                            <div key={zone} className="relative flex-1 h-full">
                              <button
                                onClick={() => {
                                  if (zoneTag || zoneLogo || zoneQuote || zoneSwipe) removeZoneSlot(i, zone);
                                  else removeSlot(i);
                                }}
                                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/80 border border-label-quaternary text-label-secondary text-micro flex items-center justify-center hover:bg-danger/15 hover:border-danger transition-colors leading-none z-10"
                              >×</button>
                            </div>
                          );
                        }

                        return (
                          <button
                            key={zone}
                            onClick={() => {
                              pendingSlotZoneRef.current = zone;
                              if (openSlot === i) {
                                setOpenSlot(null);
                                setSlotDropdownPos(null);
                              } else {
                                const container = slotContainerRefs.current[i];
                                if (container) {
                                  const r = container.getBoundingClientRect();
                                  setSlotDropdownPos({ x: r.left, y: r.bottom + 4 });
                                }
                                setOpenSlot(i);
                              }
                            }}
                            className={`flex-1 h-full rounded-sm transition-colors ${
                              dragOverSlot === i && !isDividerDrag && dragOverZone === zone
                                ? 'bg-white/25 ring-2 ring-inset ring-white/60'
                                : dragOverSlot === i && !isDividerDrag
                                ? 'bg-white/8 ring-1 ring-inset ring-white/20'
                                : isDraggingElement
                                ? 'bg-white/5 ring-1 ring-inset ring-white/15 pointer-events-none'
                                : 'hover:bg-white/8 hover:ring-1 hover:ring-inset hover:ring-white/20'
                            }`}
                          />
                        );
                      })}
                    </div>

                  </>
                );
              })()}
            </div>
          );
        })}

        {/* ── Rich text edit overlays ── */}
        {(() => {
          const headFontDef_ = resolveCarouselFont(settings.fontLabel);
          const subFontDef_  = resolveCarouselFont(settings.subFontLabel);
          const richW     = CAROUSEL_PREVIEW_W - 2 * padXPv;
          const headFsPv  = Math.round(settings.fontSize    * DISPLAY_SCALE);
          const subFsPv   = Math.round(settings.subFontSize * DISPLAY_SCALE);
          const headLhM   = 1.0 + (settings.lHeight    / 100) * 1.2;
          const subLhM    = 1.0 + (settings.subLHeight / 100) * 1.2;
          const headLsPv  = ((settings.lSpacing    / 100) * 20 * DISPLAY_SCALE).toFixed(2);
          const subLsPv   = ((settings.subLSpacing / 100) * 20 * DISPLAY_SCALE).toFixed(2);
          const headTopPv = blockTopPv;
          const subTopPv  = blockTopPv + headBlockHPv + gapPv;

          function saveSpans(el: HTMLElement, isHead: boolean) {
            const spans = htmlToSpans(el);
            const newText = spans.map(s => s.text).join('');
            const hasCustomStyle = spans.some(s => s.color || s.bold || s.italic);
            onSettingsChange?.(isHead
              ? { headlineSpans: hasCustomStyle ? spans : null }
              : { subSpans:      hasCustomStyle ? spans : null });
            if (isHead && newText !== headline)    onHeadlineChange?.(newText);
            if (!isHead && newText !== subheadline) onSubheadlineChange?.(newText);
          }

          const editStyle = (top: number, fs: number, fontFamily: string, fw: number | string, fi: boolean, lh: number, ls: string, align: CarouselTextAlign, minH: number): React.CSSProperties => ({
            position:     'absolute',
            top,
            left:         padXPv,
            width:        richW,
            minHeight:    Math.max(minH, headFsPv),
            fontSize:     fs,
            fontFamily,
            fontWeight:   fw,
            fontStyle:    fi ? 'italic' : 'normal',
            color:        '#ffffff',
            lineHeight:   lh,
            letterSpacing: `${ls}px`,
            textAlign:    align === 'justify' ? 'left' : align,
            background:   'rgba(255,255,255,0.05)',
            outline:      '1px dashed rgba(255,255,255,0.35)',
            outlineOffset: '3px',
            borderRadius: 2,
            whiteSpace:   'pre-wrap',
            wordBreak:    'break-word',
            caretColor:   '#fff',
            zIndex:       10,
            boxSizing:    'border-box',
            padding:      0,
          });

          return (
            <>
              {/* Click targets for entering rich text mode */}
              {!richEditTarget && headline.trim() && headBlockHPv > 0 && (
                <div
                  data-carousel-slot=""
                  title="Click to style text"
                  onClick={() => setRichEditTarget('headline')}
                  style={{
                    position: 'absolute',
                    top: headTopPv, left: padXPv,
                    width: richW, height: headBlockHPv,
                    cursor: 'text', zIndex: 4,
                  }}
                />
              )}
              {!richEditTarget && subheadline.trim() && subBlockHPv > 0 && (
                <div
                  data-carousel-slot=""
                  title="Click to style text"
                  onClick={() => setRichEditTarget('sub')}
                  style={{
                    position: 'absolute',
                    top: subTopPv, left: padXPv,
                    width: richW, height: subBlockHPv,
                    cursor: 'text', zIndex: 4,
                  }}
                />
              )}

              {/* ContentEditable for headline */}
              {richEditTarget === 'headline' && (
                <div
                  ref={richEditRef}
                  key="rich-head"
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  data-carousel-slot=""
                  style={editStyle(headTopPv, headFsPv, headFontDef_.css, settings.fontWeight, settings.italic, headLhM, headLsPv, settings.textAlign, headBlockHPv)}
                  onBlur={e => { saveSpans(e.currentTarget, true); setRichEditTarget(null); }}
                  onKeyDown={e => { if (e.key === 'Escape') setRichEditTarget(null); }}
                />
              )}

              {/* ContentEditable for subheadline */}
              {richEditTarget === 'sub' && (
                <div
                  ref={richEditRef}
                  key="rich-sub"
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  data-carousel-slot=""
                  style={editStyle(subTopPv, subFsPv, subFontDef_.css, settings.subFontWeight, settings.subItalic, subLhM, subLsPv, settings.subTextAlign, subBlockHPv)}
                  onBlur={e => { saveSpans(e.currentTarget, false); setRichEditTarget(null); }}
                  onKeyDown={e => { if (e.key === 'Escape') setRichEditTarget(null); }}
                />
              )}

              {/* Floating toolbar — shows when text is selected in contentEditable */}
              {toolbarPos && richEditTarget && (
                <div
                  data-carousel-slot=""
                  onMouseDown={e => e.preventDefault()}
                  style={{
                    position:     'absolute',
                    top:          Math.max(4, toolbarPos.top),
                    left:         toolbarPos.left,
                    zIndex:       20,
                    display:      'flex',
                    alignItems:   'center',
                    gap:          3,
                    padding:      '5px 7px',
                    background:   'color-mix(in srgb, var(--c-bg-1) 96%, transparent)',
                    border:       '1px solid var(--c-sep)',
                    borderRadius: 9,
                    backdropFilter: 'blur(10px)',
                    boxShadow:    'var(--sh-md)',
                  }}
                >
                  {/* Colour swatches */}
                  {RICH_COLORS.map(c => (
                    <button
                      key={c}
                      onMouseDown={e => { e.preventDefault(); document.execCommand('foreColor', false, c); }}
                      style={{
                        width: 13, height: 13, borderRadius: '50%',
                        background: c, border: '1px solid var(--c-sep)',
                        cursor: 'pointer', flexShrink: 0, padding: 0,
                      }}
                      title={c}
                    />
                  ))}
                  {/* Custom colour */}
                  <label
                    style={{ position: 'relative', width: 13, height: 13, cursor: 'pointer', flexShrink: 0 }}
                    title="Custom colour"
                    onMouseDown={() => {
                      const sel = window.getSelection();
                      if (sel && sel.rangeCount > 0 && richEditRef.current?.contains(sel.anchorNode)) {
                        savedSelRef.current = sel.getRangeAt(0).cloneRange();
                      }
                    }}
                  >
                    <div style={{
                      width: 13, height: 13, borderRadius: '50%',
                      background: 'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)',
                      border: '1px solid var(--c-sep)',
                      pointerEvents: 'none',
                    }} />
                    <input
                      type="color"
                      style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', padding: 0, border: 'none' }}
                      onChange={e => {
                        const hex = (e.target as HTMLInputElement).value;
                        const savedRange = savedSelRef.current;
                        savedSelRef.current = null;
                        if (!richEditRef.current || !savedRange) return;
                        richEditRef.current.focus();
                        setTimeout(() => {
                          const sel = window.getSelection();
                          sel?.removeAllRanges();
                          sel?.addRange(savedRange);
                          document.execCommand('foreColor', false, hex);
                        }, 0);
                      }}
                    />
                  </label>

                  {/* Separator */}
                  <div style={{ width: 1, height: 14, background: 'var(--c-sep)', margin: '0 2px' }} />

                  {/* Bold */}
                  <button
                    onMouseDown={e => { e.preventDefault(); document.execCommand('bold'); }}
                    style={{ width: 22, height: 22, background: 'none', border: 'none', color: 'var(--c-label-1)', fontWeight: 700, fontSize: 12, cursor: 'pointer', borderRadius: 4, padding: 0 }}
                    title="Bold"
                  >B</button>

                  {/* Italic */}
                  <button
                    onMouseDown={e => { e.preventDefault(); document.execCommand('italic'); }}
                    style={{ width: 22, height: 22, background: 'none', border: 'none', color: 'var(--c-label-1)', fontStyle: 'italic', fontSize: 12, cursor: 'pointer', borderRadius: 4, padding: 0 }}
                    title="Italic"
                  >I</button>

                  {/* Separator */}
                  <div style={{ width: 1, height: 14, background: 'var(--c-sep)', margin: '0 2px' }} />

                  {/* Clear formatting */}
                  <button
                    onMouseDown={e => { e.preventDefault(); document.execCommand('removeFormat'); }}
                    style={{ width: 22, height: 22, background: 'none', border: 'none', color: 'var(--c-label-3)', fontSize: 10, cursor: 'pointer', borderRadius: 4, padding: 0 }}
                    title="Clear formatting"
                  >✕</button>
                </div>
              )}
            </>
          );
        })()}

        {/* ── Circle placeholder (rectMode) — sits between top-3 and bottom-3 tag slots ── */}
        {/* ── Circle placeholders — hidden in video mode, and gated by layerOrder so      ── */}
        {/*    removing 'circle'/'circle2' from layer order also removes the upload slot   ── */}
        {!videoSrc && (rectMode ? [0] : [0, 1])
          .filter(ci => (settings.layerOrder ?? ['background', 'subject']).includes(ci === 0 ? 'circle' : 'circle2'))
          .map(ci => {
          const RECT_GAP    = 8;
          const _bandTop    = padXPv + LOGO_PH + RECT_GAP;
          const _bandBottom = aboveHLTop - RECT_GAP;
          const _bandH      = Math.max(0, _bandBottom - _bandTop);
          if (rectMode) {
            // Keep band ref in sync for canvas drawRect
            rectBandRef.current = { top: _bandTop, bottom: _bandBottom, left: padXPv, right: CAROUSEL_PREVIEW_W - padXPv };
          }
          const circleSrc       = circleSrcs[ci];
          const circlePos       = circlePoses[ci];
          const circleRadius    = circleRadii[ci];
          const circleElRef     = ci === 0 ? circleEl0Ref : circleEl1Ref;
          const circleInputRef  = ci === 0 ? circleInput0Ref : circleInput1Ref;
          const editMode        = circleImgEditModes[ci];
          const isImgDragging   = activeImgDragCircle === ci;
          const defaultX        = rectMode ? Math.round(CAROUSEL_PREVIEW_W / 2 + 50) : (ci === 0 ? Math.round(CAROUSEL_PREVIEW_W / 4) : Math.round(CAROUSEL_PREVIEW_W * 3 / 4));
          const defaultCy       = rectMode ? Math.round((_bandTop + _bandBottom) / 2) : (padXPv + LOGO_PH + aboveHLTop) / 2;
          const circleCxPv      = circlePos?.x ?? defaultX;
          const circleCyPv      = circlePos?.y ?? defaultCy;
          const r               = circleRadius;
          const d               = r * 2;
          const bw              = ci === 0 ? settings.circleBorderWidth   : settings.circle2BorderWidth;
          const bo              = ci === 0 ? settings.circleBorderOpacity : settings.circle2BorderOpacity;
          const bc              = ci === 0 ? settings.circleBorderColor   : settings.circle2BorderColor;
          const cssBW           = Math.max(1, Math.round(bw * DISPLAY_SCALE));
          const boxShadowVal    = (!blurLayerActive && circleSrc && bw > 0 && bo > 0)
            ? `0 0 0 ${cssBW}px ${hexToRgba(bc, bo / 100)}`
            : '';
          const handleOffset    = r * 0.707;
          return (
            <React.Fragment key={ci}>
              {/* Circle element */}
              <div
                ref={circleElRef}
                data-carousel-slot=""
                onMouseDown={e => {
                  if (!circleSrc) return;
                  e.preventDefault();
                  if (editMode) {
                    circleImgDragStart.current = { mx: e.clientX, my: e.clientY, ox: circleImgOffsetsArr.current[ci].x, oy: circleImgOffsetsArr.current[ci].y };
                    setActiveImgDragCircle(ci);
                    // Bind synchronously so the release is always caught (see note above the resize effects).
                    const onMove = (ev: MouseEvent) => {
                      const dx = ev.clientX - circleImgDragStart.current.mx;
                      const dy = ev.clientY - circleImgDragStart.current.my;
                      circleImgOffsetsArr.current[ci] = {
                        x: circleImgDragStart.current.ox + dx / DISPLAY_SCALE,
                        y: circleImgDragStart.current.oy + dy / DISPLAY_SCALE,
                      };
                      redraw(cachedImgRef.current);
                    };
                    const onUp = () => { setActiveImgDragCircle(null); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                    window.addEventListener('mousemove', onMove);
                    window.addEventListener('mouseup', onUp);
                  } else {
                    const cx = circlePosRefsArr.current[ci]?.x ?? defaultX;
                    const cy = circlePosRefsArr.current[ci]?.y ?? defaultCy;
                    circleDragStart.current = { mx: e.clientX, my: e.clientY, cx, cy };
                    setActiveDragCircle(ci);
                    const onMove = (ev: MouseEvent) => {
                      const dx = ev.clientX - circleDragStart.current.mx;
                      const dy = ev.clientY - circleDragStart.current.my;
                      const r = circleRadsArr.current[ci];
                      const newX = Math.max(r, Math.min(CAROUSEL_PREVIEW_W - r, circleDragStart.current.cx + dx));
                      const newY = Math.max(r, Math.min(CAROUSEL_PREVIEW_H - r, circleDragStart.current.cy + dy));
                      circlePosRefsArr.current[ci] = { x: newX, y: newY };
                      setCirclePoses(prev => { const n = [...prev]; n[ci] = { x: newX, y: newY }; return n; });
                      redraw(cachedImgRef.current);
                    };
                    const onUp = () => { setActiveDragCircle(null); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                    window.addEventListener('mousemove', onMove);
                    window.addEventListener('mouseup', onUp);
                  }
                }}
                style={{
                  position: 'absolute',
                  left: circleCxPv - r, top: circleCyPv - r,
                  width: d, height: d,
                  borderRadius: '50%',
                  zIndex: 3,
                  cursor: circleSrc ? (editMode ? (isImgDragging ? 'grabbing' : 'grab') : 'move') : 'default',
                  outline: circleSrc && (editMode || blurLayerActive) ? '2px dashed rgba(255,255,255,0.5)' : undefined,
                  outlineOffset: '3px',
                  ...(boxShadowVal ? { boxShadow: boxShadowVal } : {}),
                }}
              >
                {circleSrc ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={circleSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', borderRadius: '50%', pointerEvents: 'none', visibility: blurLayerActive ? 'hidden' : 'visible' }} />
                    {!editMode && (
                      <button
                        onMouseDown={e => e.stopPropagation()}
                        onClick={() => {
                          setCircleSrcs(prev => { const n = [...prev]; n[ci] = null; return n; });
                          circlePosRefsArr.current[ci]    = null;
                          setCirclePoses(prev => { const n = [...prev]; n[ci] = null; return n; });
                          circleRadsArr.current[ci]        = 90;
                          setCircleRadii(prev => { const n = [...prev]; n[ci] = 90; return n; });
                          circleImgOffsetsArr.current[ci]  = { x: 0, y: 0 };
                          circleImgScalesArr.current[ci]   = 1;
                        }}
                        className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/80 border border-label-quaternary text-label-secondary text-micro flex items-center justify-center hover:bg-danger/15 hover:border-danger transition-colors leading-none z-10"
                      >×</button>
                    )}
                  </>
                ) : (
                  <button
                    onMouseDown={e => e.stopPropagation()}
                    onClick={() => circleInputRef.current?.click()}
                    className="group w-full h-full flex items-center justify-center transition-colors text-label/40 hover:text-label/70 relative"
                  >
                    <svg width={d} height={d} className="absolute inset-0" style={{ pointerEvents: 'none' }}>
                      <circle
                        cx={r} cy={r} r={r - 0.5}
                        fill="rgba(255,255,255,0.10)" strokeWidth="1" strokeDasharray="3 3"
                        className="stroke-white/40 group-hover:stroke-white/70 transition-colors"
                      />
                    </svg>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="12" y1="5" x2="12" y2="19"/>
                      <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                  </button>
                )}
              </div>

              {/* Edit / Done toolbar */}
              {circleSrc && (
                <div data-carousel-slot="" style={{ position: 'absolute', left: circleCxPv, top: circleCyPv + r + 5, transform: 'translateX(-50%)', display: 'flex', gap: 3, zIndex: 10 }}>
                  {editMode ? (
                    <button onMouseDown={e => e.stopPropagation()} onClick={() => setCircleImgEditModes(prev => { const n=[...prev]; n[ci]=false; return n; })}
                      style={{ padding: '2px 9px', background: '#fff', border: 'none', borderRadius: 4, color: '#000', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>Done</button>
                  ) : (
                    <button onMouseDown={e => e.stopPropagation()} onClick={() => setCircleImgEditModes(prev => { const n=[...prev]; n[ci]=true; return n; })}
                      style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '2px 6px', background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.22)', borderRadius: 4, color: 'rgba(255,255,255,0.8)', fontSize: 9, cursor: 'pointer' }}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/>
                        <line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>
                      </svg>
                      Edit
                    </button>
                  )}
                </div>
              )}

              {/* Resize handle SE */}
              {circleSrc && !editMode && (
                <div data-carousel-slot="" onMouseDown={e => {
                  e.stopPropagation(); e.preventDefault();
                  const cx = circlePosRefsArr.current[ci]?.x ?? defaultX;
                  const cy = circlePosRefsArr.current[ci]?.y ?? defaultCy;
                  circleResizeStart.current = { cx, cy };
                  setActiveResizeCircle(ci);
                  const onMove = (ev: MouseEvent) => {
                    const bounds = wrapperRef.current?.getBoundingClientRect();
                    if (!bounds) return;
                    const mx = ev.clientX - bounds.left;
                    const my = ev.clientY - bounds.top;
                    const s = circleResizeStart.current;
                    const dist = Math.sqrt((mx - s.cx) ** 2 + (my - s.cy) ** 2);
                    const maxR = Math.min(CAROUSEL_PREVIEW_W, CAROUSEL_PREVIEW_H) / 2;
                    const newR = Math.max(20, Math.min(maxR, Math.round(dist)));
                    circleRadsArr.current[ci] = newR;
                    setCircleRadii(prev => { const n = [...prev]; n[ci] = newR; return n; });
                    redraw(cachedImgRef.current);
                  };
                  const onUp = () => { setActiveResizeCircle(null); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                  window.addEventListener('mousemove', onMove);
                  window.addEventListener('mouseup', onUp);
                }} title="Drag to resize"
                  style={{ position: 'absolute', left: circleCxPv + handleOffset - 5, top: circleCyPv + handleOffset - 5, width: 10, height: 10, background: '#fff', border: '1.5px solid rgba(0,0,0,0.4)', borderRadius: 3, cursor: 'nwse-resize', zIndex: 10 }}
                />
              )}

              {/* Zoom handle SW */}
              {circleSrc && !editMode && (
                <div data-carousel-slot="" onMouseDown={e => {
                  e.stopPropagation(); e.preventDefault();
                  circleZoomDragStart.current = { my: e.clientY, scale: circleImgScalesArr.current[ci] };
                  setActiveZoomDragCircle(ci);
                  const onMove = (ev: MouseEvent) => {
                    const dy = ev.clientY - circleZoomDragStart.current.my;
                    const newScale = Math.max(0.5, Math.min(10, circleZoomDragStart.current.scale * Math.exp(-dy / 80)));
                    circleImgScalesArr.current[ci] = newScale;
                    redraw(cachedImgRef.current);
                  };
                  const onUp = () => { setActiveZoomDragCircle(null); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                  window.addEventListener('mousemove', onMove);
                  window.addEventListener('mouseup', onUp);
                }} title="Drag up to zoom in, down to zoom out"
                  style={{ position: 'absolute', left: circleCxPv - handleOffset - 5, top: circleCyPv + handleOffset - 5, width: 10, height: 10, background: '#a3e635', border: '1.5px solid rgba(0,0,0,0.4)', borderRadius: 3, cursor: 'ns-resize', zIndex: 10 }}
                />
              )}

              {/* Hidden file input */}
              <input ref={circleInputRef} type="file" accept="image/*" className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  // Lock circle to placeholder position on first upload so canvas and HTML overlay are in sync
                  if (!circlePosRefsArr.current[ci]) {
                    const pos = { x: defaultX, y: Math.round(defaultCy) };
                    circlePosRefsArr.current[ci] = pos;
                    setCirclePoses(prev => { const n=[...prev]; n[ci]=pos; return n; });
                  }
                  circleImgOffsetsArr.current[ci] = { x: 0, y: 0 };
                  circleImgScalesArr.current[ci]  = 1;
                  setCircleImgEditModes(prev => { const n=[...prev]; n[ci]=false; return n; });
                  setCircleSrcs(prev => { const n=[...prev]; n[ci]=URL.createObjectURL(f); return n; });
                  e.target.value = '';
                }}
              />
            </React.Fragment>
          );
        })}

        {/* ── Free text box frames (select to move/resize; the text itself is on the canvas) ── */}
        {(settings.textBoxes ?? []).map((tb, idx) => {
          const isActive   = activeDragTextBox === idx;
          const isSelected = selectedTextBox === idx;
          const inMulti    = multiSel.some(m => m.kind === 'text' && m.id === tb.id);
          if (tb.hidden) return null;
          const locked = !!tb.locked;
          // Posts mode: the template froze this box's geometry. Unlike `locked` the box stays
          // selectable + double-click-editable — only USER move/resize is blocked.
          const geomLocked = enforceLocks && hasGeometryLock(tb);
          const bw = tb.width  ?? 540;
          const bh = tb.height ?? 200;
          const HANDLES: { id: string; pos: React.CSSProperties; cur: string }[] = [
            { id: 'nw', pos: { top: -4, left: -4 },                       cur: 'nwse-resize' },
            { id: 'n',  pos: { top: -4, left: '50%', marginLeft: -4 },     cur: 'ns-resize'   },
            { id: 'ne', pos: { top: -4, right: -4 },                      cur: 'nesw-resize' },
            { id: 'e',  pos: { top: '50%', right: -4, marginTop: -4 },     cur: 'ew-resize'   },
            { id: 'se', pos: { bottom: -4, right: -4 },                   cur: 'nwse-resize' },
            { id: 's',  pos: { bottom: -4, left: '50%', marginLeft: -4 },  cur: 'ns-resize'   },
            { id: 'sw', pos: { bottom: -4, left: -4 },                    cur: 'nesw-resize' },
            { id: 'w',  pos: { top: '50%', left: -4, marginTop: -4 },      cur: 'ew-resize'   },
          ];
          // Fit-to-width: height is automatic, so only the left/right (width) handles are offered.
          const resizeHandles = tb.fitToWidth ? HANDLES.filter(h => h.id === 'e' || h.id === 'w') : HANDLES;
          return (
            <div
              key={tb.id}
              data-carousel-slot=""
              onMouseDown={e => {
                const wr = wrapperRef.current?.getBoundingClientRect();
                if (wr && (e.clientX < wr.left || e.clientX > wr.right || e.clientY < wr.top || e.clientY > wr.bottom)) {
                  e.stopPropagation();   // click on this frame's off-canvas overflow → treat as empty stage
                  setSelectedTextBox(null); setSelectedImageBox(null); setMultiSel([]);
                  return;
                }
                e.stopPropagation();
                e.preventDefault();
                if (editingTextBox === idx) return;   // editing this box — let the editor handle clicks
                setSelectedTextBox(idx);
                setSelectedImageBox(null);
                if (geomLocked) return;   // geometry locked by the template (posts): select, don't drag
                textBoxDragStart.current = { mx: e.clientX, my: e.clientY, x: tb.x, y: tb.y };
                setActiveDragTextBox(idx);
                // Bind synchronously so the box releases on mouse-up (see note above the image-box effects).
                const SNAP = 12, EDGE = 60;
                const onMove = (ev: MouseEvent) => {
                  const box = settingsRef.current.textBoxes?.[idx];
                  const bw2 = box?.width ?? 540, bh2 = box?.height ?? 200;
                  const dxPx = (ev.clientX - textBoxDragStart.current.mx) / DISPLAY_SCALE;
                  const dyPx = (ev.clientY - textBoxDragStart.current.my) / DISPLAY_SCALE;
                  let nx = Math.max(-bw2, Math.min(W, Math.round(textBoxDragStart.current.x + dxPx)));
                  let ny = Math.max(-bh2, Math.min(H, Math.round(textBoxDragStart.current.y + dyPx)));
                  const xT = [[0, 0], [EDGE, EDGE], [Math.round(W / 2 - bw2 / 2), Math.round(W / 2)], [W - EDGE - bw2, W - EDGE], [W - bw2, W]];
                  const yT = [[0, 0], [EDGE, EDGE], [Math.round(H / 2 - bh2 / 2), Math.round(H / 2)], [H - EDGE - bh2, H - EDGE], [H - bh2, H]];
                  let gx: number | null = null, gy: number | null = null;
                  for (const [tx, g] of xT) { if (Math.abs(nx - tx) <= SNAP) { nx = tx; gx = g; break; } }
                  for (const [ty, g] of yT) { if (Math.abs(ny - ty) <= SNAP) { ny = ty; gy = g; break; } }
                  setSnapGuideX(gx); setSnapGuideY(gy);
                  const cur = [...(settingsRef.current.textBoxes ?? [])];
                  if (!cur[idx]) return;
                  cur[idx] = { ...cur[idx], x: nx, y: ny };
                  settingsRef.current = { ...settingsRef.current, textBoxes: cur };
                  onSettingsChange?.({ textBoxes: cur });
                  redraw(cachedImgRef.current);
                };
                const onUp = () => { setActiveDragTextBox(null); setSnapGuideX(null); setSnapGuideY(null); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              }}
              onDoubleClick={e => {
                e.stopPropagation();
                if (locked) return;
                setSelectedTextBox(idx);
                setSelectedImageBox(null);
                setEditingTextBox(idx);
              }}
              style={{
                position: 'absolute',
                left:   tb.x * DISPLAY_SCALE,
                top:    tb.y * DISPLAY_SCALE,
                width:  bw * DISPLAY_SCALE,
                height: bh * DISPLAY_SCALE,
                cursor: isActive ? 'grabbing' : geomLocked ? 'default' : 'grab',
                userSelect: 'none',
                pointerEvents: locked ? 'none' : undefined,
                outline: (isSelected || inMulti) ? `1px ${locked || geomLocked ? 'dashed' : 'solid'} rgba(96,165,250,0.95)` : 'none',
                outlineOffset: -1,   // inside the frame so a full-canvas box's outline isn't clipped at the canvas edge
                zIndex:  6 + (layerZ.get(tb.id) ?? 0),   // follow visual stacking so the top layer wins clicks
              }}
            >
              {/* Geometry locked by the template (posts): tiny lock glyph on the selection frame */}
              {isSelected && geomLocked && (
                <div
                  title="Position and size are locked by the template"
                  style={{
                    position: 'absolute', top: -9, right: -9, width: 18, height: 18,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(96,165,250,0.95)', borderRadius: 4, color: '#fff', zIndex: 10,
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
              )}
              {isSelected && !locked && !geomLocked && resizeHandles.map(h => (
                <div
                  key={h.id}
                  onMouseDown={e => {
                    e.stopPropagation();
                    e.preventDefault();
                    textBoxResizeStart.current = { handle: h.id, mx: e.clientX, my: e.clientY, x: tb.x, y: tb.y, w: bw, h: bh };
                    setActiveResizeTextBox(idx);
                    const MIN = 30;
                    const onMove = (ev: MouseEvent) => {
                      const s0 = textBoxResizeStart.current;
                      const dx = Math.round((ev.clientX - s0.mx) / DISPLAY_SCALE);
                      const dy = Math.round((ev.clientY - s0.my) / DISPLAY_SCALE);
                      const hasE = s0.handle.includes('e'), hasW = s0.handle.includes('w');
                      const hasS = s0.handle.includes('s'), hasN = s0.handle.includes('n');
                      let w = s0.w + (hasE ? dx : hasW ? -dx : 0);
                      let h = s0.h + (hasS ? dy : hasN ? -dy : 0);
                      let gx: number | null = null, gy: number | null = null;
                      if (ev.shiftKey && (hasE || hasW) && (hasS || hasN) && s0.w > 0 && s0.h > 0) {
                        let scale = Math.abs(w / s0.w - 1) >= Math.abs(h / s0.h - 1) ? w / s0.w : h / s0.h;
                        scale = Math.max(scale, MIN / s0.w, MIN / s0.h);
                        w = Math.round(s0.w * scale);
                        h = Math.round(s0.h * scale);
                      } else {
                        if (hasE)      { const g = nearestGuide(s0.x + w, X_GUIDES);          if (g !== null && g - s0.x >= MIN) { w = g - s0.x; gx = g; } }
                        else if (hasW) { const g = nearestGuide(s0.x + s0.w - w, X_GUIDES);   if (g !== null && s0.x + s0.w - g >= MIN) { w = s0.x + s0.w - g; gx = g; } }
                        if (hasS)      { const g = nearestGuide(s0.y + h, yGuidesRef.current);          if (g !== null && g - s0.y >= MIN) { h = g - s0.y; gy = g; } }
                        else if (hasN) { const g = nearestGuide(s0.y + s0.h - h, yGuidesRef.current);   if (g !== null && s0.y + s0.h - g >= MIN) { h = s0.y + s0.h - g; gy = g; } }
                        w = Math.max(MIN, w);
                        h = Math.max(MIN, h);
                      }
                      // No 0-clamp on x/y: allow resizing past the left/top edge (matches image boxes / off-edge drag).
                      const x = hasW ? s0.x + s0.w - w : s0.x;
                      const y = hasN ? s0.y + s0.h - h : s0.y;
                      setSnapGuideX(gx); setSnapGuideY(gy);
                      const cur = [...(settingsRef.current.textBoxes ?? [])];
                      if (!cur[idx]) return;
                      // Fit-to-width: only width (and the left-edge x) is user-set; height and the
                      // vAlign-anchored y are owned by the auto-height sync, so don't fight them here.
                      cur[idx] = tb.fitToWidth
                        ? { ...cur[idx], x, width: w }
                        : { ...cur[idx], x, y, width: w, height: h };
                      settingsRef.current = { ...settingsRef.current, textBoxes: cur };
                      onSettingsChange?.({ textBoxes: cur });
                      redraw(cachedImgRef.current);
                    };
                    const onUp = () => { setActiveResizeTextBox(null); setSnapGuideX(null); setSnapGuideY(null); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                    window.addEventListener('mousemove', onMove);
                    window.addEventListener('mouseup', onUp);
                  }}
                  style={{
                    position: 'absolute',
                    ...h.pos,
                    width: 8, height: 8,
                    background: '#fff',
                    border: '1px solid rgba(96,165,250,0.95)',
                    borderRadius: 1,
                    cursor: h.cur,
                    zIndex: 10,
                  }}
                />
              ))}
            </div>
          );
        })}

        {/* ── Inline text-box editor (double-click a text box to type into it) ── */}
        {editingTextBox != null && (settings.textBoxes ?? [])[editingTextBox] && (() => {
          const tb = (settings.textBoxes ?? [])[editingTextBox];
          const tbFont = resolveCarouselFont(tb.fontLabel);
          const va = tb.vAlign ?? 'top';
          return (
            // Outer wrapper owns position + vertical alignment (flex column). The contentEditable itself
            // must stay a normal block so styled runs flow inline and wrap like the canvas render — a flex
            // contentEditable would make every <span> its own column item and stack each run on its own line.
            <div
              onMouseDown={e => { e.stopPropagation(); if (e.target === e.currentTarget) { e.preventDefault(); editTextRef.current?.focus(); } }}
              style={{
                position: 'absolute',
                left:   tb.x * DISPLAY_SCALE,
                top:    tb.y * DISPLAY_SCALE,
                width:  (tb.width  ?? 540) * DISPLAY_SCALE,
                height: (tb.height ?? 200) * DISPLAY_SCALE,
                display: 'flex', flexDirection: 'column',
                justifyContent: va === 'middle' ? 'center' : va === 'bottom' ? 'flex-end' : 'flex-start',
                overflow: 'hidden',
                outline: '1px solid rgba(96,165,250,0.95)',
                cursor: 'text', zIndex: 1000,   // always above the per-layer frame band (frames start at 6)
              }}
            >
              <div
                ref={editTextRef}
                contentEditable
                suppressContentEditableWarning
                data-carousel-slot=""
                onInput={handleInlineEditorInput}
                onCompositionEnd={handleInlineEditorCompositionEnd}
                onBlur={() => setEditingTextBox(null)}
                onKeyDown={e => {
                  if (e.key === 'Escape') { e.preventDefault(); (e.currentTarget as HTMLDivElement).blur(); }
                  // Hard single line: Enter never lands (beforeinput also blocks insertParagraph/insertLineBreak)
                  else if (e.key === 'Enter' && singleLineTbUnderEdit()) e.preventDefault();
                }}
                style={{
                  width: '100%',
                  fontFamily: tbFont.css,
                  fontSize:   tb.fontSize * DISPLAY_SCALE,
                  fontWeight: tb.fontWeight,
                  fontStyle:  tb.italic ? 'italic' : 'normal',
                  lineHeight: `${tb.fontSize * (1.0 + ((tb.lineHeight ?? 15) / 100) * 1.2) * DISPLAY_SCALE}px`,
                  letterSpacing: `${(tb.letterSpacing ?? 0) * DISPLAY_SCALE}px`,
                  color: tb.color ?? '#ffffff',
                  textAlign: tb.align,
                  textAlignLast: tb.align === 'justify' ? 'center' : 'auto',   // match canvas: justify's last line is centred
                  textTransform: tb.allCaps ? '' : 'none',
                  opacity: (tb.opacity ?? 100) / 100,
                  // Hard single-line boxes never wrap in the editor either (input wider than the box is
                  // refused, so 'pre' only matters for legacy overflowing text — it stays one line).
                  whiteSpace: tb.singleLine && !tb.fitToWidth ? 'pre' : 'pre-wrap',
                  wordBreak:  tb.singleLine && !tb.fitToWidth ? 'normal' : 'break-word',
                  outline: 'none',
                }}
              />
            </div>
          );
        })()}

        {/* ── Image box frames (drag to move, handles to resize, × / Delete to remove) ── */}
        {(settings.imageBoxes ?? []).map((b, idx) => {
          const isActive   = activeDragImageBox === idx;
          const inMulti    = multiSel.some(m => m.kind === 'image' && m.id === b.id);
          // Overlays are full-canvas; a clickable frame would cover the whole canvas and block selecting
          // anything beneath, so they get no canvas frame — select/configure them via the Layers panel.
          if (b.hidden || b.isOverlay) return null;
          // Posts: elements with NO editable surface — placeholder slots (their island never exists
          // in posts; drop/paste fill is coordinate-based, not click-based) and fully-locked images —
          // are not interactive elements at all: click-through, never selected, no frame/badge.
          const inertInPosts = enforceLocks && (!!b.placeholder || hasFullImageLock(b));
          const isSelected = selectedImageBox === idx && !inertInPosts;
          const locked = !!b.locked || inertInPosts;
          // Posts mode: the template froze this box's geometry. Unlike `locked` the box stays
          // selectable (and a placeholder stays fillable) — only USER move/resize/crop is blocked.
          const geomLocked = enforceLocks && hasGeometryLock(b);
          const perspEditing = isSelected && b.id === perspectiveBoxId && !locked && !geomLocked;   // show the 4 corner handles
          const pp = b.perspective ?? IDENTITY_PERSPECTIVE;
          // Fractional anchor (fx,fy) within the box for each handle. The handles render in a <body>
          // portal at screen coords (below) so they stay visible/grabbable past the canvas edge.
          const HANDLES: { id: string; fx: number; fy: number; cur: string }[] = [
            { id: 'nw', fx: 0,   fy: 0,   cur: 'nwse-resize' },
            { id: 'n',  fx: 0.5, fy: 0,   cur: 'ns-resize'   },
            { id: 'ne', fx: 1,   fy: 0,   cur: 'nesw-resize' },
            { id: 'e',  fx: 1,   fy: 0.5, cur: 'ew-resize'   },
            { id: 'se', fx: 1,   fy: 1,   cur: 'nwse-resize' },
            { id: 's',  fx: 0.5, fy: 1,   cur: 'ns-resize'   },
            { id: 'sw', fx: 0,   fy: 1,   cur: 'nesw-resize' },
            { id: 'w',  fx: 0,   fy: 0.5, cur: 'ew-resize'   },
          ];
          return (
            <div
              key={b.id}
              data-carousel-slot=""
              onMouseDown={e => {
                const wr = wrapperRef.current?.getBoundingClientRect();
                if (wr && (e.clientX < wr.left || e.clientX > wr.right || e.clientY < wr.top || e.clientY > wr.bottom)) {
                  e.stopPropagation();   // click on this frame's off-canvas overflow → treat as empty stage
                  setSelectedImageBox(null); setSelectedTextBox(null); setMultiSel([]);
                  return;
                }
                e.stopPropagation();
                e.preventDefault();
                setSelectedImageBox(idx);
                setSelectedTextBox(null);
                if (geomLocked) return;   // geometry locked by the template (posts): select, don't drag
                imageBoxDragStart.current = { mx: e.clientX, my: e.clientY, x: b.x, y: b.y };
                setActiveDragImageBox(idx);
                // Bind the drag listeners SYNCHRONOUSLY (not via a setActiveDragImageBox-keyed
                // effect, which would bind a render late and drop a quick release) so the box is
                // dragged only while the button is held and is released the instant it goes up.
                const SNAP = 12, EDGE = 60;
                const onMove = (ev: MouseEvent) => {
                  const box = settingsRef.current.imageBoxes?.[idx];
                  if (!box) return;
                  const bw = box.width, bh = box.height;
                  const dxPx = (ev.clientX - imageBoxDragStart.current.mx) / DISPLAY_SCALE;
                  const dyPx = (ev.clientY - imageBoxDragStart.current.my) / DISPLAY_SCALE;
                  // Allow dragging off ANY edge: top-left may go to -boxSize (fully off left/top)
                  // just as it may reach W/H (fully off right/bottom).
                  let nx = Math.max(-bw, Math.min(W, Math.round(imageBoxDragStart.current.x + dxPx)));
                  let ny = Math.max(-bh, Math.min(H, Math.round(imageBoxDragStart.current.y + dyPx)));
                  // Snap targets per axis: canvas edge (0), margin inset, centre, far margin, far edge.
                  const xT = [[0, 0], [EDGE, EDGE], [Math.round(W / 2 - bw / 2), Math.round(W / 2)], [W - EDGE - bw, W - EDGE], [W - bw, W]];
                  const yT = [[0, 0], [EDGE, EDGE], [Math.round(H / 2 - bh / 2), Math.round(H / 2)], [H - EDGE - bh, H - EDGE], [H - bh, H]];
                  let gx: number | null = null, gy: number | null = null;
                  for (const [tx, g] of xT) { if (Math.abs(nx - tx) <= SNAP) { nx = tx; gx = g; break; } }
                  for (const [ty, g] of yT) { if (Math.abs(ny - ty) <= SNAP) { ny = ty; gy = g; break; } }
                  setSnapGuideX(gx); setSnapGuideY(gy);
                  const cur = [...(settingsRef.current.imageBoxes ?? [])];
                  if (!cur[idx]) return;
                  cur[idx] = { ...cur[idx], x: nx, y: ny };
                  settingsRef.current = { ...settingsRef.current, imageBoxes: cur };
                  onSettingsChange?.({ imageBoxes: cur });
                  redraw(cachedImgRef.current);
                };
                const onUp = () => {
                  setActiveDragImageBox(null);
                  setSnapGuideX(null);
                  setSnapGuideY(null);
                  window.removeEventListener('mousemove', onMove);
                  window.removeEventListener('mouseup', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              }}
              style={{
                position: 'absolute',
                left:   b.x * DISPLAY_SCALE,
                top:    b.y * DISPLAY_SCALE,
                width:  b.width * DISPLAY_SCALE,
                height: b.height * DISPLAY_SCALE,
                cursor: isActive ? 'grabbing' : geomLocked ? 'default' : 'grab',
                userSelect: 'none',
                pointerEvents: locked ? 'none' : undefined,
                outline: b.id === expandPreviewBoxId ? 'none' : (isSelected || inMulti) ? `1px ${locked || geomLocked ? 'dashed' : 'solid'} rgba(96,165,250,0.95)` : 'none',
                outlineOffset: -1,   // inside the frame so a full-canvas box's outline isn't clipped at the canvas edge
                // Follow visual stacking so the top layer wins clicks — EXCEPT a selected "behind subject"
                // image, which is deliberately ranked under its host: give it top click priority while
                // selected so it stays grabbable/draggable (its on-canvas stacking is unchanged).
                zIndex:  (isSelected && b.behindSubjectOf) ? (6 + baseOrder.length) : 6 + (layerZ.get(b.id) ?? 0),
              }}
            >
              {b.videoUrl && !locked && (
                <button
                  onMouseDown={e => { e.stopPropagation(); e.preventDefault(); }}
                  onClick={e => { e.stopPropagation(); toggleVideoPlay(b.videoUrl!); }}
                  title={playingVideoUrl === b.videoUrl ? 'Pause' : 'Play with sound'}
                  aria-label={playingVideoUrl === b.videoUrl ? 'Pause video' : 'Play video with sound'}
                  style={{
                    position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
                    width: 44, height: 44, borderRadius: 9999, zIndex: 11, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.65)', color: '#fff',
                    backdropFilter: 'blur(2px)',
                  }}
                >
                  {playingVideoUrl === b.videoUrl ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
                  )}
                </button>
              )}
              {/* Geometry locked by the template (posts): tiny lock glyph on the selection frame */}
              {isSelected && geomLocked && (
                <div
                  title="Position and size are locked by the template"
                  style={{
                    position: 'absolute', top: -9, right: -9, width: 18, height: 18,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(96,165,250,0.95)', borderRadius: 4, color: '#fff', zIndex: 10,
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
              )}
              {isSelected && !locked && !geomLocked && !perspEditing && overlayRect && typeof document !== 'undefined' && createPortal((() => {
                // Resize/crop handles rendered to <body> at screen coords (like the selection outline)
                // so they remain visible and grabbable when the box extends past the canvas edge.
                const sxh = overlayRect.width / W, syh = overlayRect.height / H;
                const hl = overlayRect.left + b.x * sxh, ht = overlayRect.top + b.y * syh;
                const hw = b.width * sxh, hh = b.height * syh;
                return <>{HANDLES.map(h => (
                <div
                  key={h.id}
                  onMouseDown={e => {
                    e.stopPropagation();
                    e.preventDefault();
                    if ((h.id === 'n' || h.id === 's' || h.id === 'e' || h.id === 'w') && !b.placeholder) {
                      // Centre-edge handle → crop (hide/reveal source pixels; changes aspect).
                      // A placeholder is an empty SLOT with nothing to crop, so its edge handles fall
                      // through to the free-resize branch below (move that edge).
                      const c = b.crop;
                      imageBoxCropStart.current = {
                        handle: h.id, mx: e.clientX, my: e.clientY,
                        x: b.x, y: b.y, w: b.width, h: b.height,
                        cropL: c?.left ?? 0, cropR: c?.right ?? 0, cropT: c?.top ?? 0, cropB: c?.bottom ?? 0,
                      };
                      setActiveCropImageBox(idx);
                      // Bind synchronously so the handle releases on mouse-up (see note above the image-box effects).
                      const MIN = 20;
                      const onMove = (ev: MouseEvent) => {
                        const s0 = imageBoxCropStart.current;
                        const dx = Math.round((ev.clientX - s0.mx) / DISPLAY_SCALE);
                        const dy = Math.round((ev.clientY - s0.my) / DISPLAY_SCALE);
                        const fullW = s0.w / Math.max(1e-6, 1 - s0.cropL - s0.cropR);
                        const fullH = s0.h / Math.max(1e-6, 1 - s0.cropT - s0.cropB);
                        const imgX0 = s0.x - s0.cropL * fullW, imgXe = imgX0 + fullW;
                        const imgY0 = s0.y - s0.cropT * fullH, imgYe = imgY0 + fullH;
                        let left = s0.x, top = s0.y, right = s0.x + s0.w, bottom = s0.y + s0.h;
                        if (s0.handle.includes('e')) right  = Math.min(imgXe, Math.max(left + MIN, right + dx));
                        if (s0.handle.includes('w')) left   = Math.max(imgX0, Math.min(right - MIN, left + dx));
                        if (s0.handle.includes('s')) bottom = Math.min(imgYe, Math.max(top + MIN, bottom + dy));
                        if (s0.handle.includes('n')) top    = Math.max(imgY0, Math.min(bottom - MIN, top + dy));
                        left = Math.round(left); right = Math.round(right);
                        top = Math.round(top);   bottom = Math.round(bottom);
                        const nx = left, ny = top, nw = Math.max(MIN, right - left), nh = Math.max(MIN, bottom - top);
                        const cl01 = (v: number) => Math.min(0.999, Math.max(0, v));
                        const crop = {
                          left:   cl01((nx - imgX0) / fullW),
                          right:  cl01((imgXe - (nx + nw)) / fullW),
                          top:    cl01((ny - imgY0) / fullH),
                          bottom: cl01((imgYe - (ny + nh)) / fullH),
                        };
                        const cur = [...(settingsRef.current.imageBoxes ?? [])];
                        if (!cur[idx]) return;
                        cur[idx] = { ...cur[idx], x: nx, y: ny, width: nw, height: nh, crop };
                        settingsRef.current = { ...settingsRef.current, imageBoxes: cur };
                        onSettingsChange?.({ imageBoxes: cur });
                        redraw(cachedImgRef.current);
                      };
                      const onUp = () => { setActiveCropImageBox(null); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                      window.addEventListener('mousemove', onMove);
                      window.addEventListener('mouseup', onUp);
                    } else {
                      // Corner handle → scale. A cropped box locks to its current ratio (native aspect no longer applies).
                      imageBoxResizeStart.current = { handle: h.id, mx: e.clientX, my: e.clientY, x: b.x, y: b.y, w: b.width, h: b.height, aspect: (b.crop ? 0 : b.aspect) || (b.width / b.height) || 1 };
                      setActiveResizeImageBox(idx);
                      const MIN = 20;
                      const onMove = (ev: MouseEvent) => {
                        const s0 = imageBoxResizeStart.current;
                        const dx = Math.round((ev.clientX - s0.mx) / DISPLAY_SCALE);
                        const dy = Math.round((ev.clientY - s0.my) / DISPLAY_SCALE);
                        const hasE = s0.handle.includes('e'), hasW = s0.handle.includes('w');
                        const hasS = s0.handle.includes('s'), hasN = s0.handle.includes('n');
                        let w = s0.w + (hasE ? dx : hasW ? -dx : 0);
                        let h = s0.h + (hasS ? dy : hasN ? -dy : 0);
                        let gx: number | null = null, gy: number | null = null;
                        // Placeholders (slots) resize freely — no inherent aspect to lock (Shift still constrains).
                        if (((lockImageAspectRef.current && !b.placeholder) || ev.shiftKey) && s0.w > 0 && s0.h > 0) {
                          const aspect = s0.aspect || s0.w / s0.h || 1;
                          if (Math.abs(w / s0.w - 1) >= Math.abs(h / s0.h - 1)) {
                            if (hasE)      { const g = nearestGuide(s0.x + w, X_GUIDES);        if (g !== null && g - s0.x >= MIN) { w = g - s0.x; gx = g; } }
                            else if (hasW) { const g = nearestGuide(s0.x + s0.w - w, X_GUIDES); if (g !== null && s0.x + s0.w - g >= MIN) { w = s0.x + s0.w - g; gx = g; } }
                            h = w / aspect;
                          } else {
                            if (hasS)      { const g = nearestGuide(s0.y + h, yGuidesRef.current);        if (g !== null && g - s0.y >= MIN) { h = g - s0.y; gy = g; } }
                            else if (hasN) { const g = nearestGuide(s0.y + s0.h - h, yGuidesRef.current); if (g !== null && s0.y + s0.h - g >= MIN) { h = s0.y + s0.h - g; gy = g; } }
                            w = h * aspect;
                          }
                          if (w < MIN) { w = MIN; h = w / aspect; }
                          if (h < MIN) { h = MIN; w = h * aspect; }
                          w = Math.round(w * 100) / 100;
                          h = Math.round(h * 100) / 100;
                        } else {
                          if (hasE)      { const g = nearestGuide(s0.x + w, X_GUIDES);        if (g !== null && g - s0.x >= MIN) { w = g - s0.x; gx = g; } }
                          else if (hasW) { const g = nearestGuide(s0.x + s0.w - w, X_GUIDES); if (g !== null && s0.x + s0.w - g >= MIN) { w = s0.x + s0.w - g; gx = g; } }
                          if (hasS)      { const g = nearestGuide(s0.y + h, yGuidesRef.current);        if (g !== null && g - s0.y >= MIN) { h = g - s0.y; gy = g; } }
                          else if (hasN) { const g = nearestGuide(s0.y + s0.h - h, yGuidesRef.current); if (g !== null && s0.y + s0.h - g >= MIN) { h = s0.y + s0.h - g; gy = g; } }
                          w = Math.max(MIN, w);
                          h = Math.max(MIN, h);
                        }
                        // No 0-clamp on x/y: allow resizing past the left/top edge (consistent with the
                        // off-edge drag) so the box grows beyond the canvas instead of anchoring its origin at 0.
                        const x = hasW ? s0.x + s0.w - w : s0.x;
                        const y = hasN ? s0.y + s0.h - h : s0.y;
                        setSnapGuideX(gx); setSnapGuideY(gy);
                        const cur = [...(settingsRef.current.imageBoxes ?? [])];
                        if (!cur[idx]) return;
                        cur[idx] = { ...cur[idx], x, y, width: w, height: h };
                        settingsRef.current = { ...settingsRef.current, imageBoxes: cur };
                        onSettingsChange?.({ imageBoxes: cur });
                        redraw(cachedImgRef.current);
                      };
                      const onUp = () => { setActiveResizeImageBox(null); setSnapGuideX(null); setSnapGuideY(null); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                      window.addEventListener('mousemove', onMove);
                      window.addEventListener('mouseup', onUp);
                    }
                  }}
                  style={{ position: 'fixed', left: hl + h.fx * hw, top: ht + h.fy * hh, transform: 'translate(-50%,-50%)', width: 8, height: 8, background: '#fff', border: '1px solid rgba(96,165,250,0.95)', borderRadius: 1, cursor: h.cur, zIndex: 26 }}
                />
              ))}</>; })(), document.body)}
              {perspEditing && (
                <>
                  {/* Quad outline — the destination shape the image is warped onto. */}
                  <svg style={{ position: 'absolute', left: 0, top: 0, width: b.width * DISPLAY_SCALE, height: b.height * DISPLAY_SCALE, overflow: 'visible', pointerEvents: 'none', zIndex: 9 }}>
                    <polygon
                      points={[
                        `${pp.tl.x * DISPLAY_SCALE},${pp.tl.y * DISPLAY_SCALE}`,
                        `${(b.width + pp.tr.x) * DISPLAY_SCALE},${pp.tr.y * DISPLAY_SCALE}`,
                        `${(b.width + pp.br.x) * DISPLAY_SCALE},${(b.height + pp.br.y) * DISPLAY_SCALE}`,
                        `${pp.bl.x * DISPLAY_SCALE},${(b.height + pp.bl.y) * DISPLAY_SCALE}`,
                      ].join(' ')}
                      fill="none" stroke="rgba(96,165,250,0.95)" strokeWidth={1} strokeDasharray="4 3"
                    />
                  </svg>
                  {/* Four corner handles — drag math depends on the active mode (Distort/Perspective/Skew). */}
                  {PCORNERS.map(c => {
                    const off = pp[c.id];
                    return (
                      <div
                        key={c.id}
                        onMouseDown={e => {
                          e.stopPropagation();
                          e.preventDefault();
                          const start = settingsRef.current.imageBoxes?.[idx]?.perspective ?? IDENTITY_PERSPECTIVE;
                          const sp: ImageBoxPerspective = { tl: { ...start.tl }, tr: { ...start.tr }, br: { ...start.br }, bl: { ...start.bl } };
                          const mx = e.clientX, my = e.clientY;
                          // Coalesce the React state commit + the (heavy WebGL) redraw to ONE per
                          // animation frame. Committing on every mousemove floods React with full
                          // re-renders faster than they settle — which trips "Maximum update depth
                          // exceeded" once the perspective warp makes each redraw expensive.
                          let raf = 0;
                          const flush = () => {
                            raf = 0;
                            redraw(cachedImgRef.current);
                            onSettingsChange?.({ imageBoxes: settingsRef.current.imageBoxes });
                          };
                          const onMove = (ev: MouseEvent) => {
                            const dpx = (ev.clientX - mx) / DISPLAY_SCALE;
                            const dpy = (ev.clientY - my) / DISPLAY_SCALE;
                            const np = updatePerspective(c.id, dpx, dpy, sp, perspectiveMode);
                            const cur = [...(settingsRef.current.imageBoxes ?? [])];
                            if (!cur[idx]) return;
                            cur[idx] = { ...cur[idx], perspective: np };
                            settingsRef.current = { ...settingsRef.current, imageBoxes: cur };
                            if (!raf) raf = requestAnimationFrame(flush);
                          };
                          const onUp = () => {
                            if (raf) cancelAnimationFrame(raf);
                            redraw(cachedImgRef.current);
                            onSettingsChange?.({ imageBoxes: settingsRef.current.imageBoxes });   // final commit
                            window.removeEventListener('mousemove', onMove);
                            window.removeEventListener('mouseup', onUp);
                          };
                          window.addEventListener('mousemove', onMove);
                          window.addEventListener('mouseup', onUp);
                        }}
                        style={{
                          position: 'absolute',
                          left: (c.fx * b.width + off.x) * DISPLAY_SCALE,
                          top:  (c.fy * b.height + off.y) * DISPLAY_SCALE,
                          width: 12, height: 12, marginLeft: -6, marginTop: -6,
                          background: '#60a5fa', border: '2px solid #fff', borderRadius: '50%',
                          boxShadow: '0 0 0 1px rgba(0,0,0,0.4)', cursor: 'move', zIndex: 11,
                        }}
                      />
                    );
                  })}
                </>
              )}
            </div>
          );
        })}

        {/* ── Chart box frames (drag to move, corner handles to resize, Delete to remove) ── */}
        {(settings.chartBoxes ?? []).map((cb, idx) => {
          if (cb.hidden) return null;
          const isActive   = activeDragChartBox === idx;
          const isSelected = selectedChartBox === idx;
          const inMulti    = multiSel.some(m => m.kind === 'chart' && m.id === cb.id);
          const locked = !!cb.locked;
          const CHANDLES: { id: string; fx: number; fy: number; cur: string }[] = [
            { id: 'nw', fx: 0, fy: 0, cur: 'nwse-resize' },
            { id: 'ne', fx: 1, fy: 0, cur: 'nesw-resize' },
            { id: 'se', fx: 1, fy: 1, cur: 'nwse-resize' },
            { id: 'sw', fx: 0, fy: 1, cur: 'nesw-resize' },
          ];
          return (
            <div
              key={cb.id}
              data-carousel-slot=""
              onMouseDown={e => {
                const wr = wrapperRef.current?.getBoundingClientRect();
                if (wr && (e.clientX < wr.left || e.clientX > wr.right || e.clientY < wr.top || e.clientY > wr.bottom)) {
                  e.stopPropagation();
                  setSelectedChartBox(null); setSelectedImageBox(null); setSelectedTextBox(null); setMultiSel([]);
                  return;
                }
                e.stopPropagation();
                e.preventDefault();
                setSelectedChartBox(idx);
                setSelectedTextBox(null);
                setSelectedImageBox(null);
                setMultiSel([]);
                if (locked) return;
                chartBoxDragStart.current = { mx: e.clientX, my: e.clientY, x: cb.x, y: cb.y };
                setActiveDragChartBox(idx);
                const SNAP = 12, EDGE = 60;
                const onMove = (ev: MouseEvent) => {
                  const box = settingsRef.current.chartBoxes?.[idx];
                  if (!box) return;
                  const bw = box.width, bh = box.height;
                  const dxPx = (ev.clientX - chartBoxDragStart.current.mx) / DISPLAY_SCALE;
                  const dyPx = (ev.clientY - chartBoxDragStart.current.my) / DISPLAY_SCALE;
                  let nx = Math.max(-bw, Math.min(W, Math.round(chartBoxDragStart.current.x + dxPx)));
                  let ny = Math.max(-bh, Math.min(H, Math.round(chartBoxDragStart.current.y + dyPx)));
                  const xT = [[0, 0], [EDGE, EDGE], [Math.round(W / 2 - bw / 2), Math.round(W / 2)], [W - EDGE - bw, W - EDGE], [W - bw, W]];
                  const yT = [[0, 0], [EDGE, EDGE], [Math.round(H / 2 - bh / 2), Math.round(H / 2)], [H - EDGE - bh, H - EDGE], [H - bh, H]];
                  let gx: number | null = null, gy: number | null = null;
                  for (const [tx, g] of xT) { if (Math.abs(nx - tx) <= SNAP) { nx = tx; gx = g; break; } }
                  for (const [ty, g] of yT) { if (Math.abs(ny - ty) <= SNAP) { ny = ty; gy = g; break; } }
                  setSnapGuideX(gx); setSnapGuideY(gy);
                  const cur = [...(settingsRef.current.chartBoxes ?? [])];
                  if (!cur[idx]) return;
                  cur[idx] = { ...cur[idx], x: nx, y: ny };
                  settingsRef.current = { ...settingsRef.current, chartBoxes: cur };
                  onSettingsChange?.({ chartBoxes: cur });
                  redraw(cachedImgRef.current);
                };
                const onUp = () => {
                  setActiveDragChartBox(null);
                  setSnapGuideX(null); setSnapGuideY(null);
                  window.removeEventListener('mousemove', onMove);
                  window.removeEventListener('mouseup', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              }}
              style={{
                position: 'absolute',
                left:   cb.x * DISPLAY_SCALE,
                top:    cb.y * DISPLAY_SCALE,
                width:  cb.width * DISPLAY_SCALE,
                height: cb.height * DISPLAY_SCALE,
                cursor: isActive ? 'grabbing' : 'grab',
                userSelect: 'none',
                pointerEvents: locked ? 'none' : undefined,
                outline: (isSelected || inMulti) ? `1px ${locked ? 'dashed' : 'solid'} rgba(96,165,250,0.95)` : 'none',
                outlineOffset: -1,
                zIndex: 6 + (layerZ.get(cb.id) ?? 0),
              }}
            >
              {/* Corner resize handles — portaled to <body> at screen coords (like image handles) so
                  they stay visible/grabbable past the canvas edge. Free aspect; Shift keeps ratio. */}
              {isSelected && !locked && overlayRect && typeof document !== 'undefined' && createPortal((() => {
                const sxh = overlayRect.width / W, syh = overlayRect.height / H;
                const hl = overlayRect.left + cb.x * sxh, ht = overlayRect.top + cb.y * syh;
                const hw = cb.width * sxh, hh = cb.height * syh;
                return <>{CHANDLES.map(h => (
                  <div
                    key={h.id}
                    onMouseDown={e => {
                      e.stopPropagation();
                      e.preventDefault();
                      chartBoxResizeStart.current = { handle: h.id, mx: e.clientX, my: e.clientY, x: cb.x, y: cb.y, w: cb.width, h: cb.height };
                      const MINW = 80;
                      // Aspect is LOCKED to the chart's design — a faithful replica of the app's
                      // chart, so it never stretches.
                      const aspect0 = chartAspect(cb.showHeader !== false, cb.showReleases !== false && cb.showReleaseNames === true, cb.showXDates !== false, cb.layout);
                      const onMove = (ev: MouseEvent) => {
                        const s0 = chartBoxResizeStart.current;
                        const dx = Math.round((ev.clientX - s0.mx) / DISPLAY_SCALE);
                        const dy = Math.round((ev.clientY - s0.my) / DISPLAY_SCALE);
                        const hasE = s0.handle.includes('e'), hasW = s0.handle.includes('w');
                        const hasS = s0.handle.includes('s'), hasN = s0.handle.includes('n');
                        let w = Math.max(MINW, s0.w + (hasE ? dx : hasW ? -dx : 0));
                        let hgt = Math.max(MINW / aspect0, s0.h + (hasS ? dy : hasN ? -dy : 0));
                        // Dominant axis wins and snaps its moving edge to the canvas guides
                        // (edges / margin insets / centre); the other follows the locked aspect.
                        let gx: number | null = null, gy: number | null = null;
                        if (Math.abs(w / s0.w - 1) >= Math.abs(hgt / s0.h - 1)) {
                          if (hasE)      { const g = nearestGuide(s0.x + w, X_GUIDES);        if (g !== null && g - s0.x >= MINW) { w = g - s0.x; gx = g; } }
                          else if (hasW) { const g = nearestGuide(s0.x + s0.w - w, X_GUIDES); if (g !== null && s0.x + s0.w - g >= MINW) { w = s0.x + s0.w - g; gx = g; } }
                          hgt = Math.max(MINW / aspect0, w / aspect0);
                        } else {
                          if (hasS)      { const g = nearestGuide(s0.y + hgt, yGuidesRef.current);        if (g !== null && g - s0.y >= MINW / aspect0) { hgt = g - s0.y; gy = g; } }
                          else if (hasN) { const g = nearestGuide(s0.y + s0.h - hgt, yGuidesRef.current); if (g !== null && s0.y + s0.h - g >= MINW / aspect0) { hgt = s0.y + s0.h - g; gy = g; } }
                          w = Math.max(MINW, hgt * aspect0);
                        }
                        const x = hasW ? s0.x + s0.w - w : s0.x;
                        const y = hasN ? s0.y + s0.h - hgt : s0.y;
                        setSnapGuideX(gx); setSnapGuideY(gy);
                        const cur = [...(settingsRef.current.chartBoxes ?? [])];
                        if (!cur[idx]) return;
                        cur[idx] = { ...cur[idx], x, y, width: w, height: hgt };
                        settingsRef.current = { ...settingsRef.current, chartBoxes: cur };
                        onSettingsChange?.({ chartBoxes: cur });
                        redraw(cachedImgRef.current);
                      };
                      const onUp = () => { setSnapGuideX(null); setSnapGuideY(null); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                      window.addEventListener('mousemove', onMove);
                      window.addEventListener('mouseup', onUp);
                    }}
                    style={{ position: 'fixed', left: hl + h.fx * hw, top: ht + h.fy * hh, transform: 'translate(-50%,-50%)', width: 8, height: 8, background: '#fff', border: '1px solid rgba(96,165,250,0.95)', borderRadius: 1, cursor: h.cur, zIndex: 26 }}
                  />
                ))}</>; })(), document.body)}
            </div>
          );
        })}

        {/* ── Text box snap guides (only while dragging) ── */}
        {snapGuideX !== null && (
          <div style={{ position: 'absolute', left: snapGuideX * DISPLAY_SCALE, top: 0, bottom: 0, width: 1, background: 'rgba(96,165,250,0.9)', pointerEvents: 'none', zIndex: 8 }} />
        )}
        {snapGuideY !== null && (
          <div style={{ position: 'absolute', top: snapGuideY * DISPLAY_SCALE, left: 0, right: 0, height: 1, background: 'rgba(96,165,250,0.9)', pointerEvents: 'none', zIndex: 8 }} />
        )}

        {/* ── Option/Alt: spacing measurements from the selected box to each canvas edge ── */}
        {measBox && (() => {
          const mb = measBox;
          const bw = mb.width, bh = mb.height;
          const lPx  = mb.x * DISPLAY_SCALE;
          const tPx  = mb.y * DISPLAY_SCALE;
          const rPx  = (mb.x + bw) * DISPLAY_SCALE;
          const bPx  = (mb.y + bh) * DISPLAY_SCALE;
          const cxPx = (mb.x + bw / 2) * DISPLAY_SCALE;
          const cyPx = (mb.y + bh / 2) * DISPLAY_SCALE;
          const C = '#e23ce8';
          const Pill = ({ v, left, top }: { v: number; left: number; top: number }) => (
            <div style={{ position: 'absolute', left, top, transform: 'translate(-50%, -50%)', background: C, color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: 1, padding: '3px 6px', borderRadius: 999, pointerEvents: 'none', zIndex: 9, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{Math.round(v)}</div>
          );
          return (
            <>
              {/* dashed gap lines: box centre-axis → each canvas edge */}
              <div style={{ position: 'absolute', left: cxPx, top: 0,   height: tPx,                     borderLeft: `1px dashed ${C}`, pointerEvents: 'none', zIndex: 8 }} />
              <div style={{ position: 'absolute', left: cxPx, top: bPx, height: CAROUSEL_PREVIEW_H - bPx, borderLeft: `1px dashed ${C}`, pointerEvents: 'none', zIndex: 8 }} />
              <div style={{ position: 'absolute', top: cyPx, left: 0,   width: lPx,                      borderTop:  `1px dashed ${C}`, pointerEvents: 'none', zIndex: 8 }} />
              <div style={{ position: 'absolute', top: cyPx, left: rPx, width: CAROUSEL_PREVIEW_W - rPx,  borderTop:  `1px dashed ${C}`, pointerEvents: 'none', zIndex: 8 }} />
              {/* end-cap ticks at the canvas edges */}
              <div style={{ position: 'absolute', left: cxPx - 4, top: 0,                          width: 8,  borderTop:  `1px solid ${C}`, pointerEvents: 'none', zIndex: 8 }} />
              <div style={{ position: 'absolute', left: cxPx - 4, top: CAROUSEL_PREVIEW_H - 1,      width: 8,  borderTop:  `1px solid ${C}`, pointerEvents: 'none', zIndex: 8 }} />
              <div style={{ position: 'absolute', top: cyPx - 4,  left: 0,                          height: 8, borderLeft: `1px solid ${C}`, pointerEvents: 'none', zIndex: 8 }} />
              <div style={{ position: 'absolute', top: cyPx - 4,  left: CAROUSEL_PREVIEW_W - 1,     height: 8, borderLeft: `1px solid ${C}`, pointerEvents: 'none', zIndex: 8 }} />
              {/* distance pills (canvas px) */}
              <Pill v={mb.y}            left={cxPx}                            top={tPx / 2} />
              <Pill v={H - (mb.y + bh)} left={cxPx}                            top={(bPx + CAROUSEL_PREVIEW_H) / 2} />
              <Pill v={mb.x}            left={lPx / 2}                         top={cyPx} />
              <Pill v={W - (mb.x + bw)} left={(rPx + CAROUSEL_PREVIEW_W) / 2}  top={cyPx} />
            </>
          );
        })()}

        {/* ── Image-expansion preview: the area BRIA will fill is shown as solid black, with a
              marching-ants dashed marquee around the canvas + the photo (Photoshop-style). ── */}
        {expandPreviewBoxId && (() => {
          const idx = (settings.imageBoxes ?? []).findIndex(b => b.id === expandPreviewBoxId);
          // Only while that box is the selected one, so its move/resize handles are live for adjusting.
          if (idx < 0 || idx !== selectedImageBox) return null;
          const b = (settings.imageBoxes ?? [])[idx];
          if (!b || b.hidden || b.isOverlay) return null;
          const L = Math.max(0, Math.min(CAROUSEL_PREVIEW_W, b.x * DISPLAY_SCALE));
          const T = Math.max(0, Math.min(CAROUSEL_PREVIEW_H, b.y * DISPLAY_SCALE));
          const R = Math.max(0, Math.min(CAROUSEL_PREVIEW_W, (b.x + b.width)  * DISPLAY_SCALE));
          const B = Math.max(0, Math.min(CAROUSEL_PREVIEW_H, (b.y + b.height) * DISPLAY_SCALE));
          // Opaque black fill over everything outside the photo = the region to be generated.
          const Strip = (s: React.CSSProperties) => <div style={{ position: 'absolute', background: '#000', pointerEvents: 'none', zIndex: 5, ...s }} />;
          return (
            <>
              {Strip({ left: 0, top: 0, width: CAROUSEL_PREVIEW_W, height: T })}
              {Strip({ left: 0, top: B, width: CAROUSEL_PREVIEW_W, height: Math.max(0, CAROUSEL_PREVIEW_H - B) })}
              {Strip({ left: 0, top: T, width: L, height: Math.max(0, B - T) })}
              {Strip({ left: R, top: T, width: Math.max(0, CAROUSEL_PREVIEW_W - R), height: Math.max(0, B - T) })}
              {/* marching-ants marquee around the whole output canvas + around the kept photo */}
              <div className="te-marching-ants" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }} />
              <div className="te-marching-ants" style={{ position: 'absolute', left: L, top: T, width: Math.max(0, R - L), height: Math.max(0, B - T), pointerEvents: 'none', zIndex: 6 }} />
            </>
          );
        })()}

        {/* ── Crop overlay canvas (drawn on top of main canvas) ── */}
        <canvas
          ref={cropOverlayRef}
          width={CAROUSEL_PREVIEW_W}
          height={CAROUSEL_PREVIEW_H}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4, display: isCropMode ? 'block' : 'none' }}
        />

        {/* ── Crop handles ── */}
        {isCropMode && (() => {
          const HS = 8;
          const { x, y, w, h } = cropRect;
          const handles = [
            { id: 'nw', cx: x,     cy: y,     cur: 'nwse-resize' },
            { id: 'n',  cx: x+w/2, cy: y,     cur: 'ns-resize'   },
            { id: 'ne', cx: x+w,   cy: y,     cur: 'nesw-resize'  },
            { id: 'e',  cx: x+w,   cy: y+h/2, cur: 'ew-resize'    },
            { id: 'se', cx: x+w,   cy: y+h,   cur: 'nwse-resize'  },
            { id: 's',  cx: x+w/2, cy: y+h,   cur: 'ns-resize'    },
            { id: 'sw', cx: x,     cy: y+h,   cur: 'nesw-resize'  },
            { id: 'w',  cx: x,     cy: y+h/2, cur: 'ew-resize'    },
          ];
          return handles.map(hd => (
            <div
              key={hd.id}
              data-crop-handle=""
              onMouseDown={e => {
                e.stopPropagation(); e.preventDefault();
                cropActiveHandle.current = hd.id;
                cropDragStart.current = { mx: e.clientX, my: e.clientY, rect: { ...cropRectRef.current } };
              }}
              style={{
                position: 'absolute',
                left: hd.cx - HS / 2,
                top:  hd.cy - HS / 2,
                width: HS, height: HS,
                background: '#fff',
                border: '1px solid rgba(0,0,0,0.35)',
                borderRadius: 2,
                cursor: hd.cur,
                zIndex: 998,   // crop handles above the per-layer frame band
              }}
            />
          ));
        })()}

        {/* ── Crop toolbar ── */}
        {isCropMode && (
          <div
            data-crop-handle=""
            style={{ position: 'absolute', bottom: 8, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 5, zIndex: 999 }}
          >
            {/* 4:5 snap + lock */}
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => {
                if (cropLock === '4:5') { setCropLock('free'); return; }
                const { x, y, w, h } = cropRectRef.current;
                const AR = 4 / 5;
                let nx = x, ny = y, nw = w, nh = w / AR;
                if (nh > CAROUSEL_PREVIEW_H) { nh = h; nw = h * AR; nx = x + (w - nw) / 2; }
                else { ny = y + (h - nh) / 2; }
                const nr = { x: Math.round(Math.max(0, nx)), y: Math.round(Math.max(0, ny)), w: Math.round(nw), h: Math.round(nh) };
                cropRectRef.current = nr; setCropRect(nr); drawCropOverlay(nr);
                setCropLock('4:5');
              }}
              style={{
                padding: '3px 9px',
                background: cropLock === '4:5' ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.65)',
                border: '1px solid rgba(255,255,255,0.35)',
                borderRadius: 5,
                color: cropLock === '4:5' ? '#000' : 'rgba(255,255,255,0.85)',
                fontSize: 10, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.3,
              }}
            >4:5</button>
            {/* Reset */}
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => {
                // Clear committed crop — full original image will show
                imgSrcCropRef.current = null;
                imgOffsetRef.current  = { x: 0, y: 0 };
                imgScaleRef.current   = 1;
                setImgScale(1);
                onScaleChange?.(1);
                redraw(cachedImgRef.current);
                const full = { x: 0, y: 0, w: CAROUSEL_PREVIEW_W, h: CAROUSEL_PREVIEW_H };
                cropRectRef.current = full; setCropRect(full); drawCropOverlay(full);
              }}
              style={{
                padding: '3px 9px', background: 'rgba(0,0,0,0.65)',
                border: '1px solid rgba(255,255,255,0.25)', borderRadius: 5,
                color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: 500, cursor: 'pointer',
              }}
            >Reset</button>
            {/* Done */}
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => applyCrop()}
              style={{
                padding: '3px 12px', background: '#fff',
                border: 'none', borderRadius: 5,
                color: '#000', fontSize: 10, fontWeight: 700, cursor: 'pointer',
              }}
            >Done</button>
          </div>
        )}

        </>}

      </div>
      </div>

      {!staticMode && <>

      {/* Quote picker modal */}
      {showQuotePicker !== null && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70"
          onMouseDown={e => { if (e.target === e.currentTarget) setShowQuotePicker(null); }}
        >
          <div className="bg-surface border border-separator rounded-lg shadow-lg p-4" style={{ width: 380, maxHeight: '80vh', overflowY: 'auto' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-headline text-label">Choose a quote mark</span>
              <button onClick={() => setShowQuotePicker(null)} className="text-label-tertiary hover:text-label-secondary transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>

            {/* Single marks */}
            <p className="text-caption-sm font-medium text-label-tertiary mb-2">Single</p>
            <div className="grid grid-cols-5 gap-1.5 mb-4">
              {QUOTE_STYLES.map(qs => (
                <button
                  key={qs.id}
                  onClick={() => { selectQuoteZone(showQuotePicker!, pendingSlotZoneRef.current, qs.id); setShowQuotePicker(null); }}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-md bg-surface-1 border border-separator hover:border-label-quaternary hover:bg-surface-2 transition-colors group"
                >
                  <svg viewBox={qs.viewBox.join(' ')} style={{ width: 30, height: 30, fill: '#ffffff' }}>
                    {qs.paths.map((d, pi) => <path key={pi} d={d} />)}
                  </svg>
                  <span className="text-micro text-label-tertiary group-hover:text-label-secondary transition-colors text-center leading-tight">{qs.label}</span>
                </button>
              ))}
            </div>

            {/* Paired marks (open + close) */}
            <p className="text-caption-sm font-medium text-label-tertiary mb-2">Paired open + close</p>
            <div className="grid grid-cols-5 gap-1.5">
              {QUOTE_STYLES_PAIRED.map(qs => {
                const [vbX, vbY, vbW, vbH] = qs.viewBox;
                const gapVB = vbW * 0.15;
                const closeTransform = `translate(${vbX + vbW + gapVB},${vbY}) rotate(180,${vbW / 2},${vbH / 2}) translate(${-vbX},${-vbY})`;
                return (
                  <button
                    key={qs.id}
                    onClick={() => { selectQuoteZone(showQuotePicker!, pendingSlotZoneRef.current, qs.id); setShowQuotePicker(null); }}
                    className="flex flex-col items-center gap-1.5 p-2 rounded-md bg-surface-1 border border-separator hover:border-label-quaternary hover:bg-surface-2 transition-colors group"
                  >
                    <svg viewBox={`${vbX} ${vbY} ${vbW * 2 + gapVB} ${vbH}`} style={{ width: 52, height: 26, fill: '#ffffff' }}>
                      {/* Opening */}
                      <g>
                        {qs.paths.map((d, pi) => <path key={pi} d={d} />)}
                      </g>
                      {/* Closing (180° flip) */}
                      <g transform={closeTransform}>
                        {qs.paths.map((d, pi) => <path key={'c' + pi} d={d} />)}
                      </g>
                    </svg>
                    <span className="text-micro text-label-tertiary group-hover:text-label-secondary transition-colors text-center leading-tight">{qs.label.replace(' ❝…❞', '')}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Main slot dropdown — portalled to body so it is never clipped by canvas overflow */}
      {openSlot !== null && slotDropdownPos !== null && typeof document !== 'undefined' && createPortal(
        (() => {
          const si = openSlot;
          const slotInputId = `logo-${instanceId}-${si}`;
          return (
            <div
              data-slot-dropdown=""
              style={{ position: 'fixed', left: slotDropdownPos.x, top: slotDropdownPos.y, width: 220, zIndex: 9999 }}
              className="bg-surface border border-separator rounded-lg shadow-lg py-1"
              onMouseDown={e => e.stopPropagation()}
            >
              {brandLogoSrc && (
                <button
                  onClick={() => { selectBrandLogoZone(si, pendingSlotZoneRef.current); setOpenSlot(null); setSlotDropdownPos(null); setShowCustom(false); }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-caption-sm text-label-secondary hover:bg-surface-2 transition-colors"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={brandLogoSrc} alt="" className="w-5 h-5 object-contain rounded-sm shrink-0" />
                  Brand Kit Logo
                </button>
              )}
              <label
                htmlFor={slotInputId}
                onClick={() => { setOpenSlot(null); setSlotDropdownPos(null); }}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-caption-sm text-label-secondary hover:bg-surface-2 transition-colors cursor-pointer"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                Upload image…
              </label>
              <div className="border-t border-separator mt-1 pt-1">
                <span className="block px-3 py-1 text-micro font-medium text-label-quaternary">Tags</span>
                <div className="px-2 pb-1 flex flex-wrap gap-1">
                  {TAG_PRESETS.map(preset => {
                    const presetStyle = { ...defaultTagStyle(), ...preset.initStyle };
                    return (
                      <button
                        key={preset.id}
                        onClick={() => { selectTagZone(si, pendingSlotZoneRef.current, preset.label, presetStyle); setOpenSlot(null); setSlotDropdownPos(null); setShowCustom(false); }}
                        style={{
                          backgroundColor: presetStyle.bgOpacity > 0 ? presetStyle.bgColor : 'transparent',
                          border: presetStyle.borderWidth > 0 ? `${presetStyle.borderWidth}px solid ${presetStyle.borderColor}` : '1px solid #52525b',
                          color: presetStyle.textColor,
                          borderRadius: presetStyle.cornerRadius,
                        }}
                        className="px-2 py-0.5 text-micro font-bold transition-opacity hover:opacity-80"
                      >{preset.label}</button>
                    );
                  })}
                </div>
                {showCustom ? (
                  <div className="px-2 pb-2 flex gap-1.5">
                    <input
                      autoFocus type="text" value={customTagText}
                      onChange={e => setCustomTagText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && customTagText.trim()) {
                          selectTagZone(si, pendingSlotZoneRef.current, customTagText.trim(), defaultTagStyle());
                          setOpenSlot(null); setSlotDropdownPos(null); setShowCustom(false); setCustomTagText('');
                        }
                        if (e.key === 'Escape') { setShowCustom(false); setCustomTagText(''); }
                      }}
                      placeholder="Tag text…"
                      className="flex-1 bg-surface-2 border border-separator text-label rounded-sm px-2 py-1 outline-none focus:border-label-quaternary min-w-0"
                    />
                    <button
                      onClick={() => {
                        if (!customTagText.trim()) return;
                        selectTagZone(si, pendingSlotZoneRef.current, customTagText.trim(), defaultTagStyle());
                        setOpenSlot(null); setSlotDropdownPos(null); setShowCustom(false); setCustomTagText('');
                      }}
                      className="px-2 py-1 rounded-sm bg-accent text-on-accent text-caption-sm font-medium hover:bg-accent-hover transition-colors shrink-0"
                    >Add</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowCustom(true)}
                    className="flex items-center gap-1.5 w-full px-3 py-1.5 text-caption-sm text-label-tertiary hover:text-label-secondary hover:bg-surface-2 transition-colors"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Custom tag…
                  </button>
                )}
              </div>
              <div className="border-t border-separator mt-1 pt-1">
                <span className="block px-3 py-1 text-micro font-medium text-label-quaternary">Quotation</span>
                <button
                  onClick={() => { setShowQuotePicker(si); setOpenSlot(null); setSlotDropdownPos(null); setShowCustom(false); }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-caption-sm text-label-secondary hover:bg-surface-2 transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179z"/>
                  </svg>
                  Add quote mark…
                </button>
              </div>
              <div className="border-t border-separator mt-1 pt-1">
                <span className="block px-3 py-1 text-micro font-medium text-label-quaternary">Swipe</span>
                {SWIPE_PRESETS.map(preset => (
                  <button
                    key={preset.id}
                    onClick={() => { selectSwipeZone(si, pendingSlotZoneRef.current, preset.style); setOpenSlot(null); setSlotDropdownPos(null); setShowCustom(false); }}
                    className="flex items-center w-full px-3 py-1 text-caption-sm text-label-secondary hover:bg-surface-2 transition-colors"
                  >
                    <div style={{ overflow: 'visible', width: '100%' }}>
                      <TemplateEditorSwipePreviewMini style={preset.style} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })(),
        document.body
      )}

      {/* Sub-slot dropdown — portalled to body so it escapes all overflow/z-index constraints */}
      {openSubSlot !== null && subDropdownPos !== null && typeof document !== 'undefined' && createPortal(
        (() => {
          const si = openSubSlot;
          const subInputId = `logo-sub-${instanceId}-${si}`;
          const subContent = settings.dividerSubSlots?.[si] ?? null;
          return (
            <div
              style={{ position: 'fixed', left: subDropdownPos.x, top: subDropdownPos.y, minWidth: 196, zIndex: 9999 }}
              className="bg-surface border border-separator rounded-lg shadow-lg py-1"
              onMouseDown={e => e.stopPropagation()}
            >
              {brandLogoSrc && (
                <button
                  onClick={() => { selectSubBrandLogo(si); setOpenSubSlot(null); setSubDropdownPos(null); setShowSubCustom(false); }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-caption-sm text-label-secondary hover:bg-surface-2 transition-colors"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={brandLogoSrc} alt="" className="w-5 h-5 object-contain rounded-sm shrink-0" />
                  Brand Kit Logo
                </button>
              )}
              <label
                htmlFor={subInputId}
                onClick={() => { setOpenSubSlot(null); setSubDropdownPos(null); }}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-caption-sm text-label-secondary hover:bg-surface-2 transition-colors cursor-pointer"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                Upload image…
              </label>
              <div className="border-t border-separator mt-1 pt-1">
                <span className="block px-3 py-1 text-micro font-medium text-label-quaternary">Tags</span>
                <div className="px-2 pb-1 flex flex-wrap gap-1">
                  {TAG_PRESETS.map(preset => {
                    const ps = { ...defaultTagStyle(), ...preset.initStyle };
                    return (
                      <button
                        key={preset.id}
                        onClick={() => { selectSubTag(si, preset.label, ps); setOpenSubSlot(null); setSubDropdownPos(null); setShowSubCustom(false); }}
                        style={{
                          backgroundColor: ps.bgOpacity > 0 ? ps.bgColor : 'transparent',
                          border: ps.borderWidth > 0 ? `${ps.borderWidth}px solid ${ps.borderColor}` : '1px solid #52525b',
                          color: ps.textColor,
                          borderRadius: ps.cornerRadius,
                        }}
                        className="px-2 py-0.5 text-micro font-bold transition-opacity hover:opacity-80"
                      >{preset.label}</button>
                    );
                  })}
                </div>
                {showSubCustom ? (
                  <div className="px-2 pb-2 flex gap-1.5">
                    <input
                      autoFocus type="text" value={customTagText}
                      onChange={e => setCustomTagText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && customTagText.trim()) {
                          selectSubTag(si, customTagText.trim(), defaultTagStyle());
                          setOpenSubSlot(null); setSubDropdownPos(null); setShowSubCustom(false); setCustomTagText('');
                        }
                        if (e.key === 'Escape') { setShowSubCustom(false); setCustomTagText(''); }
                      }}
                      placeholder="Tag text…"
                      className="flex-1 bg-surface-2 border border-separator text-label rounded-sm px-2 py-1 outline-none focus:border-label-quaternary min-w-0"
                    />
                    <button
                      onClick={() => {
                        if (!customTagText.trim()) return;
                        selectSubTag(si, customTagText.trim(), defaultTagStyle());
                        setOpenSubSlot(null); setSubDropdownPos(null); setShowSubCustom(false); setCustomTagText('');
                      }}
                      className="px-2 py-1 rounded-sm bg-accent text-on-accent text-caption-sm font-medium hover:bg-accent-hover transition-colors shrink-0"
                    >Add</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowSubCustom(true)}
                    className="flex items-center gap-1.5 w-full px-3 py-1.5 text-caption-sm text-label-tertiary hover:text-label-secondary hover:bg-surface-2 transition-colors"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Custom tag…
                  </button>
                )}
              </div>
              {subContent && (
                <div className="border-t border-separator mt-1 pt-1">
                  <button
                    onClick={() => { clearSubSlot(si); setOpenSubSlot(null); setSubDropdownPos(null); }}
                    className="flex items-center gap-2.5 w-full px-3 py-2 text-caption-sm text-label-tertiary hover:text-danger hover:bg-surface-2 transition-colors"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    Remove content
                  </button>
                </div>
              )}
            </div>
          );
        })(),
        document.body
      )}

      </>}

      </>
    );
  }
);

export default TemplateEditorCanvas;
