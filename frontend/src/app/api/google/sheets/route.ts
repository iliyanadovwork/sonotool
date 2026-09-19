import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface SheetRow {
  url: string;
  caption: string;
  tag: string;
}

export async function GET(request: NextRequest) {
  const accessToken = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  const searchParams = request.nextUrl.searchParams;
  const spreadsheetId = searchParams.get('spreadsheet_id');
  const startRow = searchParams.get('start_row') || '4';
  const endRow = searchParams.get('end_row') || '32';
  const sheetName = searchParams.get('sheet_name') || 'Sheet1';

  if (!accessToken) {
    return NextResponse.json({ error: 'Access token is required' }, { status: 401 });
  }

  if (!spreadsheetId) {
    return NextResponse.json({ error: 'Spreadsheet ID is required' }, { status: 400 });
  }

  try {
    const range = `${encodeURIComponent(sheetName)}!A${startRow}:C${endRow}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error('Sheets API error:', response.status, responseText);
      return NextResponse.json(
        { error: `API Error (${response.status}): ${responseText}` },
        { status: response.status }
      );
    }

    const data = JSON.parse(responseText) as { values?: string[][] };
    const values = data.values;

    if (!values || values.length === 0) {
      return NextResponse.json({ rows: [] });
    }

    const rows: SheetRow[] = values
      .map((row: string[]) => {
        const url = row[0]?.trim() || '';
        if (!url) return null;
        return {
          url,
          caption: row[1]?.trim() || '',
          tag: row[2]?.trim() || '',
        };
      })
      .filter((row): row is SheetRow => row !== null);

    return NextResponse.json({ rows });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch spreadsheet data';
    console.error('Sheets fetch error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
