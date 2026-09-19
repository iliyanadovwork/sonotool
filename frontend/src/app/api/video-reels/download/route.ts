import { NextRequest, NextResponse } from 'next/server';
import { decodeHtmlEntities, cleanDescription } from '@/lib/video-reels/text-clean';

// Force Node.js runtime for CommonJS dependencies
export const runtime = 'nodejs';
// A slow tikwm response plus short-URL resolution can exceed the platform
// default timeout; give the route headroom so it isn't killed mid-fetch.
export const maxDuration = 60;

// Timeout for external API calls (30 seconds)
const API_TIMEOUT = 30000;
// TikTok resolution is retried with backoff on transient failures.
const MAX_TIKWM_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Thrown values are `unknown`; these narrow to the shape we actually read
// (name / message) without asserting the value is a real Error.
type ErrorLike = { name?: unknown; message?: unknown };

function asErrorLike(e: unknown): ErrorLike {
  return (typeof e === 'object' && e !== null ? e : {}) as ErrorLike;
}

// The thrown value's message when it has one, otherwise the value itself (logs).
function errDetail(e: unknown): unknown {
  return asErrorLike(e).message || e;
}

function isTikTokUrl(url: string): boolean {
  return /tiktok\.com/i.test(url) || /vm\.tiktok\.com/i.test(url);
}

function isInstagramUrl(url: string): boolean {
  return /instagram\.com/i.test(url);
}

async function resolveShortUrl(url: string): Promise<string> {
  // Short links (vm./vt.tiktok.com) can redirect through more than one hop.
  // Follow up to 5 hops; if resolution fails we fall back to the current URL
  // (tikwm can resolve short URLs itself, so this is best-effort).
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    if (!/(?:vm|vt)\.tiktok\.com/i.test(current)) break;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(current, {
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const location = response.headers.get('location');
      if (!location) break;
      // Resolve relative redirects against the current URL.
      current = new URL(location, current).toString();
      console.log('Resolved short URL hop', hop, '→', current);
    } catch (e) {
      console.error('Failed to resolve short URL hop', hop, e);
      break;
    }
  }
  return current;
}

// tikwm's payload is forwarded to the client verbatim, so only the fields this
// route reads are named; everything else rides along untouched.
interface TikwmData {
  id?: string;
  title?: string;
  play?: string;
  hdplay?: string;
  wmplay?: string;
  [key: string]: unknown;
}

type TikwmAttempt =
  | { ok: true; data: TikwmData }
  | { ok: false; retryable: boolean; status: number; message: string };

// A single tikwm resolution attempt, classified so the caller can decide
// whether to retry (transient) or fail fast (permanent, e.g. video not found).
async function attemptTikwm(resolvedUrl: string): Promise<TikwmAttempt> {
  const form = new URLSearchParams({ url: resolvedUrl, hd: '1' });
  let res: Response;
  try {
    res = await fetchWithTimeout('https://www.tikwm.com/api/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
  } catch (e: unknown) {
    const err = asErrorLike(e);
    const timedOut = err.name === 'AbortError' || /abort/i.test(String(err.message ?? ''));
    return {
      ok: false,
      retryable: true,
      status: timedOut ? 504 : 502,
      message: timedOut ? 'Downloader timed out. Please try again.' : 'Could not reach the downloader. Please try again.',
    };
  }

  if (!res.ok) {
    console.error('TikWM API error:', res.status, res.statusText);
    // 5xx / 429 are transient and worth retrying; other 4xx are not.
    const retryable = res.status >= 500 || res.status === 429;
    return { ok: false, retryable, status: 502, message: 'Upstream service error' };
  }

  const json = await res.json();

  if (json.code !== 0) {
    console.error('TikWM error:', json);
    const errorMsg: string = json.msg || 'Failed to fetch TikTok video';
    const isRateLimit = /rate limit/i.test(errorMsg);
    const isNotFound = /not found/i.test(errorMsg);
    const isInvalid = /url parsing|invalid/i.test(errorMsg);
    let message = errorMsg;
    if (isNotFound) message = 'Video not found. The link may be private, deleted, or invalid.';
    else if (isRateLimit) message = 'Too many requests. Please wait a moment and try again.';
    else if (isInvalid) message = 'Invalid TikTok URL. Please check the link and try again.';
    // Only rate-limiting is transient; not-found / invalid are permanent.
    return { ok: false, retryable: isRateLimit, status: isRateLimit ? 429 : 400, message };
  }

  // Validate the payload actually contains a playable URL. tikwm sometimes
  // returns code:0 with empty play fields (photo posts / partial outages),
  // which would otherwise become a silently-broken canvas downstream.
  const data = json.data;
  const hasPlayable = [data?.play, data?.hdplay, data?.wmplay].some(
    (u) => typeof u === 'string' && /^https?:\/\//i.test(u)
  );
  if (!hasPlayable) {
    return { ok: false, retryable: true, status: 502, message: 'Downloader returned no playable video URL. Please try again.' };
  }

  return { ok: true, data };
}

// Best-effort Instagram post description. instagram-url-direct's post_info is
// brittle (its formatPostInfo throws if owner / like-count / etc. is missing,
// losing the caption with it), so the primary path often yields nothing. As a
// fallback, fetch the public reel page as a crawler and read og:description,
// which Instagram still serves for public posts. Returns '' on any failure.
async function fetchInstagramDescriptionOg(url: string): Promise<string> {
  try {
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          // A crawler UA gets the server-rendered og: tags for public posts.
          'User-Agent': 'Mozilla/5.0 (compatible; facebookexternalhit/1.1; +http://www.facebook.com/externalhit_uatext.php)',
          Accept: 'text/html',
        },
      },
      12000
    );
    if (!res.ok) return '';
    const html = await res.text();
    const meta = html.match(/property=["']og:description["'][^>]*content="([^"]*)"/i)
      || html.match(/content="([^"]*)"[^>]*property=["']og:description["']/i);
    if (!meta) return '';
    const raw = decodeHtmlEntities(meta[1]);
    // IG format: `<n> likes, <n> comments - <user> on <date>: "<caption>"`.
    // Prefer the quoted caption; otherwise take everything after the last ": ".
    const quoted = raw.match(/:\s*"([\s\S]+)"\s*$/);
    if (quoted) return quoted[1].trim();
    const afterColon = raw.match(/:\s*([\s\S]+)$/);
    return (afterColon ? afterColon[1] : '').trim();
  } catch {
    return '';
  }
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = API_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

