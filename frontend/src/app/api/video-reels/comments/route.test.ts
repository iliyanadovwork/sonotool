import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the provider so we can assert the route's own logic in isolation: the
// limit clamp and the outcome→HTTP-status mapping. (The provider itself is
// covered by comments-provider.test.ts.)
vi.mock('@/lib/video-reels/comments-provider', () => ({
  hasCommentsProvider: vi.fn(() => true),
  fetchTopComments: vi.fn(),
}));

import { POST } from './route';
import { fetchTopComments, hasCommentsProvider } from '@/lib/video-reels/comments-provider';

const mockFetch = vi.mocked(fetchTopComments);
const mockHas = vi.mocked(hasCommentsProvider);
const REEL = 'https://www.instagram.com/reel/X/';

// The route only calls request.json(), so a minimal stub is enough.
function req(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/video-reels/comments — limit clamp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHas.mockReturnValue(true);
    mockFetch.mockResolvedValue({ ok: true, comments: [] });
  });

  it('clamps a limit above 50 down to 50', async () => {
    await POST(req({ url: REEL, limit: 999 }));
    expect(mockFetch).toHaveBeenCalledWith(REEL, 50);
  });

  it('clamps a limit below 1 up to 1 (0 and negatives)', async () => {
    await POST(req({ url: REEL, limit: 0 }));
    expect(mockFetch).toHaveBeenLastCalledWith(REEL, 1);
    await POST(req({ url: REEL, limit: -5 }));
    expect(mockFetch).toHaveBeenLastCalledWith(REEL, 1);
  });

  it('truncates a fractional limit', async () => {
    await POST(req({ url: REEL, limit: 7.9 }));
    expect(mockFetch).toHaveBeenCalledWith(REEL, 7);
  });

  it('defaults a non-numeric limit to 12', async () => {
    // NB: a string 'abc' hits the default; {limit: NaN} would serialize to null
    // over the wire and clamp to 1, so it must NOT be used to test the default.
    await POST(req({ url: REEL, limit: 'abc' }));
    expect(mockFetch).toHaveBeenCalledWith(REEL, 12);
  });

  it('defaults an omitted limit to 12', async () => {
    await POST(req({ url: REEL }));
    expect(mockFetch).toHaveBeenCalledWith(REEL, 12);
  });
});

describe('POST /api/video-reels/comments — status mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHas.mockReturnValue(true);
  });

  it('maps a rate-limited outcome (even a 402) to HTTP 429 so the client backs off', async () => {
    mockFetch.mockResolvedValue({ ok: false, rateLimited: true, status: 402, detail: 'out of funds' });
    const res = await POST(req({ url: REEL }));
    expect(res.status).toBe(429);
  });

  it('passes a non-IG 400 through unchanged', async () => {
    mockFetch.mockResolvedValue({ ok: false, rateLimited: false, status: 400, detail: 'Not an Instagram URL' });
    const res = await POST(req({ url: 'https://tiktok.com/x' }));
    expect(res.status).toBe(400);
  });

  it('coerces a sub-400 failure status to HTTP 502', async () => {
    mockFetch.mockResolvedValue({ ok: false, rateLimited: false, status: 200, detail: 'weird upstream' });
    const res = await POST(req({ url: REEL }));
    expect(res.status).toBe(502);
  });

  it('returns the top comments on success', async () => {
    mockFetch.mockResolvedValue({ ok: true, comments: [{ text: 'hi', likeCount: 3, username: 'u', createdAt: null, replyCount: 0 }] });
    const res = await POST(req({ url: REEL }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ comments: [{ text: 'hi', likeCount: 3, username: 'u', createdAt: null, replyCount: 0 }] });
  });
});

describe('POST /api/video-reels/comments — guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, comments: [] });
  });

  it('returns 500 when the provider is not configured (no key)', async () => {
    mockHas.mockReturnValue(false);
    const res = await POST(req({ url: REEL }));
    expect(res.status).toBe(500);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 400 when url is missing', async () => {
    mockHas.mockReturnValue(true);
    const res = await POST(req({ limit: 5 }));
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 400 on an unparseable body', async () => {
    mockHas.mockReturnValue(true);
    const bad = { json: async () => { throw new Error('bad json'); } } as unknown as Parameters<typeof POST>[0];
    const res = await POST(bad);
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
