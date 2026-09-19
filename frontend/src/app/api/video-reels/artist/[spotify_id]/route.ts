import { NextRequest, NextResponse } from 'next/server'
import { fetchWithTimeout, isAbortError } from '@/lib/video-reels/fetch-timeout'

const BACKEND_URL = process.env.BACKEND_URL || 'https://indextrading-production.up.railway.app'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ spotify_id: string }> }
) {
  try {
    const { spotify_id } = await params

    const backendUrl = new URL(`/api/artist/${encodeURIComponent(spotify_id)}`, BACKEND_URL)

    const response = await fetchWithTimeout(backendUrl.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      next: { revalidate: 3600 },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return NextResponse.json(
        { error: errorData.error || 'Failed to fetch data from backend' },
        { status: response.status }
      )
    }

    let data = await response.json()

    // Strip heavy metadata when slim=true (homepage widgets only need price + sparkline)
    if (request.nextUrl.searchParams.get('slim') === 'true' && data.artist) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { biography, events, top_tracks, top_cities, releases, gallery, facebook, instagram, twitter, tiktok, related, ...slim } = data.artist as Record<string, unknown>
      data = { ...data, artist: slim }
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Proxy error:', error)
    if (isAbortError(error)) {
      return NextResponse.json(
        { error: 'Backend request timed out. Please try again.' },
        { status: 504 }
      )
    }
    return NextResponse.json(
      { error: 'Failed to connect to backend service' },
      { status: 500 }
    )
  }
}
