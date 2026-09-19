'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Headless render surface for the "canvas CLI" (Phase 2).
//
// This page drives the REAL editor canvas in a headless browser to produce a
// 1080×1350 PNG at full fidelity. It takes NO auth and fetches NOTHING from the
// DB: the slide data is injected by Playwright via addInitScript into
// `window.__SLIDE__` BEFORE the page loads, so there is no data-exposure surface.
//
// Flow: poll for window.__SLIDE__ → mount <TemplateEditorCanvas staticMode> →
// poll ref.isReadyForPublish() (fonts + image-box images) → renderImageBlob() →
// re-encode the blob to a PNG data URL → window.__PNG__. On any failure the
// message lands in window.__RENDER_ERROR__ so the driver can surface it.
// ─────────────────────────────────────────────────────────────────────────────

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import type { TemplateEditorCanvasRef, CarouselSettings } from '@/app/components/templateEditorTypes';
import { resolveCarouselFont, setCustomFonts } from '@/app/components/customFonts';

interface SlideData {
  headline: string;
  subheadline: string;
  settings: CarouselSettings;
}

declare global {
  interface Window {
    __SLIDE__?: SlideData;
    __FONTS__?: { id: string; label: string; url: string }[];
    __PREVIEW__?: boolean;
    __PNG__?: string;
    __RENDER_ERROR__?: string;
  }
}

// ssr:false — the canvas touches document/window at render time, and next/dynamic
// (React.lazy under the hood on Next 16 / React 19) forwards the ref to the
// underlying forwardRef component.
const TemplateEditorCanvas = dynamic(() => import('@/app/components/TemplateEditorCanvas'), { ssr: false });

const READY_TIMEOUT_MS = 20_000;

// A video box is an image box carrying a `videoUrl`. Playwright's bundled Chromium
// lacks H.264/AAC codecs, so such a slide's <video> never reaches readyState≥2 and
// isReadyForPublish() would spin the full timeout. Detect it up front and fail fast.
function slideHasVideo(settings: CarouselSettings): boolean {
  return (settings.imageBoxes ?? []).some(b => !!b.videoUrl);
}

// ── Webfont preload ──────────────────────────────────────────────────────────
// `ctx.fillText` does NOT kick off CSS webfont loading the way the DOM does, and in
// the headless /render page the settings panel (which normally injects the Google
// Fonts <link>s) never mounts. So we must (1) inject the @font-face stylesheet for
// every family the slide references and (2) explicitly `document.fonts.load(...)`
// the weights actually used — otherwise text draws in a fallback face.

