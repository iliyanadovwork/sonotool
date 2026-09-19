import { NextRequest, NextResponse } from 'next/server'
import { fetchWithTimeout, isAbortError } from '@/lib/video-reels/fetch-timeout'

const BACKEND_URL = process.env.BACKEND_URL || 'https://indextrading-production.up.railway.app'

// Slim proxy for discover/sidebar/ticker callers.
// Fetches artists-with-history with slim=true, which skips data_points,
// mark_price, funding_rate, change_1h/1w/1y — fields not used by these callers.
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams

    const backendUrl = new URL('/api/artists-with-history', BACKEND_URL)
    searchParams.forEach((value, key) => {
      backendUrl.searchParams.append(key, value)
    })
    backendUrl.searchParams.set('slim', 'true')

    const response = await fetchWithTimeout(backendUrl.toString(), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      next: { revalidate: 60 },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return NextResponse.json(
        { error: errorData.error || 'Failed to fetch data from backend' },
        { status: response.status }
      )
    }

    return NextResponse.json(await response.json())
  } catch (error) {
    console.error('Discover proxy error:', error)
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
