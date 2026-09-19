import { describe, it, expect } from 'vitest';
import {
  stickerLayout,
  stickerVariant,
  feedforceStickerSrc,
  FEEDFORCE_TAGLINE,
  FEEDFORCE_CTA,
  STICKER_GAP,
  LOCKUP_H,
  TAGLINE_PX,
  TAGLINE_GAP,
  CTA_PX,
  CTA_GAP,
  BOTTOM_MARGIN,
  FEEDFORCE_BAND_RESERVE,
} from './feedforce-sticker';

const CANVAS_H = 1920;
const LOCKUP_W = LOCKUP_H * (475.39 / 62.24); // ≈ 412 at LOCKUP_H 54
const NATURAL_H = LOCKUP_H + TAGLINE_GAP + TAGLINE_PX * 1.2 + CTA_GAP + CTA_PX * 1.2;

/** A stand-in measurer: fixed widths per line, so layout math is testable without a canvas. */
const measurer = (taglineW: number, ctaW = 300) => (text: string) =>
  text === FEEDFORCE_TAGLINE ? taglineW : ctaW;

describe('stickerLayout — geometry', () => {
  it('stacks lockup → tagline → CTA, centred, STICKER_GAP below the crop bottom', () => {
    const L = stickerLayout({ centerX: 540, bottomY: 1000, maxW: 1000, measure: measurer(600) });
    expect(L.scale).toBe(1);
    expect(L.lockup.y).toBe(1000 + STICKER_GAP);
    expect(L.lockup.x + L.lockup.w / 2).toBeCloseTo(540, 6); // centred
    expect(L.tagline.x).toBe(540);
    expect(L.cta.x).toBe(540);
    expect(L.tagline.y).toBe(1000 + STICKER_GAP + LOCKUP_H + TAGLINE_GAP);
    expect(L.cta.y).toBe(1000 + STICKER_GAP + LOCKUP_H + TAGLINE_GAP + TAGLINE_PX * 1.2 + CTA_GAP);
    expect(L.tagline.px).toBe(TAGLINE_PX);
    expect(L.cta.px).toBe(CTA_PX);
  });

  it('puts the CTA below the tagline without overlapping it', () => {
    const L = stickerLayout({ centerX: 540, bottomY: 500, maxW: 1000, measure: measurer(600) });
    expect(L.cta.y).toBeGreaterThanOrEqual(L.tagline.y + TAGLINE_PX * 1.2);
    expect(L.cta.y + CTA_PX * 1.2).toBeCloseTo(L.lockup.y + L.height, 6); // CTA ends the stack
  });

  it('never upscales — a wide crop keeps the natural sizes', () => {
    const L = stickerLayout({ centerX: 540, bottomY: 100, maxW: 5000, measure: measurer(600) });
    expect(L.scale).toBe(1);
    expect(L.lockup.h).toBe(LOCKUP_H);
    expect(L.lockup.w).toBeCloseTo(LOCKUP_W, 6);
  });

  it('shrinks uniformly to 92% of a narrow crop, every row scaling together', () => {
    const maxW = 300;
    const L = stickerLayout({ centerX: 150, bottomY: 100, maxW, measure: measurer(200, 150) });
    const expected = (maxW * 0.92) / LOCKUP_W; // lockup is the widest row here
    expect(L.scale).toBeCloseTo(expected, 6);
    expect(L.lockup.w).toBeCloseTo(LOCKUP_W * expected, 6);
    expect(L.tagline.px).toBeCloseTo(TAGLINE_PX * expected, 6);
    expect(L.cta.px).toBeCloseTo(CTA_PX * expected, 6);
    expect(L.lockup.w).toBeLessThanOrEqual(maxW);
  });

  it('lets the widest row drive the shrink — including the CTA', () => {
    const maxW = 500;
    const wideCta = 900; // CTA wider than both the lockup and the tagline
    const L = stickerLayout({ centerX: 250, bottomY: 100, maxW, measure: measurer(300, wideCta) });
    expect(L.scale).toBeCloseTo((maxW * 0.92) / wideCta, 6);
    expect(L.cta.w).toBeCloseTo(wideCta * L.scale, 6);
    expect(L.cta.w).toBeLessThanOrEqual(maxW);
  });

  it('clamps at the canvas bottom — pulled into frame, never pushed off', () => {
    const L = stickerLayout({ centerX: 540, bottomY: CANVAS_H - 10, maxW: 1000, measure: measurer(600) });
    expect(L.lockup.y).toBeLessThan(CANVAS_H - 10 + STICKER_GAP); // clamped up
    expect(L.lockup.y + L.height).toBeLessThanOrEqual(CANVAS_H - BOTTOM_MARGIN); // CTA still on canvas
  });

  it('does not clamp while there is room below the crop', () => {
    const L = stickerLayout({ centerX: 540, bottomY: 500, maxW: 1000, measure: measurer(600) });
    expect(L.lockup.y).toBe(500 + STICKER_GAP);
  });

  it('measures each line at its OWN font size', () => {
    const seen: Array<[string, number]> = [];
    stickerLayout({
      centerX: 540,
      bottomY: 100,
      maxW: 1000,
      measure: (text, px) => { seen.push([text, px]); return 250; },
    });
    expect(seen).toEqual([[FEEDFORCE_TAGLINE, TAGLINE_PX], [FEEDFORCE_CTA, CTA_PX]]);
  });

  it('height covers all three rows plus their gaps', () => {
    const L = stickerLayout({ centerX: 540, bottomY: 100, maxW: 1000, measure: measurer(600) });
    expect(L.height).toBeCloseTo(NATURAL_H, 6);
  });
});

