// Circular-frame crop transform for artist avatars, shared by the Chart Reels canvas,
// the editor avatars, and the "Frame photo" popup so they all crop identically.
//
//   zoom: >= 1, where 1 = "cover" (fills the circle, no gaps). Larger = zoomed in.
//   panX/panY: pan in units of the circle RADIUS (resolution-independent), so the same
//              frame looks right at a 32px editor avatar and a 1080p export.
export type CircleFrame = { zoom: number; panX: number; panY: number };

export const DEFAULT_FRAME: CircleFrame = { zoom: 1, panX: 0, panY: 0 };

export function normalizeFrame(f?: CircleFrame | null): CircleFrame {
  if (!f) return DEFAULT_FRAME;
  return {
    zoom: Math.max(1, Number.isFinite(f.zoom) ? f.zoom : 1),
    panX: Number.isFinite(f.panX) ? f.panX : 0,
    panY: Number.isFinite(f.panY) ? f.panY : 0,
  };
}

// Clamp pan so the image always covers the circle (no gaps), given the image aspect + zoom.
// Resolution-independent (radius cancels out), so callers don't need the circle size.
export function clampFrame(imgW: number, imgH: number, frame: CircleFrame): CircleFrame {
  const f = normalizeFrame(frame);
  const w0 = imgW || 1;
  const h0 = imgH || 1;
  const maxX = Math.max(0, Math.max(1, w0 / h0) * f.zoom - 1); // = imageDisplayWidth/(2r) - 1
  const maxY = Math.max(0, Math.max(1, h0 / w0) * f.zoom - 1);
  return {
    zoom: f.zoom,
    panX: Math.max(-maxX, Math.min(maxX, f.panX)),
    panY: Math.max(-maxY, Math.min(maxY, f.panY)),
  };
}

// CSS transform that approximates the same crop for an <img class="object-cover"> in a
// round box (used by the small editor avatars; the canvas uses framedDrawRect exactly).
export function frameToCss(frame?: CircleFrame | null): { transform: string; transformOrigin: string } {
  const f = normalizeFrame(frame);
  return { transform: `translate(${f.panX * 50}%, ${f.panY * 50}%) scale(${f.zoom})`, transformOrigin: 'center' };
}

// Destination rect for drawing the FULL image (scaled) inside a circle at (cx,cy,r).
// The caller is expected to have clipped to the circle. Pan is clamped so the circle
// always stays fully covered (no transparent gaps at the edges).
export function framedDrawRect(
  imgW: number, imgH: number, cx: number, cy: number, r: number, frame?: CircleFrame | null,
): { dx: number; dy: number; w: number; h: number } {
  const f = normalizeFrame(frame);
  const w0 = imgW || 1;
  const h0 = imgH || 1;
  const d = 2 * r;
  const base = Math.max(d / w0, d / h0); // cover
  const s = base * f.zoom;
  const w = w0 * s;
  const h = h0 * s;
  let dx = cx - w / 2 + f.panX * r;
  let dy = cy - h / 2 + f.panY * r;
  // keep the circle covered: image left edge <= circle left, image right edge >= circle right
  dx = Math.min(cx - r, Math.max(cx + r - w, dx));
  dy = Math.min(cy - r, Math.max(cy + r - h, dy));
  return { dx, dy, w, h };
}