// Collect { fontLabel → weights } for every text-bearing element on the slide.
// Regular (400) + Bold (700) are always included since spans/highlights can pull
// either regardless of the element's base weight. Chart boxes handle their own font
// (always Inter, via the canvas' ensureChartFont), so they need no entry here.
function collectSlideFonts(settings: CarouselSettings): Map<string, Set<number>> {
  const wanted = new Map<string, Set<number>>();
  const add = (label?: string, ...weights: (number | undefined)[]) => {
    if (!label) return;
    let set = wanted.get(label);
    if (!set) { set = new Set<number>([400, 700]); wanted.set(label, set); }
    for (const w of weights) if (typeof w === 'number') set.add(w);
  };

  add(settings.fontLabel, settings.fontWeight);
  add(settings.subFontLabel, settings.subFontWeight);
  for (const tb of settings.textBoxes ?? []) {
    add(tb.fontLabel, tb.fontWeight, tb.secondaryWeight);
    for (const sp of tb.spans ?? []) if (typeof sp.weight === 'number') add(tb.fontLabel, sp.weight);
  }
  // Tags (base + slots + zone slots) and swipe elements also draw text with fillText.
  add(settings.tagStyle?.fontLabel, settings.tagStyle?.fontWeight);
  for (const slot of settings.tagSlots ?? []) if (slot) add(slot.style.fontLabel, slot.style.fontWeight);
  for (const slot of settings.tagZoneSlots ?? []) if (slot) add(slot.style.fontLabel, slot.style.fontWeight);
  for (const sw of settings.swipeZoneSlots ?? []) if (sw) add(sw.fontLabel, sw.fontWeight);
  for (const d of settings.dividerSubSlots ?? []) {
    if (d && (d.type === 'tag' || d.type === 'swipe')) add(d.style.fontLabel, d.style.fontWeight);
  }
  return wanted;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | void> {
  return Promise.race([p, new Promise<void>(r => setTimeout(r, ms))]);
}

// Inject each referenced family's Google Fonts stylesheet (mirrors the settings
// panel), wait for the sheets, then force-load the specific weights so the faces are
// truly resident before we draw. Resolved via resolveCarouselFont so the family +
// css string match exactly what the canvas feeds to ctx.font.
async function ensureSlideFontsLoaded(settings: CarouselSettings): Promise<void> {
  const wanted = collectSlideFonts(settings);

  const linkWaits: Promise<unknown>[] = [];
  for (const label of wanted.keys()) {
    const entry = resolveCarouselFont(label);
    if (!entry.google) continue;   // system faces (Georgia/Impact) + custom uploads: nothing to fetch
    const id = `gfont-${label.replace(/\s+/g, '-')}`;
    if (document.getElementById(id)) continue;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${entry.google}&display=swap`;
    linkWaits.push(withTimeout(new Promise<void>(res => {
      link.onload = () => res();
      link.onerror = () => res();
    }), 8_000));
    document.head.appendChild(link);
  }
  await Promise.all(linkWaits).catch(() => {});

  const faceWaits: Promise<unknown>[] = [];
  for (const [label, weights] of wanted) {
    const entry = resolveCarouselFont(label);
    for (const w of weights) {
      // Same shorthand shape the canvas uses for ctx.font (`<weight> <size>px <css>`).
      try { faceWaits.push(document.fonts.load(`${w} 40px ${entry.css}`).catch(() => {})); } catch { /* ignore */ }
    }
  }
  await withTimeout(Promise.all(faceWaits), 8_000).catch(() => {});
  if (document.fonts?.ready) await withTimeout(document.fonts.ready, 4_000).catch(() => {});
}

// ── Single-line constraint guard ─────────────────────────────────────────────
// `singleLine` boxes hard-refuse overflow in the editor, but data can also arrive
// from the CLI or old rows. Rather than silently rendering a broken layout, fail
// the render with a precise message. Runs after fonts are loaded so measurement
// matches the canvas (same font shorthand + letterSpacing).
function checkSingleLineConstraints(settings: CarouselSettings): string[] {
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  if (!ctx) return [];
  const problems: string[] = [];
  for (const tb of settings.textBoxes ?? []) {
    if (!tb.singleLine || tb.fitToWidth) continue;
    const entry = resolveCarouselFont(tb.fontLabel);
    const ls = tb.letterSpacing ?? 0;
    try { (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${ls}px`; } catch { /* older engines */ }
    const caps = (s: string) => (tb.allCaps ? s.toUpperCase() : s).replace(/\n/g, ' ');
    const secW = tb.secondaryWeight ?? tb.fontWeight;
    const runs = tb.spans?.length
      ? tb.spans.map(sp => ({ text: caps(sp.text), weight: sp.weight ?? (sp.secondary ? secW : sp.bold ? Math.max(700, tb.fontWeight) : tb.fontWeight), italic: sp.italic ?? tb.italic }))
      : [{ text: caps(tb.text ?? ''), weight: tb.fontWeight, italic: tb.italic }];
    let w = 0;
    for (const r of runs) {
      ctx.font = `${r.italic ? 'italic ' : ''}${r.weight} ${tb.fontSize}px ${entry.css}`;
      w += ctx.measureText(r.text).width;
    }
    if (w > tb.width + 0.5) {
      const preview = runs.map(r => r.text).join('').slice(0, 60);
      problems.push(
        `single-line text box ${tb.id} overflows: needs ${Math.ceil(w)}px but the box is ${Math.round(tb.width)}px wide ` +
        `at ${tb.fontSize}px ${tb.fontLabel} — shorten the text ("${preview}…")`,
      );
    }
  }
  return problems;
}

// Re-encode the (JPEG) export blob to a genuine PNG data URL by drawing it onto a
// canvas — keeps the output a real 1080×1350 PNG rather than JPEG-bytes-in-a-.png.
function blobToPngDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth;
        cv.height = img.naturalHeight;
        const ctx = cv.getContext('2d');
        if (!ctx) { reject(new Error('2D context unavailable')); return; }
        ctx.drawImage(img, 0, 0);
        const dataUrl = cv.toDataURL('image/png');
        URL.revokeObjectURL(url);
        resolve(dataUrl);
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to decode render blob')); };
    img.src = url;
  });
}