describe('FEEDFORCE_BAND_RESERVE — the space calcVideoBox holds below the video', () => {
  // The real geometry: a 1000px-wide video box on the 1080×1920 canvas.
  const MAX_W = 1000;
  const REAL = measurer(670, 300); // approximate rendered widths of the two lines

  it('is big enough for the gap plus the whole three-row sticker', () => {
    const bottomY = CANVAS_H - FEEDFORCE_BAND_RESERVE;
    const L = stickerLayout({ centerX: 540, bottomY, maxW: MAX_W, measure: REAL });
    expect(FEEDFORCE_BAND_RESERVE).toBeGreaterThanOrEqual(STICKER_GAP + L.height);
  });

  it('grew when the CTA line was added (the reserve tracks the layout)', () => {
    // Reserve is derived, not hardcoded: gap + stacked height + bottom margin.
    expect(FEEDFORCE_BAND_RESERVE).toBe(STICKER_GAP + Math.ceil(NATURAL_H) + BOTTOM_MARGIN);
    expect(FEEDFORCE_BAND_RESERVE).toBeGreaterThan(168); // the old two-row reserve
  });

  it('leaves the sticker UNCLAMPED at the reserved position (it fits below the video)', () => {
    const bottomY = CANVAS_H - FEEDFORCE_BAND_RESERVE;
    const L = stickerLayout({ centerX: 540, bottomY, maxW: MAX_W, measure: REAL });
    expect(L.lockup.y).toBe(bottomY + STICKER_GAP); // not clamped
    expect(L.lockup.y + L.height).toBeLessThanOrEqual(CANVAS_H - BOTTOM_MARGIN);
  });

  it('does not shrink at our real video width (scale stays 1, so the fixed reserve is exact)', () => {
    const L = stickerLayout({ centerX: 540, bottomY: 100, maxW: MAX_W, measure: REAL });
    expect(L.scale).toBe(1);
  });
});

describe('stickerVariant — lockup colour for its background', () => {
  it('light backgrounds take the black mark (#rrggbb and #rgb)', () => {
    expect(stickerVariant('#ffffff')).toBe('black');
    expect(stickerVariant('#fff')).toBe('black');
    expect(stickerVariant('#EEEEEE')).toBe('black');
  });

  it('dark backgrounds take the white mark', () => {
    expect(stickerVariant('#000000')).toBe('white');
    expect(stickerVariant('#000')).toBe('white');
    expect(stickerVariant('#1a1a2e')).toBe('white');
  });

  it('fails safe to white on unparseable input (templates default to dark)', () => {
    expect(stickerVariant('rgb(255,255,255)')).toBe('white');
    expect(stickerVariant('')).toBe('white');
    expect(stickerVariant('not-a-colour')).toBe('white');
  });
});

describe('feedforceStickerSrc', () => {
  it('maps each variant to its public asset', () => {
    expect(feedforceStickerSrc('black')).toBe('/feedforce-logo-black.svg');
    expect(feedforceStickerSrc('white')).toBe('/feedforce-logo-white.svg');
  });
});
