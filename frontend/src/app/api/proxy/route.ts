import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_HOSTS = [
  'tikwm.com',
  'tiktokcdn.com',
  'tiktokv.com',
  'tiktokcdn-us.com',
  'tokcdn.com',
  'muscdn.app',
  'fastdl.muscdn.app',
  'rapidcdn.app',
  'd.rapidcdn.app',
  'cdninstagram.com',
  'instagram.com',
  'twimg.com',
  'video.twimg.com',
  'pbs.twimg.com',
];

function isAllowedHost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return ALLOWED_HOSTS.some(h => hostname === h || hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  const filename = request.nextUrl.searchParams.get('filename') || 'tiktok-download';
  const stream = request.nextUrl.searchParams.get('stream') === '1';

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  if (!isAllowedHost(url)) {
    return NextResponse.json({ error: 'URL not allowed' }, { status: 403 });
  }

  try {
    const parsedUrl = new URL(url);
    const referer = parsedUrl.hostname.includes('twimg.com')
      ? 'https://x.com/'
      : 'https://www.tiktok.com/';

    const upstreamHeaders: HeadersInit = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': referer,
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
    };
    const range = request.headers.get('Range');
    if (range) {
      upstreamHeaders['Range'] = range;
    }

    // Follow redirects manually to get the final URL
    const upstream = await fetch(url, {
      headers: upstreamHeaders,
      redirect: 'manual',
    });

    // Handle redirects
    if (upstream.status === 301 || upstream.status === 302 || upstream.status === 307 || upstream.status === 308) {
      const location = upstream.headers.get('location');
      if (location) {
        // Follow the redirect
        const finalResponse = await fetch(location, {
          headers: upstreamHeaders,
        });
        if (!finalResponse.ok) {
          return NextResponse.json({ error: 'Failed to fetch file after redirect' }, { status: 502 });
        }

        return buildProxyResponse(finalResponse, filename, stream);
      }
    }

    if (!upstream.ok) {
      return NextResponse.json({ error: 'Failed to fetch file' }, { status: 502 });
    }

    return buildProxyResponse(upstream, filename, stream);
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json({ error: 'Proxy error' }, { status: 502 });
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
