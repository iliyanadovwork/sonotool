import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractShortcode,
  shortcodeToPk,
  normalizeComment,
  fetchTopComments,
  hasCommentsProvider,
} from './comments-provider';

describe('extractShortcode', () => {
  it('pulls the code from every reel/post URL shape', () => {
    expect(extractShortcode('https://www.instagram.com/reel/DbL6n0ggXDZ/')).toBe('DbL6n0ggXDZ');
    expect(extractShortcode('https://instagram.com/reels/ABC_123-x/')).toBe('ABC_123-x');
    expect(extractShortcode('https://www.instagram.com/p/CwarXCstShL/?igsh=x')).toBe('CwarXCstShL');
    expect(extractShortcode('https://www.instagram.com/tv/XYZ/')).toBe('XYZ');
    // with a username segment before the media type
    expect(extractShortcode('https://www.instagram.com/nasa/reel/DbL6n0ggXDZ/')).toBe('DbL6n0ggXDZ');
  });
  it('returns null for non-Instagram or shapeless URLs', () => {
    expect(extractShortcode('https://www.tiktok.com/@x/video/123')).toBeNull();
    expect(extractShortcode('https://instagram.com/nasa/')).toBeNull();
    expect(extractShortcode('not a url')).toBeNull();
  });
});

describe('shortcodeToPk', () => {
  it('decodes a real shortcode to its exact media pk', () => {
    // Verified live against HikerAPI: this code IS this pk.
    expect(shortcodeToPk('DbL6n0ggXDZ')).toBe('3948507321457537241');
  });
  it('rejects invalid characters and empties', () => {
    expect(shortcodeToPk('has space')).toBeNull();
    expect(shortcodeToPk('bad!char')).toBeNull();
    expect(shortcodeToPk('')).toBeNull();
  });
});

describe('normalizeComment', () => {
  const base = { text: 'nice', like_count: 5, user: { username: 'alice' }, created_at_utc: '2026-07-24T18:50:54Z', child_comment_count: 2 };

  it('maps the confirmed v1 field names', () => {
    expect(normalizeComment(base)).toEqual({ text: 'nice', likeCount: 5, username: 'alice', createdAt: '2026-07-24T18:50:54Z', replyCount: 2 });
  });
  it('keeps an ISO created_at_utc string as-is and converts a unix-seconds number', () => {
    expect(normalizeComment({ ...base, created_at_utc: undefined, created_at: 1700000000 })!.createdAt).toBe(new Date(1700000000 * 1000).toISOString());
  });
  it('defaults missing like_count to 0 and never lets replyCount fall back to likes', () => {
    const c = normalizeComment({ text: 'x', like_count: undefined, child_comment_count: undefined })!;
    expect(c.likeCount).toBe(0);
    expect(c.replyCount).toBe(0); // NOT the like count
    expect(c.username).toBe(''); // no user object → empty, not undefined/throw
  });
  it('normalizes a bare {text} comment to all-safe defaults', () => {
    // A deleted/hidden account can arrive with no user and no timestamps.
    expect(normalizeComment({ text: 'x' })).toEqual({ text: 'x', likeCount: 0, username: '', createdAt: null, replyCount: 0 });
  });
  it('never throws on an out-of-range numeric timestamp (leaves createdAt null)', () => {
    // A microsecond value would make new Date(n*1000).toISOString() throw.
    let c: ReturnType<typeof normalizeComment>;
    expect(() => { c = normalizeComment({ text: 'x', created_at: 1.7e15 }); }).not.toThrow();
    expect(c!.createdAt).toBeNull();
  });
  it('tolerates the v2 like field name', () => {
    expect(normalizeComment({ text: 'x', comment_like_count: 9 })!.likeCount).toBe(9);
  });
  it('drops empty-text and non-object comments (returns null)', () => {
    expect(normalizeComment({ text: '   ', like_count: 99 })).toBeNull();
    expect(normalizeComment(null)).toBeNull();
    expect(normalizeComment('nope')).toBeNull();
    expect(normalizeComment(undefined)).toBeNull();
  });
});

// A fetch stub only ever needs the handful of Response bits the provider reads;
// `json` deliberately stays open (the tests feed it every wrapper shape).
type MockResponse = Partial<Response> & { json?: () => Promise<unknown>; text?: () => Promise<string> };

function mockFetchOnce(impl: () => MockResponse) {
  const fn = vi.fn().mockImplementation(async () => impl());
  vi.stubGlobal('fetch', fn);
  return fn;
}

