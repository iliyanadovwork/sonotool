// ─────────────────────────────────────────────────────────────────────────────
// Headless slide → PNG renderer (Phase 2 of the "canvas CLI").
//
// Drives the REAL editor canvas in headless Chromium (Playwright) to produce a
// pixel-faithful 1080×1350 PNG. Fetches the saved slide row with the service-role
// admin client, injects it into the /render page via addInitScript (so the page
// itself needs no auth and touches no DB), waits for the page to publish
// window.__PNG__, and writes the decoded bytes to disk.
//
// IMPORTANT: this module imports `playwright` (a Node-only devDependency) and MUST
// NOT be imported by any app/browser code — only by the CLI (scripts/canvas.ts).
// Uses RELATIVE imports for the template-editor lib so `tsx` resolves them without
// the Next `@/` alias.
// ─────────────────────────────────────────────────────────────────────────────

import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createAdminClient } from './admin-client';
import { rowToSlide, TEMPLATE_TABLES, POST_TABLES } from './slide-serde';
import type { SlideRow } from './slide-serde';

export interface RenderSlideOpts {
  slideId: string;
  kind: 'template' | 'post';
  appUrl: string;   // e.g. http://localhost:3011
  outPath: string;
  preview?: boolean;   // draw empty-placeholder frames (a slot preview) instead of exporting them blank
}

export interface RenderSlideResult {
  width: number;
  height: number;
  bytes: number;
}

// The minimal slide data the /render page needs (no DB, no persistence).
export interface RenderPayload {
  headline: string;
  subheadline: string;
  settings: SlideRow['settings'];
}

// Parse a PNG's IHDR to confirm the pixel dimensions we wrote.
function pngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG: 8-byte signature, then the IHDR chunk (length[4] + "IHDR"[4] + width[4] + height[4] + …).
  const isPng = buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47;
  if (!isPng || buf.toString('ascii', 12, 16) !== 'IHDR') return { width: 0, height: 0 };
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export async function renderSlideToPng(opts: RenderSlideOpts): Promise<RenderSlideResult> {
  const { slideId, kind, appUrl, outPath } = opts;
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;

  const client = createAdminClient();
  const { data, error } = await client.from(tables.slides).select('*').eq('id', slideId).single();
  if (error) throw new Error(`Fetch slide ${slideId} from ${tables.slides} failed: ${error.message}`);
  if (!data) throw new Error(`Slide ${slideId} not found in ${tables.slides}`);

  const slide = rowToSlide(data as Record<string, unknown>);
  return renderPayloadToPng(
    { headline: slide.headline, subheadline: slide.subheadline, settings: slide.settings },
    appUrl,
    outPath,
    opts.preview,
  );
}

// Render an in-memory slide (built from a spec, never persisted) — used by `render --spec`
// for fast visual iteration before committing a design to the DB.
export function renderSlideRowToPng(slide: SlideRow, appUrl: string, outPath: string, preview = false): Promise<RenderSlideResult> {
  return renderPayloadToPng(
    { headline: slide.headline, subheadline: slide.subheadline, settings: slide.settings },
    appUrl,
    outPath,
    preview,
  );
}

// The brand's uploaded fonts (brand_kit_fonts) aren't Google fonts, so the /render page
// can't fetch them by name — it needs the actual file URLs. Fetch only the families the
// slide references (matched by family-name prefix, e.g. "Chirp" → "Chirp Heavy/Bold/…")
// so we don't download the whole brand kit per render.
function slideFontLabels(settings: RenderPayload['settings']): Set<string> {
  const s = new Set<string>();
  if (settings.fontLabel) s.add(settings.fontLabel);
  if (settings.subFontLabel) s.add(settings.subFontLabel);
  for (const tb of settings.textBoxes ?? []) if (tb.fontLabel) s.add(tb.fontLabel);
  return s;
}

async function fetchBrandFontsFor(labels: Set<string>): Promise<{ id: string; label: string; url: string }[]> {
  if (labels.size === 0) return [];
  try {
    const client = createAdminClient();
    const { data, error } = await client.from('brand_kit_fonts').select('id,label,url');
    if (error || !data) return [];
    const wanted = [...labels];
    return (data as { id: string; label: string; url: string }[]).filter(
      f => wanted.some(l => f.label === l || f.label.startsWith(`${l} `)),
    );
  } catch { return []; }   // no brand kit / offline → fall back to system faces
}

async function renderPayloadToPng(payload: RenderPayload, appUrl: string, outPath: string, preview = false): Promise<RenderSlideResult> {
  const brandFonts = await fetchBrandFontsFor(slideFontLabels(payload.settings));

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1600 }, deviceScaleFactor: 1 });
    // Inject the slide data + brand fonts BEFORE any page script runs — the /render page polls for them.
    await page.addInitScript((slideData) => {
      (window as unknown as { __SLIDE__: unknown }).__SLIDE__ = slideData;
    }, payload);
    if (brandFonts.length) {
      await page.addInitScript((fonts) => {
        (window as unknown as { __FONTS__: unknown }).__FONTS__ = fonts;
      }, brandFonts);
    }
    if (preview) {
      await page.addInitScript(() => {
        (window as unknown as { __PREVIEW__: boolean }).__PREVIEW__ = true;
      });
    }

    await page.goto(`${appUrl.replace(/\/$/, '')}/render`, { waitUntil: 'load', timeout: 45_000 });

    await page.waitForFunction(
      () => Boolean((window as unknown as { __PNG__?: string; __RENDER_ERROR__?: string }).__PNG__ ||
                    (window as unknown as { __RENDER_ERROR__?: string }).__RENDER_ERROR__),
      undefined,
      { timeout: 45_000 },
    );

    const renderError = await page.evaluate(
      () => (window as unknown as { __RENDER_ERROR__?: string }).__RENDER_ERROR__ ?? null,
    );
    if (renderError) throw new Error(`Render page reported: ${renderError}`);

    const dataUrl = await page.evaluate(
      () => (window as unknown as { __PNG__?: string }).__PNG__ ?? null,
    );
    if (!dataUrl) throw new Error('Render page produced no __PNG__ output');

    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    const buf = Buffer.from(base64, 'base64');
    await writeFile(outPath, buf);

    const { width, height } = pngDimensions(buf);
    return { width, height, bytes: buf.length };
  } finally {
    await browser.close();
  }
}