export default function RenderPage() {
  const [slide, setSlide] = useState<SlideData | null>(null);
  const canvasRef = useRef<TemplateEditorCanvasRef | null>(null);
  const startedRef = useRef(false);

  // Poll for the Playwright-injected slide payload.
  useEffect(() => {
    if (slide) return;
    let timer: number;
    const check = () => {
      if (typeof window !== 'undefined' && window.__SLIDE__) { setSlide(window.__SLIDE__); return; }
      timer = window.setTimeout(check, 50);
    };
    check();
    return () => window.clearTimeout(timer);
  }, [slide]);

  // Once the canvas is mounted and the slide is present, wait for readiness then capture.
  useEffect(() => {
    if (!slide || startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    const deadline = Date.now() + READY_TIMEOUT_MS;

    const capture = async () => {
      try {
        // Register the brand's uploaded fonts (injected by render.ts) so custom families like
        // "Chirp" resolve to their real faces instead of a fallback. The editor does this via
        // useBrandKit, which never mounts here.
        if (window.__FONTS__?.length) setCustomFonts(window.__FONTS__);

        // Video boxes cannot be decoded here, but they no longer have to be fatal: a
        // video box added through the CLI carries a POSTER FRAME in `url`. Drop the
        // videoUrl for this render so the box paints its poster like a normal image,
        // and only fail when a video box has no poster to fall back to.
        if (slideHasVideo(slide.settings)) {
          const boxes = slide.settings.imageBoxes ?? [];
          // "Has a poster" means a still IMAGE. A box whose url is the video itself
          // (the editor sets both when you drop an mp4) has nothing to fall back to:
          // loading it as an <img> never fires onload and the render dies on timeout
          // rather than saying why.
          const isVidUrl = (u?: string) => !!u && /\.(mp4|webm|mov|m4v)($|\?)/i.test(u);
          const posterless = boxes.filter(b => b.videoUrl && (!b.url || isVidUrl(b.url)));
          if (posterless.length) {
            throw new Error(`render: ${posterless.length} video box(es) have no poster frame — the still renderer cannot decode video. Run: canvas.ts poster --id <id> --box <boxId>  (or use the app's video export).`);
          }
          // Strip videoUrl in place on the settings object the canvas reads: the
          // slide binding itself is const and shared.
          slide.settings.imageBoxes = boxes.map(b => (b.videoUrl ? { ...b, videoUrl: undefined } : b));
        }

        // Wait for the ref, then for the canvas' own readiness gate.
        while (!cancelled && !canvasRef.current) {
          if (Date.now() > deadline) throw new Error('Canvas ref never attached');
          await new Promise(r => setTimeout(r, 50));
        }
        while (!cancelled && !canvasRef.current!.isReadyForPublish()) {
          if (Date.now() > deadline) throw new Error('Canvas not ready for publish within timeout');
          await new Promise(r => setTimeout(r, 100));
        }
        // Explicitly load every webfont the slide's text references (fillText does not
        // trigger CSS webfont loading, and the font-injecting settings panel is absent
        // here), so text isn't captured in a fallback face. Then let one frame flush.
        await ensureSlideFontsLoaded(slide.settings);
        // Enforce hard single-line constraints (fonts are resident, so widths are exact).
        const violations = checkSingleLineConstraints(slide.settings);
        if (violations.length) throw new Error(`render blocked: ${violations.join('; ')}`);
        await new Promise(r => setTimeout(r, 150));
        if (cancelled) return;

        const blob = await canvasRef.current!.renderImageBlob();
        const dataUrl = await blobToPngDataUrl(blob);
        if (!cancelled) window.__PNG__ = dataUrl;
      } catch (err) {
        if (!cancelled) window.__RENDER_ERROR__ = err instanceof Error ? (err.stack || err.message) : String(err);
      }
    };

    void capture();
    return () => { cancelled = true; };
  }, [slide]);

  if (!slide) return null;

  return (
    <TemplateEditorCanvas
      ref={canvasRef}
      staticMode
      previewPlaceholders={typeof window !== 'undefined' && !!window.__PREVIEW__}
      imageSrc=""
      headline={slide.headline}
      subheadline={slide.subheadline}
      settings={slide.settings}
      // No-op callbacks — staticMode suppresses interactive chrome, but the props
      // are optional so most can simply be omitted; those we pass are inert.
      onScaleChange={() => {}}
      onSettingsChange={() => {}}
    />
  );
}