type InstagramDownloader = (url: string) => Promise<{
  result?: Array<{
    url: string;
    filename?: string;
    thumbnail?: string;
    type?: string;
  }>;
  error?: string;
}>;

export async function POST(request: NextRequest) {
  let url: string;
  try {
    const body = await request.json();
    url = body.url;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!url?.trim()) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  const trimmedUrl = url.trim();

  try {
    // Detect platform
    if (isTikTokUrl(trimmedUrl)) {
      // Resolve short URL first
      const resolvedUrl = await resolveShortUrl(trimmedUrl);

      // Retry transient failures (rate limit / 5xx / network / empty payload)
      // with exponential backoff + jitter; fail fast on permanent errors.
      let result: TikwmAttempt | null = null;
      for (let attempt = 0; attempt < MAX_TIKWM_ATTEMPTS; attempt++) {
        if (attempt > 0) {
          await sleep(Math.min(2000, 300 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 200));
        }
        result = await attemptTikwm(resolvedUrl);
        if (result.ok) {
          console.log('TikTok video fetched successfully:', result.data?.id, attempt > 0 ? `(attempt ${attempt + 1})` : '');
          // tikwm's `title` is the post description (the AI-caption topic seed) —
          // clean the same noise (hashtags/@handles/emoji/CTA) we strip for IG.
          if (result.data && typeof result.data.title === 'string') {
            result.data.title = cleanDescription(result.data.title);
          }
          return NextResponse.json(result.data);
        }
        if (!result.retryable) break;
        console.warn(`[download] tikwm attempt ${attempt + 1}/${MAX_TIKWM_ATTEMPTS} failed (retryable): ${result.message}`);
      }

      return NextResponse.json({ error: result!.message }, { status: result!.status });
    }

    if (isInstagramUrl(trimmedUrl)) {
      // Instagram has no single reliable free extractor, so we try several with
      // DIFFERENT backends and take whichever first yields a playable URL:
      //   1. ruhend-scraper igdl  — most capable in testing (gets reels the
      //      others can't, incl. ones tikwm-style scrapers fail on)
      //   2. btch-downloader igdl
      //   3. instagram-url-direct
      // Reels Instagram blocks for ALL of these (rare) surface a clear 422
      // below rather than a silent blank / stuck spinner.
      let igUrl = '';
      let igCover = '';
      // The post's description (caption) — used downstream as the AI-caption
      // topic. Only instagram-url-direct exposes it, so it's best-effort.
      let igTitle = '';
      // Per-backend failure reasons, surfaced in the error response so a bulk run's
      // log shows WHY extraction failed (rate-limit / login-required vs private vs
      // outage) instead of a single catch-all message.
      const attemptErrors: string[] = [];
      const shortErr = (e: unknown) =>
        String((e as { message?: unknown })?.message ?? e ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);

      // --- Attempt 1: ruhend-scraper igdl (most capable; returns an array of
      // direct mp4 URLs). Its backend is occasionally flaky, so retry a couple
      // times with backoff before falling through to the others. ---
      let ruhendErr = '';
      try {
        const { igdl } = await import('ruhend-scraper');
        for (let attempt = 0; attempt < 3 && !igUrl; attempt++) {
          if (attempt > 0) await sleep(600 * attempt);
          try {
            const r: unknown = await igdl(trimmedUrl);
            const candidate = Array.isArray(r) ? r[0] : undefined;
            if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) {
              igUrl = candidate;
              console.log(`[download] Instagram fetched via ruhend-scraper${attempt ? ` (attempt ${attempt + 1})` : ''}`);
            } else {
              ruhendErr = 'no url';
            }
          } catch (e: unknown) {
            ruhendErr = shortErr(e);
            console.warn(`[download] ruhend-scraper attempt ${attempt + 1} failed:`, errDetail(e));
          }
        }
      } catch (e: unknown) {
        ruhendErr = shortErr(e);
        console.warn('[download] ruhend-scraper import failed, trying next:', errDetail(e));
      }
      if (!igUrl) attemptErrors.push(`ruhend: ${ruhendErr || 'no url'}`);

      // --- Attempt 2: btch-downloader igdl ---
      if (!igUrl) {
        try {
          const { igdl } = await import('btch-downloader');
          const data = await igdl(trimmedUrl) as Awaited<ReturnType<InstagramDownloader>>;
          const first = data?.result?.find(
            (r) => r && typeof r.url === 'string' && /^https?:\/\//i.test(r.url)
          );
          if (first?.url) {
            igUrl = first.url;
            igCover = first.thumbnail || '';
            console.log('[download] Instagram fetched via btch-downloader');
          } else {
            attemptErrors.push(`btch: ${data?.error ? shortErr(data.error) : 'no url'}`);
          }
        } catch (e: unknown) {
          attemptErrors.push(`btch: ${shortErr(e)}`);
          console.warn('[download] btch-downloader threw, trying next:', errDetail(e));
        }
      }

      // --- Attempt 3: instagram-url-direct (different backend) ---
      if (!igUrl) {
        try {
          const { instagramGetUrl } = await import('instagram-url-direct');
          const r = await instagramGetUrl(trimmedUrl);
          const videoDetail = (r.media_details || []).find(
            (m) => m?.type === 'video' && typeof m.url === 'string'
          );
          const candidate = videoDetail?.url || (r.url_list || [])[0];
          if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) {
            igUrl = candidate;
            igCover = videoDetail?.thumbnail || '';
            console.log('[download] Instagram fetched via instagram-url-direct');
          } else {
            attemptErrors.push('iud: no video');
          }
          igTitle = r?.post_info?.caption || '';
        } catch (e: unknown) {
          attemptErrors.push(`iud: ${shortErr(e)}`);
          console.warn('[download] instagram-url-direct failed:', errDetail(e));
        }
      }

      // If an earlier extractor won the URL race, still try to pull the post's
      // description via instagram-url-direct (bounded so a slow metadata call
      // can't hold up the video fetch). Purely best-effort.
      if (igUrl && !igTitle) {
        try {
          const { instagramGetUrl } = await import('instagram-url-direct');
          const meta = await Promise.race([
            instagramGetUrl(trimmedUrl),
            sleep(12000).then(() => null),
          ]);
          igTitle = meta?.post_info?.caption || '';
          if (igTitle) console.log('[download] Instagram description via post_info (', igTitle.length, 'chars)');
        } catch (e: unknown) {
          console.warn('[download] Instagram post_info fetch failed (non-fatal):', errDetail(e));
        }
      }

      // Fallback: og:description off the public reel page (survives cases where
      // instagram-url-direct's metadata parse throws).
      if (igUrl && !igTitle) {
        igTitle = await fetchInstagramDescriptionOg(trimmedUrl);
        if (igTitle) console.log('[download] Instagram description via og:description (', igTitle.length, 'chars)');
      }

      if (igUrl && !igTitle) {
        console.warn('[download] Instagram: no description found for', trimmedUrl);
      }

      // Both extractors failed — fail explicitly (no silent blank / stuck spinner).
      if (!/^https?:\/\//i.test(igUrl)) {
        const detail = attemptErrors.join(' · ');
        console.error('[download] Instagram: no playable URL for', trimmedUrl, '—', detail);
        return NextResponse.json(
          {
            error: 'Could not extract a video from this Instagram link. It may be private, download-restricted, or use licensed audio.',
            detail: detail || undefined,
          },
          { status: 422 }
        );
      }

      // Transform response to match the expected format
      const result = {
        id: Date.now().toString(),
        title: cleanDescription(igTitle),
        cover: igCover,
        author: {
          uniqueId: 'instagram',
          nickname: 'Instagram User',
          avatarThumb: '',
        },
        play: igUrl,
        wmplay: igUrl,
        hdplay: igUrl,
        duration: 0,
        size: 0,
      };

      console.log('Instagram video fetched successfully');
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Unsupported URL. Please provide a TikTok or Instagram URL.' }, { status: 400 });
  } catch (error: unknown) {
    console.error('Download error:', errDetail(error));

    const err = asErrorLike(error);
    if (err.name === 'AbortError' || String(err.message ?? '').includes('abort')) {
      return NextResponse.json({ error: 'Request timeout. The server took too long to respond.' }, { status: 504 });
    }

    const message = error instanceof Error ? error.message : 'Failed to fetch video data';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
