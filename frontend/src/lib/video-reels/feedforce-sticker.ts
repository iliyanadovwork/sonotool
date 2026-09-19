// FeedForce sticker — a small branded lockup + tagline drawn just below the
// video crop, shown when a row's tag is `feedforce` (same tag-driven mechanism
// as the betonline / polymarket / index banners).
//
// Shared with the companion app reel canvas so the two stay visually identical.
// The layout math is a PURE function taking a measured text width (not a ctx),
// so it's unit-testable without a canvas — and the preview and the baked export
// call it with identical geometry, which is what keeps them WYSIWYG.

// Canvas height (1080×1920 portrait) — the clamp needs it.
const CANVAS_H = 1920;

export const FEEDFORCE_TAGLINE = 'The AI content automation tool that pays you to post';
export const FEEDFORCE_CTA = 'Sign up for free, link in bio';

export const STICKER_GAP = 52;      // px below the crop's bottom edge
export const LOCKUP_H = 54;         // logo lockup height
export const TAGLINE_PX = 23;       // tagline font size
export const TAGLINE_GAP = 22;      // gap between lockup bottom and tagline top
export const CTA_PX = 20;           // call-to-action font size (subordinate to the tagline)
export const CTA_GAP = 10;          // gap between tagline line box and CTA top
export const BOTTOM_MARGIN = 12;    // keep at least this much canvas below the sticker

// The lockup SVG's intrinsic size is 475.39×62.24.
const LOCKUP_AR = 475.39 / 62.24;

// Stacked height of the three rows, unscaled (×1.2 = a text line box).
const NATURAL_H = LOCKUP_H + TAGLINE_GAP + TAGLINE_PX * 1.2 + CTA_GAP + CTA_PX * 1.2;

// Vertical space the video layout must RESERVE below the crop so the sticker has
// somewhere to sit (mirrors INDEX_BAND_RESERVE for the `index` carousel). Derived
// from the same constants as stickerLayout so the two can't drift apart — adding
// or resizing a line here automatically grows the reserve.
//
// This assumes the sticker draws unshrunk (scale 1), which holds for our fixed
// 1000px-wide video box: the natural sticker width (~670px at most) is under the
// 92%-of-crop cap (920px), so `k` is always 1 here.
export const FEEDFORCE_BAND_RESERVE =
  STICKER_GAP + Math.ceil(NATURAL_H) + BOTTOM_MARGIN;

/** Public path of the lockup asset ('black' = dark mark, for light backgrounds). */
export const feedforceStickerSrc = (variant: 'black' | 'white') => `/feedforce-logo-${variant}.svg`;

export interface StickerLayout {
  scale: number;    // uniform shrink applied when the natural sticker is wider than the crop
  height: number;   // total sticker height (lockup + tagline + CTA), scaled
  lockup: { x: number; y: number; w: number; h: number };
  tagline: { x: number; y: number; px: number; w: number };   // x = centre, y = top of the line box
  cta: { x: number; y: number; px: number; w: number };
}

// Centred on `centerX`, sitting STICKER_GAP below `bottomY` (the crop's bottom
// edge), shrunk uniformly to fit `maxW`, and CLAMPED back up when the crop runs
// near the canvas bottom — clamped, never hidden.
export function stickerLayout({ centerX, bottomY, maxW, measure }: {
  centerX: number;
  bottomY: number;
  maxW: number;
  /** Measures a line's width, invoked with (text, fontPx) — e.g. ctx.measureText. */
  measure: (text: string, px: number) => number;
}): StickerLayout {
  const taglineW = measure(FEEDFORCE_TAGLINE, TAGLINE_PX);
  const ctaW = measure(FEEDFORCE_CTA, CTA_PX);
  const lockupW = LOCKUP_H * LOCKUP_AR;
  // The widest row drives the shrink, so no line can overflow the crop.
  const naturalW = Math.max(lockupW, taglineW, ctaW);
  const k = Math.min(1, (maxW * 0.92) / naturalW);   // uniform scale; never enlarge past natural size
  const height = k * NATURAL_H;
  // Clamp, never hide: a crop reaching the canvas bottom pulls the sticker up INTO the frame.
  const y = Math.min(bottomY + STICKER_GAP, CANVAS_H - height - BOTTOM_MARGIN);
  return {
    scale: k,
    height,
    lockup: { x: centerX - (lockupW * k) / 2, y, w: lockupW * k, h: LOCKUP_H * k },
    tagline: { x: centerX, y: y + k * (LOCKUP_H + TAGLINE_GAP), px: TAGLINE_PX * k, w: taglineW * k },
    cta: {
      x: centerX,
      y: y + k * (LOCKUP_H + TAGLINE_GAP + TAGLINE_PX * 1.2 + CTA_GAP),
      px: CTA_PX * k,
      w: ctaW * k,
    },
  };
}

// Pick the lockup variant for the background it sits on: light backgrounds get
// the black mark, dark (or unparseable) backgrounds get the white one — failing
// to white matches the templates' default dark look.
export function stickerVariant(bg: string): 'black' | 'white' {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((bg || '').trim());
  if (!m) return 'white';
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;   // relative luminance of the sRGB bytes
  return lum > 0.6 ? 'black' : 'white';
}
