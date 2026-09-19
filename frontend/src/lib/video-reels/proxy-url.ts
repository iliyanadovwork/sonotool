// Route a remote (TikTok/Instagram CDN) video URL through our same-origin
// streaming proxy. Same-origin is required both for CORS-free playback and so
// the video can be drawn to a canvas for frame extraction without tainting it.
export function proxyStreamUrl(url: string): string {
  return `/api/video-reels/proxy?stream=1&url=${encodeURIComponent(url)}`;
}

// Pick the best playable URL from a /api/video-reels/download response and
// return it proxied — or null when there's no usable URL. `data` can be null,
// and any of play/hdplay/wmplay can be missing/empty/whitespace-only (a photo
// post, licensed-audio, or metadata-only response), all of which must yield
// null so callers don't render a broken proxyStreamUrl('') <video>.
//
// hdplay FIRST: for TikTok these are distinct renditions — `hdplay` is the 1080p
// no-watermark cut our download route already pays for with `hd: '1'`, while
// `play` is the ~720p one. Preferring `play` meant every TikTok export was built
// from a downscaled source no matter how high the encode bitrate went. (`wmplay`
// is watermarked, so it stays the last resort.) For Instagram all three hold the
// same URL, so the order is a no-op there.
export function pickBestVideoUrl(
  data: { play?: string; hdplay?: string; wmplay?: string } | null | undefined,
): string | null {
  if (!data) return null;
  const best = [data.hdplay, data.play, data.wmplay]
    .map((u) => (typeof u === 'string' ? u.trim() : ''))
    .find((u) => u.length > 0);
  return best ? proxyStreamUrl(best) : null;
}
