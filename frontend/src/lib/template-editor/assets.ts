// ─────────────────────────────────────────────────────────────────────────────
// Asset upload — put an image into the public `post-images` bucket from Node and
// get back a permanent public URL to drop into an imageBox. Mirrors the editor's
// own uploadPostImage path convention (`${userId}/${ts}_${safeName}`) so CLI-made
// and hand-made designs are indistinguishable. Service-role client (bypasses RLS).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'post-images';

const EXT_CONTENT_TYPE: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  // Video: an ImageBox can carry a `videoUrl` and the canvas draws its live frames,
  // so branding elements (animated logos, stings) upload through the same path.
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
};
const CONTENT_TYPE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/avif': 'avif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};

/** True for the content types that belong in `videoUrl` rather than `url`. */
export function isVideoContentType(ct: string): boolean {
  return ct.startsWith('video/');
}
/** True for a path/URL whose extension is a video we accept. */
export function isVideoPath(p: string): boolean {
  return /\.(mp4|m4v|webm|mov)(\?|#|$)/i.test(p);
}

function sanitize(name: string): string {
  return (name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'image').slice(0, 100);
}

/**
 * Probe a local video for its pixel dimensions and duration via ffprobe.
 *
 * A video box still needs a width and height like any other, and guessing them
 * distorts the asset — so read them rather than defaulting. Returns null when
 * ffprobe is unavailable, letting the caller ask for explicit --width/--height
 * instead of failing outright.
 */
export async function probeVideo(filePath: string): Promise<{ width: number; height: number; duration: number } | null> {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const run = promisify(execFile);
    const { stdout } = await run('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration',
      '-of', 'json', filePath,
    ]);
    const j = JSON.parse(stdout) as { streams?: { width?: number; height?: number }[]; format?: { duration?: string } };
    const st = j.streams?.[0];
    if (!st?.width || !st?.height) return null;
    return { width: st.width, height: st.height, duration: Number(j.format?.duration ?? 0) };
  } catch {
    return null;
  }
}

/**
 * Grab a still frame from a video, for the box's `url`.
 *
 * The headless renderer cannot play video, so a slide exported to PNG would show
 * an empty box. A poster frame means the still export still looks right, while the
 * editor and the MP4 export play the real thing.
 */
export async function videoPosterFrame(filePath: string, atSeconds = 0.1): Promise<Buffer | null> {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { readFile, unlink } = await import('node:fs/promises');
    const run = promisify(execFile);
    const out = join(tmpdir(), `poster-${Date.now()}.png`);
    await run('ffmpeg', ['-v', 'error', '-ss', String(atSeconds), '-i', filePath, '-frames:v', '1', '-y', out]);
    const buf = await readFile(out);
    await unlink(out).catch(() => {});
    return buf;
  } catch {
    return null;
  }
}

export interface UploadResult { url: string; path: string; bytes: number }

export async function put(
  client: SupabaseClient, userId: string, buf: Buffer, name: string, contentType: string,
): Promise<UploadResult> {
  const path = `${userId}/${Date.now()}_${sanitize(name)}`;
  // Supabase storage gateway 502s intermittently — retry a few times before giving up.
  let lastErr = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error } = await client.storage.from(BUCKET).upload(path, buf, { contentType, upsert: true });
    if (!error) {
      const { data } = client.storage.from(BUCKET).getPublicUrl(path);
      return { url: data.publicUrl, path, bytes: buf.length };
    }
    lastErr = error.message;
    if (attempt < 3) await new Promise(r => setTimeout(r, 500 * attempt));
  }
  throw new Error(`upload to ${BUCKET} failed after 3 attempts: ${lastErr}`);
}

/** Upload a local image file; returns its permanent public URL. The extension MUST be a
 *  known image type — this publishes to a world-readable bucket, so an arbitrary path
 *  (e.g. .env.local, an SSH key) must never be uploadable/exfiltratable via this helper. */
