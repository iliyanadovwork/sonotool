import { NextRequest, NextResponse } from 'next/server'
import { fetchWithTimeout, isAbortError } from '@/lib/video-reels/fetch-timeout'

const BACKEND_URL = process.env.BACKEND_URL || 'https://indextrading-production.up.railway.app'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const res = await fetchWithTimeout(`${BACKEND_URL}/api/waitlist/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (error) {
    console.error('Proxy error:', error)
    if (isAbortError(error)) {
      return NextResponse.json({ error: 'Backend request timed out. Please try again.' }, { status: 504 })
    }
    return NextResponse.json({ error: 'Failed to connect to backend' }, { status: 500 })
  }
}
