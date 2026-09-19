// Representative ("vivid average") colour of an image, used to colour chart lines
// per-artist. Chroma-weighted in linear-light sRGB so a saturated accent dominates
// over a large flat/grey background; falls back to a plain average when the image
// has no chroma. Returns null on failure (no 2D context / no opaque pixels).
//
// Shared by Chart Reels (ChartsCanvas) and the Video Reels landing animation so both
// derive line colours identically. The image MUST be CORS-clean (crossOrigin
// 'anonymous'); a tainted image makes getImageData throw — callers should catch and
// use FALLBACK_LINE_COLOR.
export const FALLBACK_LINE_COLOR = '#9ca3af';

export function avgColorFromImage(img: HTMLImageElement): string | null {
  const toLinear = (c: number) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const toSrgb = (l: number) =>
    l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  const maxDim = 1024;
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const CHROMA_POW = 2;
  let rl = 0;
  let gl = 0;
  let bl = 0;
  let wSum = 0;
  let rlFlat = 0;
  let glFlat = 0;
  let blFlat = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 16) continue; // skip near-transparent pixels
    const sr = data[i] / 255;
    const sg = data[i + 1] / 255;
    const sb = data[i + 2] / 255;
    const chroma = Math.max(sr, sg, sb) - Math.min(sr, sg, sb);
    const lr = toLinear(sr);
    const lg = toLinear(sg);
    const lb = toLinear(sb);
    const cw = Math.pow(chroma, CHROMA_POW);
    rl += cw * lr;
    gl += cw * lg;
    bl += cw * lb;
    wSum += cw;
    rlFlat += lr;
    glFlat += lg;
    blFlat += lb;
    n += 1;
  }
  const useWeighted = wSum > 1e-3;
  const denom = useWeighted ? wSum : n;
  if (denom <= 0) return null;
  const er = useWeighted ? rl : rlFlat;
  const eg = useWeighted ? gl : glFlat;
  const eb = useWeighted ? bl : blFlat;
  return `rgb(${Math.round(toSrgb(er / denom) * 255)},${Math.round(toSrgb(eg / denom) * 255)},${Math.round(toSrgb(eb / denom) * 255)})`;
}