export async function uploadImageFile(
  client: SupabaseClient, userId: string, filePath: string,
): Promise<UploadResult> {
  const ext = extname(filePath).toLowerCase();
  const contentType = EXT_CONTENT_TYPE[ext];
  if (!contentType) {
    throw new Error(
      `refusing to upload "${filePath}": not a recognized image extension ` +
      `(${Object.keys(EXT_CONTENT_TYPE).join(', ')}). Only images may be published to the public bucket.`,
    );
  }
  const buf = readFileSync(filePath);
  return put(client, userId, buf, basename(filePath), contentType);
}

// Block mirroring internal/private hosts into a public bucket (defense-in-depth against an
// agent being steered to exfiltrate an internal-only resource). Hostname-level; not a full
// DNS-rebinding defense, but covers the obvious localhost / link-local / RFC1918 targets.
function assertPublicHttpUrl(sourceUrl: string): URL {
  let u: URL;
  try { u = new URL(sourceUrl); } catch { throw new Error(`invalid url: ${sourceUrl}`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`unsupported url scheme: ${u.protocol}`);
  const host = u.hostname.toLowerCase();
  const blocked =
    host === 'localhost' || host === '0.0.0.0' || host.endsWith('.localhost') ||
    host === '169.254.169.254' ||                       // cloud metadata
    /^127\./.test(host) || /^10\./.test(host) ||
    /^192\.168\./.test(host) || /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (blocked) throw new Error(`refusing to fetch a private/loopback host: ${host}`);
  return u;
}

/** Download a remote image and store our own public copy; returns its public URL.
 *  (Survives the source URL dying and is CORS-clean for the render canvas.) */
export async function uploadImageUrl(
  client: SupabaseClient, userId: string, sourceUrl: string,
): Promise<UploadResult> {
  const u = assertPublicHttpUrl(sourceUrl);
  // Send a real browser UA + Accept. Node's bare fetch sends neither, and most
  // image CDNs (Wikimedia, news sites, X's pbs host) answer 400/403 to that —
  // which made sourcing an image by URL fail for nearly every real source.
  const res = await fetch(u, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`fetch failed -> ${res.status} (${u.hostname})`);
  const ct = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!ct.startsWith('image/')) throw new Error(`not an image (content-type: ${ct || 'unknown'})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = CONTENT_TYPE_EXT[ct] ?? 'jpg';
  return put(client, userId, buf, `remote.${ext}`, ct);
}

// ── Image dimension probing (header parsing — Node has no image decoder) ─────
// Supports PNG, JPEG, GIF, WebP (VP8/VP8L/VP8X). Returns null when unrecognized.
export function probeImageDimensions(buf: Buffer): { width: number; height: number } | null {
  // PNG: 8-byte signature + IHDR
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // GIF: "GIF87a"/"GIF89a" + logical screen size (LE)
  if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'GIF') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  // WebP: RIFF….WEBP + VP8 / VP8L / VP8X chunk
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const fourcc = buf.toString('ascii', 12, 16);
    if (fourcc === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (fourcc === 'VP8L') { const b = buf.readUInt32LE(21); return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) }; }
    if (fourcc === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  // JPEG: scan markers for SOFn (baseline/progressive/…)
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) { off++; continue; }
      const marker = buf[off + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { off += 2; continue; }
      off += 2 + buf.readUInt16BE(off + 2);
    }
  }
  return null;
}

/** Fetch an image URL and probe its natural dimensions from the header bytes. */
export async function probeImageUrlDimensions(url: string): Promise<{ width: number; height: number } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return probeImageDimensions(Buffer.from(await res.arrayBuffer()));
  } catch { return null; }
}

/** Resolve any image reference to a stored public URL: an http(s) URL is mirrored; anything
 *  else is treated as a local image file (and rejected unless it has a known image extension). */
export async function resolveImageRef(
  client: SupabaseClient, userId: string, ref: string,
): Promise<UploadResult> {
  return /^https?:\/\//i.test(ref)
    ? uploadImageUrl(client, userId, ref)
    : uploadImageFile(client, userId, ref);
}
