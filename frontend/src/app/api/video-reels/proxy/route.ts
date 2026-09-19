import { NextRequest, NextResponse } from 'next/server';
import { isAbortError } from '@/lib/video-reels/fetch-timeout';

export const runtime = 'nodejs';
// Streaming a video through the function can take a while on slow CDNs; give it
// headroom, and bound each upstream fetch with a timeout below.
export const maxDuration = 60;

const PROXY_TIMEOUT = 45000;

// Hosts the proxy may fetch. These URLs only ever originate from our own
// /api/video-reels/download response (TikTok/Instagram CDNs). tikwm rotates across several
// ByteDance/TikTok CDN families, so this list must cover them or playback and
// download intermittently 403 with "URL not allowed".
const ALLOWED_HOSTS = [
  'tikwm.com',
  'tiktok.com',
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'tiktokcdn-eu.com',
  'tiktokv.com',
  'tiktokv.us',
  'tokcdn.com',
  'byteoversea.com',
  'ibyteimg.com',
  'ipstatp.com',
  'muscdn.app',
  'fastdl.muscdn.app',
  'muscdn.com',
  'rapidcdn.app',
  'd.rapidcdn.app',
  'cdninstagram.com',
  'fbcdn.net',
  'instagram.com',
];

function isAllowedHost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return ALLOWED_HOSTS.some(h => hostname === h || hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeout = PROXY_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(request: NextRequest) {
  // Try to get URL from query param first
  let url = request.nextUrl.searchParams.get('url');

  // For testing: also check x-test-url header (used by integration tests)
  if (!url) {
    url = request.headers.get('x-test-url') || '';
  }

  const filename = request.nextUrl.searchParams.get('filename') || 'tiktok-download';
  const stream = request.nextUrl.searchParams.get('stream') === '1';

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  if (!isAllowedHost(url)) {
    return NextResponse.json({ error: 'URL not allowed' }, { status: 403 });
  }

  try {
    const upstreamHeaders: HeadersInit = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.tiktok.com/',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
    };
    const range = request.headers.get('Range');
    if (range) {
      upstreamHeaders['Range'] = range;
    }

    // Resolve redirects manually so EVERY hop is re-validated against the
    // allowlist — otherwise an allowed CDN could 3xx-pivot the proxy to an
    // arbitrary/internal host. Bounded to a few hops.
    let current = url;
    let response = await fetchWithTimeout(current, {
      headers: upstreamHeaders,
      redirect: 'manual',
    });
    for (let hop = 0; hop < 5; hop++) {
      const s = response.status;
      if (s !== 301 && s !== 302 && s !== 307 && s !== 308) break;
      const location = response.headers.get('location');
      if (!location) break;
      const target = new URL(location, current).toString();
      if (!isAllowedHost(target)) {
        return NextResponse.json({ error: 'Redirect to disallowed host' }, { status: 403 });
      }
      current = target;
      response = await fetchWithTimeout(current, {
        headers: upstreamHeaders,
        redirect: 'manual',
      });
    }

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch file' }, { status: 502 });
    }

    return buildProxyResponse(response, filename, stream);
  } catch (error: unknown) {
    const timedOut = isAbortError(error);
    console.error('Proxy error:', error);
    return NextResponse.json(
      { error: timedOut ? 'Upstream timed out' : 'Proxy error' },
      { status: timedOut ? 504 : 502 }
    );
  }
}

function buildProxyResponse(upstream: Response, filename: string, stream: boolean): NextResponse {
  let contentType = upstream.headers.get('Content-Type') || '';

  // Fix incorrect content types for video
  if (contentType.includes('octet-stream') || contentType.includes('charset=UTF-8')) {
    contentType = 'video/mp4';
  }

  const contentLength = upstream.headers.get('Content-Length');

  const headers = new Headers();
  if (!stream) {
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);
  }
  headers.set('Content-Type', contentType);
  if (contentLength) headers.set('Content-Length', contentLength);

  // CORS headers for video playback
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Range, Content-Type');
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

  // Preserve range-related headers for video playback when present
  const acceptRanges = upstream.headers.get('Accept-Ranges');
  const contentRange = upstream.headers.get('Content-Range');
  if (acceptRanges) headers.set('Accept-Ranges', acceptRanges);
  if (contentRange) headers.set('Content-Range', contentRange);

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
