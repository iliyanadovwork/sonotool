import { NextRequest, NextResponse } from 'next/server';
import { safeImageUrl, fetchImageGuarded } from '@/lib/remoteImage';

export const runtime = 'nodejs';

// Proxies a remote image so it loads SAME-ORIGIN. Used to display search results (raw web
// "original" URLs that frequently block hotlinking and lack CORS). Picked photos are
// downloaded to storage instead (see /api/photos/save); this route is for the grid preview
// and for validating which results are actually usable.
//
// THIS ROUTE TAKES A URL FROM THE CALLER AND FETCHES IT, so it is an SSRF sink and is
// treated as one:
//   - the host is checked against lib/ssrf on every redirect hop, not just the first;
//   - the response is capped in bytes, so it cannot be used to stream an unbounded body;
//   - the response is NOT CORS-shared. It used to send `Access-Control-Allow-Origin: *`,
//     which let any site on the internet drive this proxy from a visitor's browser. The
//     grid is same-origin and never needed it.
export async function GET(req: NextRequest) {
  const u = safeImageUrl(req.nextUrl.searchParams.get('url'));
  if (!u) return NextResponse.json({ error: 'bad or disallowed url' }, { status: 400 });

  try {
    const result = await fetchImageGuarded(u);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    return new NextResponse(result.body, {
      headers: {
        'Content-Type': result.contentType,
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
