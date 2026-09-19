// ─────────────────────────────────────────────────────────────────────────────
// Font-metric probe. Reports what the BROWSER actually measures for a headline,
// instead of what a PNG lets you infer.
//
//   npx tsx scripts/text-probe.ts --slide <slideId> [--kind post|template]
//
// Why this exists. Poster headlines scale each line independently, so their
// spacing depends on canvas font metrics — fontBoundingBoxAscent,
// actualBoundingBoxAscent — that only exist at runtime in the browser with the
// real font loaded. Reading gaps off a rendered PNG conflates every one of those
// terms, and two attempts at fixing line spacing failed because the constants
// were guessed from pixels rather than measured. This prints them.
// ─────────────────────────────────────────────────────────────────────────────

import { chromium } from 'playwright';
import { createAdminClient } from '../src/lib/template-editor/admin-client';
import { loadEnvLocal } from './load-env';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

(async () => {
  loadEnvLocal();
  const slideId = flag('slide');
  if (!slideId) throw new Error('text-probe: --slide <slideId> is required');
  const kind = (flag('kind') ?? 'post') as 'post' | 'template';
  const table = kind === 'post' ? 'template_editor_post_slides' : 'template_editor_slides';

  const db = createAdminClient();
  const { data, error } = await db.from(table).select('text_boxes').eq('id', slideId).single();
  if (error) throw new Error(`fetch slide failed: ${error.message}`);
  const boxes = ((data as { text_boxes?: Record<string, unknown>[] }).text_boxes ?? [])
    .filter(b => String(b.text ?? '').trim().length > 0);

  const app = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3011';
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // /render loads the same webfonts the renderer uses, so measurements match the output
    await page.goto(`${app}/render`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => (document as unknown as { fonts: FontFaceSet }).fonts.ready);

    for (const b of boxes) {
      const text = String(b.text ?? '');
      const font = String(b.fontLabel ?? 'sans-serif');
      const weight = Number(b.fontWeight ?? 400);
      const secWeight = Number(b.secondaryWeight ?? weight);
      const allCaps = b.allCaps !== false;
      const lh = Number(b.lineHeight ?? 15);
      const factor = 1 + (lh / 100) * 1.2;
      const boxW = Number(b.width ?? 960);

      const out = await page.evaluate(({ text, font, weight, secWeight, allCaps, boxW, factor }) => {
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d')!;
        const REF = 100;
        const lines = (allCaps ? text.toUpperCase() : text).split('\n').filter(l => l.length);
        return lines.map(line => {
          // size each line to fill the box, exactly as layoutFitToWidth does
          ctx.font = `${weight} ${REF}px "${font}"`;
          const refW = ctx.measureText(line).width;
          const size = refW > 0 ? (boxW * REF) / refW : REF;
          ctx.font = `${weight} ${size}px "${font}"`;
          const m = ctx.measureText(line);
          return {
            line, size: Math.round(size),
            fontAsc: Math.round(m.fontBoundingBoxAscent ?? -1),
            fontDes: Math.round(m.fontBoundingBoxDescent ?? -1),
            inkAsc:  Math.round(m.actualBoundingBoxAscent ?? -1),
            inkDes:  Math.round(m.actualBoundingBoxDescent ?? -1),
            advance: Math.round(size * factor),
          };
        });
      }, { text, font, weight, secWeight, allCaps, boxW, factor });

      console.log(`\nbox "${b.name ?? '(body)'}"  font=${font} weight=${weight}/${secWeight} lineHeight=${lh} -> factor=${factor.toFixed(3)}`);
      console.log('  line                         size  fontAsc fontDes  inkAsc inkDes  advance  topPad(fontAsc-inkAsc)');
      let prev: { advance: number; inkAsc: number; inkDes: number; fontAsc: number } | null = null;
      for (const r of out) {
        const topPad = r.fontAsc - r.inkAsc;
        console.log(`  ${r.line.slice(0, 26).padEnd(28)} ${String(r.size).padStart(4)}  ${String(r.fontAsc).padStart(7)} ${String(r.fontDes).padStart(7)}  ${String(r.inkAsc).padStart(6)} ${String(r.inkDes).padStart(6)}  ${String(r.advance).padStart(7)}  ${String(topPad).padStart(6)}`);
        if (prev) {
          // with textBaseline 'top': gap = prevAdvance - (prevTopPad + prevInk) + thisTopPad
          const gap = prev.advance - ((prev.fontAsc - prev.inkAsc) + prev.inkAsc + prev.inkDes) + (r.fontAsc - r.inkAsc);
          console.log(`${' '.repeat(4)}^ predicted visual gap above this line: ${Math.round(gap)}px`);
        }
        prev = r;
      }
    }
  } finally { await browser.close(); }
})().catch(e => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1); });
