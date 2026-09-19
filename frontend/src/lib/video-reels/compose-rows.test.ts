import { describe, it, expect } from 'vitest';
import { normalizeComposeRows, resolveWriteTarget } from './compose-rows';

describe('normalizeComposeRows', () => {
  it('returns [] for a non-array / garbage payload (never throws)', () => {
    expect(normalizeComposeRows(null)).toEqual([]);
    expect(normalizeComposeRows(undefined)).toEqual([]);
    expect(normalizeComposeRows({})).toEqual([]);
    expect(normalizeComposeRows('nope')).toEqual([]);
    expect(normalizeComposeRows([])).toEqual([]);
  });

  it('keeps only rows with a finite sheetRow', () => {
    expect(
      normalizeComposeRows([
        { url: 'a', sheetRow: 5 },
        { url: 'b' }, // no sheetRow
        { url: 'c', sheetRow: undefined },
        { url: 'd', sheetRow: 'x' }, // NaN
      ]),
    ).toEqual([{ url: 'a', caption: '', sheetRow: 5 }]);
  });

  it('trims the URL and defaults a missing caption', () => {
    expect(normalizeComposeRows([{ url: '  https://x/v  ', caption: 'hi', sheetRow: 4 }])).toEqual([
      { url: 'https://x/v', caption: 'hi', sheetRow: 4 },
    ]);
    expect(normalizeComposeRows([{ sheetRow: 4 }])).toEqual([{ url: '', caption: '', sheetRow: 4 }]);
  });

  it('coerces a numeric-string sheetRow to a number', () => {
    expect(normalizeComposeRows([{ url: 'a', sheetRow: '7' }])).toEqual([{ url: 'a', caption: '', sheetRow: 7 }]);
  });

  it('drops non-positive / non-integer sheetRows (rows are 1-based; Number("")===0)', () => {
    expect(
      normalizeComposeRows([
        { url: 'a', sheetRow: 0 },
        { url: 'b', sheetRow: -3 },
        { url: 'c', sheetRow: 2.5 },
        { url: 'd', sheetRow: '' }, // Number('') === 0
        { url: 'e', sheetRow: null }, // Number(null) === 0
        { url: 'ok', sheetRow: 9 },
      ]),
    ).toEqual([{ url: 'ok', caption: '', sheetRow: 9 }]);
  });

  it('skips non-object list entries', () => {
    expect(normalizeComposeRows(['x', null, 3, { url: 'a', sheetRow: 2 }])).toEqual([
      { url: 'a', caption: '', sheetRow: 2 },
    ]);
  });

  it('preserves order and multiple rows', () => {
    expect(
      normalizeComposeRows([
        { url: 'r4', caption: 'c4', sheetRow: 4 },
        { url: 'r5', caption: '', sheetRow: 5 },
      ]),
    ).toEqual([
      { url: 'r4', caption: 'c4', sheetRow: 4 },
      { url: 'r5', caption: '', sheetRow: 5 },
    ]);
  });
});

describe('resolveWriteTarget', () => {
  it('prefers the load-time context over the live inputs (the wrong-sheet-write fix)', () => {
    expect(resolveWriteTarget({ spreadsheetId: 'ctxId', sheetName: 'SheetA' }, 'liveId', 'SheetB')).toEqual({
      spreadsheetId: 'ctxId',
      sheetName: 'SheetA',
    });
  });

  it('falls back to the trimmed live inputs when there is no context', () => {
    expect(resolveWriteTarget(null, '  liveId  ', '  SheetB  ')).toEqual({ spreadsheetId: 'liveId', sheetName: 'SheetB' });
    expect(resolveWriteTarget(undefined, 'liveId', 'SheetB')).toEqual({ spreadsheetId: 'liveId', sheetName: 'SheetB' });
  });

  it('does not let an empty context field blank the target (uses live instead)', () => {
    expect(resolveWriteTarget({ spreadsheetId: '', sheetName: '' }, 'liveId', 'SheetB')).toEqual({
      spreadsheetId: 'liveId',
      sheetName: 'SheetB',
    });
  });

  it('resolves each field independently for a partial/mixed context', () => {
    // context has a spreadsheet id but a blank sheet name → id from context, name from live.
    expect(resolveWriteTarget({ spreadsheetId: 'ctxId', sheetName: '' }, 'liveId', 'SheetB')).toEqual({
      spreadsheetId: 'ctxId',
      sheetName: 'SheetB',
    });
    // ...and the reverse.
    expect(resolveWriteTarget({ spreadsheetId: '', sheetName: 'SheetA' }, 'liveId', 'SheetB')).toEqual({
      spreadsheetId: 'liveId',
      sheetName: 'SheetA',
    });
  });
});