// Return a different response per successive fetch call (for the two-call
// resolve → comments path).
function mockFetchSequence(impls: Array<() => MockResponse>) {
  let i = 0;
  const fn = vi.fn().mockImplementation(async () => (impls[Math.min(i++, impls.length - 1)])());
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('fetchTopComments', () => {
  const REEL = 'https://www.instagram.com/reel/DbL6n0ggXDZ/';
  const PK = '3948507321457537241';
  const raw = (over: Record<string, unknown> = {}) => ({ text: 't', like_count: 5, user: { username: 'u' }, created_at_utc: '2026-07-24T18:50:54Z', ...over });

  beforeEach(() => { process.env.HIKERAPI_KEY = 'test-key'; });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.HIKERAPI_KEY; });

  it('returns the top comments sorted by likes desc and sliced to the limit', async () => {
    const fetchFn = mockFetchOnce(() => ({ ok: true, status: 200, headers: new Headers(), json: async () => [[raw({ like_count: 3, text: 'a' }), raw({ like_count: 10, text: 'b' }), raw({ like_count: 1, text: 'c' })], null] }));
    const r = await fetchTopComments(REEL, 2);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.comments.map((c) => c.likeCount)).toEqual([10, 3]); // sorted desc, sliced to 2
      expect(r.comments[0].text).toBe('b');
    }
    // Local shortcode decode → only ONE HikerAPI call (comments), no resolve call.
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const calledUrl = fetchFn.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/v1/media/comments/chunk');
    expect(calledUrl).toContain(`id=${PK}`);
    expect(calledUrl).not.toContain('/pk/from/url');
  });

  it('handles the flat object-wrapper shape AND normalizes fields correctly', async () => {
    mockFetchOnce(() => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ comments: [raw({ like_count: 7 })] }) }));
    const r = await fetchTopComments(REEL, 5);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.comments).toHaveLength(1);
      // Not just length — assert the whole normalized shape so a mis-mapped
      // field (e.g. likeCount stuck at 0) can't pass silently.
      expect(r.comments[0]).toEqual({ text: 't', likeCount: 7, username: 'u', createdAt: '2026-07-24T18:50:54Z', replyCount: 0 });
    }
  });

  it('tolerates the nested response.comments wrapper shape', async () => {
    mockFetchOnce(() => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ response: { comments: [raw({ like_count: 8, text: 'nested' })] } }) }));
    const r = await fetchTopComments(REEL, 5);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.comments).toHaveLength(1); expect(r.comments[0].text).toBe('nested'); }
  });

  it('returns an empty list (never errors) on a garbage 200 error-envelope body', async () => {
    mockFetchOnce(() => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ exc_type: 'ClientError', message: 'boom' }) }));
    const r = await fetchTopComments(REEL, 5);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.comments).toEqual([]);
  });

  it('accepts a non-www instagram subdomain and still decodes locally (one call)', async () => {
    const fetchFn = mockFetchOnce(() => ({ ok: true, status: 200, headers: new Headers(), json: async () => [[raw()], null] }));
    const r = await fetchTopComments('https://m.instagram.com/reel/DbL6n0ggXDZ/', 5);
    expect(r.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0] as string).not.toContain('/pk/from/url');
  });

  it('falls back to the resolve endpoint when the shortcode cannot be decoded locally', async () => {
    // A /share/ URL passes the IG host guard but has no decodable shortcode, so
    // resolveMediaPk must hit /v1/media/pk/from/url (bare-string pk) first.
    const fetchFn = mockFetchSequence([
      () => ({ ok: true, status: 200, headers: new Headers(), json: async () => '3948507321457537241' }),
      () => ({ ok: true, status: 200, headers: new Headers(), json: async () => [[raw({ like_count: 4, text: 'z' })], null] }),
    ]);
    const r = await fetchTopComments('https://www.instagram.com/share/BAABBCCDD/', 5);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.comments[0].text).toBe('z');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0][0] as string).toContain('/v1/media/pk/from/url');
    expect(fetchFn.mock.calls[1][0] as string).toContain('/v1/media/comments/chunk');
    expect(fetchFn.mock.calls[1][0] as string).toContain('id=3948507321457537241');
  });

  it('errors 502 (no comments call) when the resolve endpoint returns a non-numeric pk', async () => {
    const fetchFn = mockFetchSequence([
      () => ({ ok: true, status: 200, headers: new Headers(), json: async () => 'not-a-pk' }),
    ]);
    const r = await fetchTopComments('https://www.instagram.com/share/BAABBCCDD/', 5);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(502); expect(r.detail).toBe('Could not resolve media pk'); }
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('classifies a 402 out-of-funds as rate-limited', async () => {
    mockFetchOnce(() => ({ ok: false, status: 402, text: async () => 'out of funds' }));
    const r = await fetchTopComments(REEL, 5);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.rateLimited).toBe(true); expect(r.status).toBe(402); }
  });

  it('rejects a non-Instagram URL without calling the API', async () => {
    const fetchFn = mockFetchOnce(() => ({ ok: true, status: 200, json: async () => [[], null] }));
    const r = await fetchTopComments('https://www.tiktok.com/@x/video/1', 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('reports missing key without throwing', async () => {
    delete process.env.HIKERAPI_KEY;
    expect(hasCommentsProvider()).toBe(false);
    const r = await fetchTopComments(REEL, 5);
    expect(r.ok).toBe(false);
  });

  it('classifies a 429 as rate-limited', async () => {
    mockFetchOnce(() => ({ ok: false, status: 429, text: async () => 'rate limited' }));
    const r = await fetchTopComments(REEL, 5);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.rateLimited).toBe(true); expect(r.status).toBe(429); }
  });

  it('never throws even when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const r = await fetchTopComments(REEL, 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(502);
  });
});
