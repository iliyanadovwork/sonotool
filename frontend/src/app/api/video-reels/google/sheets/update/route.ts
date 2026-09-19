import { NextRequest, NextResponse } from 'next/server';
import { getGoogleToken, googleFetch, GoogleAuthError } from '@/lib/video-reels/google-token-storage';
import { isAbortError } from '@/lib/video-reels/fetch-timeout';
import { isLockedCaptionCell, prependCaption } from '@/lib/video-reels/caption-cell';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const tokenData = await getGoogleToken();

  if (!tokenData) {
    return NextResponse.json(
      { error: 'Not connected to Google. Please connect your account first.' },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { spreadsheetId, sheetName, rowNumber, status, column, value, onlyIfEmpty, prepend } = body;

    // Two call shapes: legacy { status } writes column E; generic { column,
    // value } writes a whitelisted column (B = overlay caption, F = topic).
    const col: string | undefined = column ?? (status !== undefined ? 'E' : undefined);
    const val: string | undefined = column !== undefined ? value : status;

    if (!spreadsheetId || !sheetName || rowNumber === undefined || !col || val === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: spreadsheetId, sheetName, rowNumber, and status (or column + value)' },
        { status: 400 }
      );
    }
    if (!['B', 'E', 'F'].includes(col)) {
      return NextResponse.json({ error: `Unsupported column: ${col}` }, { status: 400 });
    }

    const range = `${encodeURIComponent(sheetName)}!${col}${rowNumber}`;
    const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;

    // Read the cell's current value. Both guards below fail CLOSED on a read
    // error: dropping a write is the cheap outcome, clobbering isn't.
    const readCurrentValue = async (): Promise<{ ok: true; value: string } | { ok: false; status: number }> => {
      const readRes = await googleFetch(readUrl, { headers: { Accept: 'application/json' } });
      if (!readRes.ok) return { ok: false, status: readRes.status };
      const readData = await readRes.json();
      const raw = readData.values?.[0]?.[0];
      // Numeric/boolean cells come back unquoted — String() before trimming.
      return { ok: true, value: raw === undefined || raw === null ? '' : String(raw) };
    };

    // What actually gets written. `prepend` may rewrite it from the live cell.
    let finalVal = val;

    // prepend: the extraction contract for column B. {…} means the cell is
    // locked by hand and the row is skipped; an existing value gets the new
    // caption prepended; an empty cell is a plain write. Resolved server-side
    // because the client's copy of B is a snapshot from when rows were
    // imported and may no longer match the sheet.
    if (prepend) {
      const read = await readCurrentValue();
      if (!read.ok) {
        return NextResponse.json(
          { error: `Could not read ${col}${rowNumber} to prepend into (${read.status}) — write skipped` },
          { status: 502 }
        );
      }
      if (isLockedCaptionCell(read.value)) {
        return NextResponse.json({ success: true, skipped: true, reason: 'locked', value: read.value });
      }
      finalVal = prependCaption(val, read.value);
    } else if (onlyIfEmpty) {
      // onlyIfEmpty: never clobber a cell the user already filled by hand.
      const read = await readCurrentValue();
      if (!read.ok) {
        return NextResponse.json(
          { error: `Could not verify ${col}${rowNumber} is empty (${read.status}) — write skipped` },
          { status: 502 }
        );
      }
      if (read.value.trim()) {
        return NextResponse.json({ success: true, skipped: true, reason: 'not-empty' });
      }
    }

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`;

    const response = await googleFetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        values: [[finalVal]],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Google Sheets Update] API error:', errorText);
      return NextResponse.json(
        { error: `Failed to update sheet: ${response.statusText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('[Google Sheets Update] Successfully updated row', rowNumber);

    // `value` is what actually landed in the cell — with prepend that's the
    // composed string, which the caller needs to mirror into its own state.
    return NextResponse.json({ success: true, value: finalVal, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : undefined;
    console.error('[Google Sheets Update] Error:', message || error);

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
      { error: message || 'Failed to update spreadsheet' },
      { status: 500 }
    );
  }
}
