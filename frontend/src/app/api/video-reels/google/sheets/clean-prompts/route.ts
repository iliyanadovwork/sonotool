import { NextRequest, NextResponse } from 'next/server';
import { getGoogleToken, googleFetch, GoogleAuthError } from '@/lib/video-reels/google-token-storage';
import { isAbortError } from '@/lib/video-reels/fetch-timeout';
import { cleanDescription } from '@/lib/video-reels/text-clean';

export const runtime = 'nodejs';

// Retro-clean existing column-F prompts over a row range: decode HTML entities
// and strip hashtags / @handles / emoji / promo CTAs (same cleanDescription used
// when extracting descriptions). One batch read + one batch write for the range.
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
    const { spreadsheetId, sheetName, startRow, endRow } = body;
    const start = parseInt(String(startRow), 10);
    const end = parseInt(String(endRow), 10);
    if (!spreadsheetId || !sheetName || isNaN(start) || isNaN(end) || start < 1 || end < start) {
      return NextResponse.json(
        { error: 'Missing/invalid fields: spreadsheetId, sheetName, startRow, endRow' },
        { status: 400 }
      );
    }

    // 1. Read the whole F column for the range in one call.
    const range = `${encodeURIComponent(sheetName)}!F${start}:F${end}`;
    const readRes = await googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!readRes.ok) {
      const errorText = await readRes.text();
      console.error('[Clean Prompts] Failed to read column F:', errorText);
      return NextResponse.json({ error: `Failed to read sheet: ${readRes.statusText}` }, { status: readRes.status });
    }
    const readData = await readRes.json();
    const rows: string[][] = readData.values ?? [];

    // 2. Build the full-range output, cleaning each non-empty cell. Trailing
    // empty cells omitted by the API are padded so alignment is preserved.
    const totalRows = end - start + 1;
    const out: string[][] = [];
    let changed = 0;
    let preserved = 0;
    for (let i = 0; i < totalRows; i++) {
      const original = (rows[i]?.[0] ?? '');
      const cleaned = cleanDescription(original);
      // Safety net for a destructive bulk write: NEVER blank a cell that had
      // content. If cleaning removed everything (an all-noise cell, or an
      // unforeseen edge case), leave the original untouched.
      if (cleaned === '' && original.trim() !== '') {
        out.push([original]);
        preserved++;
        continue;
      }
      if (cleaned !== original.trim()) changed++;
      out.push([cleaned]);
    }

    if (changed === 0) {
      return NextResponse.json({ success: true, changed: 0, total: totalRows, preserved });
    }

    // 3. Write the cleaned column back in one call.
    const writeRes = await googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: out }),
      }
    );
    if (!writeRes.ok) {
      const errorText = await writeRes.text();
      console.error('[Clean Prompts] Failed to write column F:', errorText);
      return NextResponse.json({ error: `Failed to write sheet: ${writeRes.statusText}` }, { status: writeRes.status });
    }

    console.log(`[Clean Prompts] Cleaned ${changed}/${totalRows} column-F cell(s) in rows ${start}-${end}${preserved ? ` (${preserved} all-noise cell(s) left untouched)` : ''}`);
    return NextResponse.json({ success: true, changed, total: totalRows, preserved });
  } catch (error) {
    const message = error instanceof Error ? error.message : undefined;
    console.error('[Clean Prompts] Error:', message || error);
    if (error instanceof GoogleAuthError) {
      return NextResponse.json({ error: 'Please reconnect your Google account.' }, { status: 401 });
    }
    if (isAbortError(error)) {
      return NextResponse.json({ error: 'Google request timed out. Please try again.' }, { status: 504 });
    }
    return NextResponse.json({ error: message || 'Failed to clean prompts' }, { status: 500 });
  }
}
