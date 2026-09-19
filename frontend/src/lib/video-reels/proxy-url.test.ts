import { describe, it, expect } from 'vitest';
import { proxyStreamUrl, pickBestVideoUrl } from './proxy-url';

describe('proxyStreamUrl', () => {
  it('routes a URL through the video-reels stream proxy, fully encoded', () => {
    const raw = 'https://cdn.example.com/v.mp4?a=1&b=2';
    expect(proxyStreamUrl(raw)).toBe(`/api/video-reels/proxy?stream=1&url=${encodeURIComponent(raw)}`);
  });
});

describe('pickBestVideoUrl', () => {
  it('returns null when there is no usable URL (guards proxyStreamUrl(""))', () => {
    expect(pickBestVideoUrl(null)).toBeNull();
    expect(pickBestVideoUrl(undefined)).toBeNull();
    expect(pickBestVideoUrl({})).toBeNull();
    expect(pickBestVideoUrl({ play: '', hdplay: '', wmplay: '' })).toBeNull();
    // Whitespace-only must also yield null — a photo/licensed-audio response.
    expect(pickBestVideoUrl({ play: '   ' })).toBeNull();
  });

  it('prefers hdplay, then play, then wmplay (first non-empty)', () => {
    // hdplay is TikTok's 1080p no-watermark rendition; play is ~720p. Exporting
    // from `play` silently downscaled every TikTok source.
    expect(pickBestVideoUrl({ play: 'p', hdplay: 'h', wmplay: 'w' })).toBe(proxyStreamUrl('h'));
    expect(pickBestVideoUrl({ play: 'p', hdplay: '', wmplay: 'w' })).toBe(proxyStreamUrl('p'));
    expect(pickBestVideoUrl({ play: '', hdplay: '', wmplay: 'w' })).toBe(proxyStreamUrl('w'));
  });

  it('trims the chosen URL before proxying', () => {
    expect(pickBestVideoUrl({ play: '  https://x/v.mp4  ' })).toBe(proxyStreamUrl('https://x/v.mp4'));
  });
});
