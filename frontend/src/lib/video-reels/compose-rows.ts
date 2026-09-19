// Pure helpers for the sheet-driven Caption Composer's row list (in the
// Generate-AI-Captions modal). Kept out of the component so they're unit-testable
// and there's a single source of truth for the sheet-write target.

export interface ComposeRow {
  url: string;
  caption: string;
  sheetRow: number;
}

// Normalize the raw rows from GET /api/video-reels/google/sheets into the shape
// the compose list needs. Keeps only rows with a valid 1-based sheetRow; trims
// the URL; defaults a missing caption to ''. Tolerant of any JSON value the API
// returns (a non-array yields []), so it never throws on the response body.
export function normalizeComposeRows(rows: unknown): ComposeRow[] {
  if (!Array.isArray(rows)) return [];
  const out: ComposeRow[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const rec = r as Record<string, unknown>;
    // Sheet rows are 1-based integers. Reject 0/negatives/floats/NaN — and note
    // Number('')/Number(null) are 0, so this also drops those junk values.
    const sheetRow = Number(rec.sheetRow);
    if (!Number.isInteger(sheetRow) || sheetRow < 1) continue;
    out.push({
      url: typeof rec.url === 'string' ? rec.url.trim() : '',
      caption: typeof rec.caption === 'string' ? rec.caption : '',
      sheetRow,
    });
  }
  return out;
}

// Decide which sheet a composed caption is written back to. Prefer the context
// captured when the rows were LOADED (so an edit to the live Sheet Name /
// Spreadsheet ID after loading can't redirect the write to the wrong sheet);
// fall back to the (trimmed) live inputs when there's no captured context.
export function resolveWriteTarget(
  context: { spreadsheetId: string; sheetName: string } | null | undefined,
  liveSpreadsheetId: string,
  liveSheetName: string,
): { spreadsheetId: string; sheetName: string } {
  return {
    spreadsheetId: context?.spreadsheetId || liveSpreadsheetId.trim(),
    sheetName: context?.sheetName || liveSheetName.trim(),
  };
}
