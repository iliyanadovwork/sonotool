// Pluggable Instagram-comments provider. HikerAPI is the default (pay-as-you-go
// on our key, no IG login). Modeled on serp-provider.ts: normalizes to one shape
// and NEVER throws — every failure is a structured outcome so callers can treat
// comments as a best-effort, non-fatal add-on (never block the caption flow).
//
// The Meta Graph API cannot read another account's comments (own-media only), so
// a scraper is the ONLY path. This is read-only public data; no login, and never
// the operator's own account.

const HIKER_BASE = 'https://api.hikerapi.com';
const HIKER_TIMEOUT_MS = 15_000;

export interface ReelComment {
  text: string;
  likeCount: number;
  username: string;
  createdAt: string | null; // ISO 8601 (HikerAPI returns created_at_utc as a string)
  replyCount: number;
}

export type CommentsOutcome =
  | { ok: true; comments: ReelComment[] }
  | { ok: false; rateLimited: boolean; status: number; detail: string };

export function hasCommentsProvider(): boolean {
  return !!process.env.HIKERAPI_KEY?.trim();
}

// Instagram shortcodes are base64 (this alphabet) of the numeric media pk, so we
// can derive the pk locally and skip a HikerAPI resolve call (1 request/reel
// instead of 2). Falls back to the resolve endpoint if decoding fails.
const IG_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function extractShortcode(url: string): string | null {
  const m = url.match(/instagram\.com\/(?:[^/]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

export function shortcodeToPk(shortcode: string): string | null {
  try {
    const BASE = BigInt(64);
    let pk = BigInt(0);
    for (const ch of shortcode) {
      const idx = IG_ALPHABET.indexOf(ch);
      if (idx < 0) return null;
      pk = pk * BASE + BigInt(idx);
    }
    return pk > BigInt(0) ? pk.toString() : null;
  } catch {
    return null;
  }
}

async function hikerGet(path: string, params: Record<string, string>): Promise<{ ok: true; data: unknown } | { ok: false; rateLimited: boolean; status: number; detail: string }> {
  const key = process.env.HIKERAPI_KEY?.trim();
  if (!key) return { ok: false, rateLimited: false, status: 500, detail: 'HIKERAPI_KEY not set' };
  const url = `${HIKER_BASE}${path}?${new URLSearchParams(params).toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HIKER_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'x-access-key': key, Accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      // HikerAPI: 402 = out of funds, 429 = rate limited — both transient-ish.
      return { ok: false, rateLimited: res.status === 429 || res.status === 402, status: res.status, detail: detail.slice(0, 200) };
    }
    return { ok: true, data: await res.json() };
  } catch (e) {
    const aborted = (e as { name?: string })?.name === 'AbortError';
    return { ok: false, rateLimited: false, status: aborted ? 504 : 502, detail: aborted ? 'HikerAPI request timed out' : ((e as { message?: string })?.message || 'HikerAPI request failed') };
  } finally {
    clearTimeout(timer);
  }
}

// Resolve a reel URL to its media pk — locally from the shortcode, else via the
// HikerAPI resolve endpoint (which returns a bare string pk).
async function resolveMediaPk(reelUrl: string): Promise<{ ok: true; pk: string } | { ok: false; rateLimited: boolean; status: number; detail: string }> {
  const sc = extractShortcode(reelUrl);
  if (sc) {
    const pk = shortcodeToPk(sc);
    if (pk) return { ok: true, pk };
  }
  const r = await hikerGet('/v1/media/pk/from/url', { url: reelUrl });
  if (!r.ok) return r;
  const pk = typeof r.data === 'string' ? r.data.trim() : String(r.data ?? '').trim();
  if (!/^\d+$/.test(pk)) return { ok: false, rateLimited: false, status: 502, detail: 'Could not resolve media pk' };
  return { ok: true, pk };
}

// One raw comment as HikerAPI/instagrapi returns it — every field optional
// because the names differ across v1/v2 shapes.
interface RawComment {
  text?: unknown;
  like_count?: unknown;
  comment_like_count?: unknown;
  likes_count?: unknown;
  user?: { username?: string } | null;
  owner?: { username?: string } | null;
  username?: string;
  created_at_utc?: unknown;
  created_at?: unknown;
  created_time?: unknown;
  child_comment_count?: unknown;
  reply_count?: unknown;
}

// Normalize one raw HikerAPI/instagrapi comment (defensive about field names
// across v1/v2 shapes).
export function normalizeComment(raw: unknown): ReelComment | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as RawComment;
  const text = typeof c.text === 'string' ? c.text.trim() : '';
  if (!text) return null;
  const likeCount = Number(c.like_count ?? c.comment_like_count ?? c.likes_count ?? 0) || 0;
  const username = c.user?.username || c.owner?.username || c.username || '';
  // created_at_utc is an ISO string in v1; tolerate a unix-seconds number too.
  const createdRaw = c.created_at_utc ?? c.created_at ?? c.created_time ?? null;
  let createdAt: string | null = null;
  if (typeof createdRaw === 'string' && createdRaw.trim()) createdAt = createdRaw;
  else if (typeof createdRaw === 'number' && Number.isFinite(createdRaw)) {
    // An out-of-range value (e.g. a microsecond timestamp) yields an Invalid
    // Date, whose toISOString() would THROW — guard it so we never break the
    // never-throws contract; just leave createdAt null when it can't be parsed.
    const d = new Date(createdRaw * 1000);
    createdAt = Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const replyCount = Number(c.child_comment_count ?? c.reply_count ?? 0) || 0;
  return { text, likeCount, username, createdAt, replyCount };
}

// Pull one page of a reel's comments and return the top `limit` by like count.
// Never throws.
export async function fetchTopComments(reelUrl: string, limit = 12): Promise<CommentsOutcome> {
  if (!hasCommentsProvider()) return { ok: false, rateLimited: false, status: 500, detail: 'HIKERAPI_KEY not set' };
  const url = (reelUrl || '').trim();
  // Accept any instagram.com subdomain (www., m., or bare) so a pasted mobile /
  // share URL isn't rejected here when extractShortcode would happily decode it.
  if (!/^https?:\/\/([a-z0-9-]+\.)?instagram\.com\//i.test(url)) {
    return { ok: false, rateLimited: false, status: 400, detail: 'Not an Instagram URL' };
  }

  const pkRes = await resolveMediaPk(url);
  if (!pkRes.ok) return pkRes;

  const res = await hikerGet('/v1/media/comments/chunk', { id: pkRes.pk });
  if (!res.ok) return res;

  // v1 chunk shape is a tuple: [comments[], next_max_id]. Be tolerant of an
  // object wrapper ({ comments: [...] } / { response: {...} }) too.
  const d = res.data as
    | unknown[]
    | { comments?: unknown; response?: { comments?: unknown } | null }
    | null
    | undefined;
  const rawComments: unknown[] = Array.isArray(d)
    ? (Array.isArray(d[0]) ? d[0] : [])
    : Array.isArray(d?.comments) ? d.comments
    : Array.isArray(d?.response?.comments) ? d.response.comments
    : [];

  const comments = rawComments
    .map(normalizeComment)
    .filter((c): c is ReelComment => c !== null)
    .sort((a, b) => b.likeCount - a.likeCount)
    .slice(0, Math.max(1, limit));

  return { ok: true, comments };
}
