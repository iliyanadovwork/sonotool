import { NextRequest, NextResponse } from 'next/server';
import { fetchWithTimeout, isAbortError } from '@/lib/video-reels/fetch-timeout';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const eventId = searchParams.get('eventId');
  const withNestedMarkets = searchParams.get('withNestedMarkets') || 'true';

  if (!eventId) {
    return NextResponse.json(
      { error: 'Event ID is required' },
      { status: 400 }
    );
  }

  const apiUrl = process.env.DFLOW_API_URL || 'https://c.prediction-markets-api.dflow.net';
  const apiKey = process.env.DFLOW_API_KEY;

  if (!apiKey) {
    console.error('DFLOW_API_KEY not found in environment variables');
    return NextResponse.json(
      { error: 'API key not configured' },
      { status: 500 }
    );
  }

  console.log('Making request to:', `${apiUrl}/api/v1/event/${eventId}?withNestedMarkets=${withNestedMarkets}`);
  console.log('API key present:', !!apiKey);

  try {
    // Wrap the DFlow market API call so a hung upstream surfaces as a clean 504.
    const response = await fetchWithTimeout(
      `${apiUrl}/api/v1/event/${eventId}?withNestedMarkets=${withNestedMarkets}`,
      {
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('DFlow API response status:', response.status);

    const data = await response.json();
    console.log('DFlow API response data:', data);

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || data.message || 'Failed to fetch market data', details: data },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Market API error:', error);
    if (isAbortError(error)) {
      return NextResponse.json(
        { error: 'Market data request timed out. Please try again.' },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: 'Failed to fetch market data' },
      { status: 500 }
    );
  }
}
