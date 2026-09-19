// Helpers for safely fetching remote images server-side (the photo proxy + save-to-storage
// routes). Picked search images are arbitrary web URLs, so every fetch goes through the one
// SSRF guard in lib/ssrf.ts, follows redirects BY HAND so each hop is re-checked, and is
// capped in bytes so an attacker cannot stream an unbounded body through the server.

import { hostIsPublic } from '@/lib/ssrf';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Cheap syntactic check: shape and scheme only. Says NOTHING about where the host
// resolves — callers must use fetchImageGuarded, which applies the real guard.
export function safeImageUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  return u;
}

// Fetches an image with the guard applied at EVERY redirect hop. `redirect: 'manual'`
// is the point: the default follows redirects itself, so a public host that 302s to
// 169.254.169.254 would be fetched with no second check.
export async function fetchImageGuarded(
  start: URL,
  opts: { maxBytes?: number; maxHops?: number } = {},
): Promise<{ ok: true; body: ArrayBuffer; contentType: string } | { ok: false; status: number; error: string }> {
  const maxBytes = opts.maxBytes ?? MAX_IMAGE_BYTES;
  let u = start;

  for (let hop = 0; hop <= (opts.maxHops ?? 4); hop++) {
    if (!(await hostIsPublic(u.hostname))) {
      return { ok: false, status: 400, error: 'blocked host' };
    }

    const res = await fetch(u.toString(), {
      headers: imageFetchHeaders(u),
      redirect: 'manual',
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return { ok: false, status: 502, error: 'redirect without location' };
      try { u = new URL(loc, u); } catch { return { ok: false, status: 502, error: 'bad redirect target' }; }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        return { ok: false, status: 400, error: 'blocked redirect scheme' };
      }
      continue;
    }

    if (!res.ok) return { ok: false, status: 502, error: `upstream ${res.status}` };

    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/')) return { ok: false, status: 415, error: 'not an image' };

    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > maxBytes) return { ok: false, status: 413, error: 'image too large' };

    // Content-Length is attacker-controlled, so cap the actual stream too.
    const body = await res.arrayBuffer();
    if (body.byteLength > maxBytes) return { ok: false, status: 413, error: 'image too large' };

    return { ok: true, body, contentType };
  }
  return { ok: false, status: 502, error: 'too many redirects' };
}

export function imageFetchHeaders(u: URL): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': `${u.origin}/`,
    'Accept': 'image/avif,image/webp,image/png,image/jpeg,*/*',
  };
}

export const IMAGE_EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};
