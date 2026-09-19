import { NextRequest, NextResponse } from 'next/server';
import { getGoogleToken, googleFetch, GoogleAuthError } from '@/lib/video-reels/google-token-storage';
import { isAbortError } from '@/lib/video-reels/fetch-timeout';

export const runtime = 'nodejs';

// The slice of the Sheets `spreadsheets.get` response this route reads.
interface SpreadsheetMetadata {
  sheets?: Array<{
    properties: { sheetId?: number; title?: string; index?: number };
  }>;
  properties?: { title?: string };
}

/**
 * GET /api/video-reels/google/sheets/metadata
 *
 * Fetches spreadsheet metadata including available sheets
 * Query params: spreadsheet_id
 */
export async function GET(request: NextRequest) {
  const tokenData = await getGoogleToken();

  if (!tokenData) {
    return NextResponse.json(
      { error: 'Not connected to Google. Please connect your account first.' },
      { status: 401 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const spreadsheetId = searchParams.get('spreadsheet_id');

  if (!spreadsheetId) {
    return NextResponse.json(
      { error: 'Spreadsheet ID is required' },
      { status: 400 }
    );
  }

  try {
    // Get spreadsheet metadata to fetch sheet names
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;

    console.log('[Google Sheets Metadata] Fetching from:', url);

    const response = await googleFetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Google Sheets Metadata] API error:', error);
      return NextResponse.json(
        { error: `API Error (${response.status}): ${response.statusText}` },
        { status: response.status }
      );
    }

    const data: SpreadsheetMetadata = await response.json();

    // Extract sheet information
    const sheets = data.sheets?.map((sheet) => ({
      id: sheet.properties.sheetId,
      title: sheet.properties.title,
      index: sheet.properties.index,
    })) || [];

    console.log('[Google Sheets Metadata] Found', sheets.length, 'sheets');

    return NextResponse.json({
      sheets,
      spreadsheetTitle: data.properties?.title || '',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : undefined;
    console.error('[Google Sheets Metadata] Fetch error:', message || error);

    // Refresh failed definitively — tell the client to reconnect Google.
    if (error instanceof GoogleAuthError) {
      return NextResponse.json(
        { error: 'Please reconnect your Google account.' },
        { status: 401 }
      );
    }
    // Upstream timed out — surface as a gateway timeout.
    if (isAbortError(error)) {
      return NextResponse.json(
        { error: 'Google request timed out. Please try again.' },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { error: message || 'Failed to fetch spreadsheet metadata' },
      { status: 500 }
    );
  }
}
