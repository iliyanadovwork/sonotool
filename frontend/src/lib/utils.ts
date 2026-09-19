/** Build a proxied stream URL for cross-origin media playback */
export function proxyStreamUrl(url: string): string {
  return `/api/proxy?stream=1&url=${encodeURIComponent(url)}`;
}

/** Clamp a zoom/scale value to [min, max] */
export function clampZoom(val: number, min = 0.5, max = 3): number {
  return Math.max(min, Math.min(max, val));
}

/** Format seconds as M:SS */
export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** Pick the best video URL from a VideoData-like object, proxied.
 *  hdplay first — it's TikTok's 1080p no-watermark rendition (play is ~720p). */
export function bestVideoUrl(data: { play?: string; hdplay?: string; wmplay?: string }): string {
  return proxyStreamUrl(data.hdplay || data.play || data.wmplay || '');
}
