// ─────────────────────────────────────────────────────────────────────────────
// sheet-captions — read caption-candidate rows from the posts spreadsheet and
// batch-write generated captions back. Companion to the `video-captions` saved
// workflow (.claude/workflows/video-captions.js), which downloads each row's
// video, views its frames, transcribes its audio and writes the caption.
//
//   tsx scripts/sheet-captions.ts read  --tab sonotradeio --start 225 --end 242 [--all]
//   tsx scripts/sheet-captions.ts write --tab sonotradeio --file captions.json
//
// read  → JSON array of {row, url, topic} — by default only rows that NEED a
//         caption (column A url present, column F topic present, column D empty);
//         --all includes filled rows too.
// write → captions.json is {"225": "caption text", ...}; each value is written
//         into column D of that row. Column E (status) is never touched.
//
// Auth: the shared Google connection stored in Supabase (same one the app uses),
// refreshed here when expired — run from frontend/ so .env.local loads.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { loadEnvLocal } from './load-env';

loadEnvLocal();

async function sheetToken(): Promise<string> {
  const { getSharedConnection, setSharedConnection, SHARED_GOOGLE_KEY } = await import('../src/lib/video-reels/meta-db');
  const tok = await getSharedConnection(SHARED_GOOGLE_KEY) as { accessToken?: string; refreshToken?: string } | null;
  if (!tok?.refreshToken) throw new Error('no shared google refresh token — connect Google in the app first');
  const probe = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + encodeURIComponent(tok.accessToken ?? ''));
  if (probe.ok) return tok.accessToken!;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: tok.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`google token refresh failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as { access_token: string };
  await setSharedConnection(SHARED_GOOGLE_KEY, { accessToken: data.access_token, refreshToken: tok.refreshToken });
  return data.access_token;
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : undefined;
}

async function main() {
  const { SHARED_SPREADSHEET_ID } = await import('../src/lib/video-reels/page-config');
  const mode = process.argv[2];
  const tab = flag('tab') ?? 'sonotradeio';

  if (mode === 'read') {
    const start = Number(flag('start')), end = Number(flag('end'));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('read: --start and --end row numbers are required');
    const all = process.argv.includes('--all');
    const range = `${encodeURIComponent(tab)}!A${start}:F${end}`;
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHARED_SPREADSHEET_ID}/values/${range}`, {
      headers: { Authorization: `Bearer ${await sheetToken()}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`sheets read failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as { values?: string[][] };
    // A row NEEDS a caption when it has a video (A) and column D is still empty. The topic
    // note (F) is OPTIONAL context, not a requirement — the captioner watches the video
    // itself, so a row with no note is still workable (just less pre-chewed). Columns B
    // (the post's own caption/title) and C (tag) ride along as extra context when present.
    const out = (data.values ?? []).flatMap((row, i) => {
      const url = (row[0] ?? '').trim(), captionD = (row[3] ?? '').trim(), topic = (row[5] ?? '').trim();
      if (!all && (!url || captionD)) return [];
      const title = (row[1] ?? '').trim(), tag = (row[2] ?? '').trim();
      return [{
        row: start + i, url, topic,
        ...(title ? { title } : {}), ...(tag ? { tag } : {}),
        ...(all ? { caption: captionD } : {}),
      }];
    });
    console.log(JSON.stringify(out, null, 1));
    return;
  }

  if (mode === 'write') {
    const file = flag('file');
    if (!file) throw new Error('write: --file <captions.json> is required ({"row": "caption", ...})');
    const map = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
    const entries = Object.entries(map);
    if (!entries.length) throw new Error('write: captions file is empty');
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHARED_SPREADSHEET_ID}/values:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await sheetToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: entries.map(([row, caption]) => ({ range: `${tab}!D${row}`, values: [[caption]] })),
      }),
    });
    if (!res.ok) throw new Error(`sheets write failed: ${res.status} ${await res.text()}`);
    console.log(JSON.stringify({ ok: true, tab, wrote: entries.map(([r]) => Number(r)) }));
    return;
  }

  throw new Error("usage: sheet-captions.ts read --tab <tab> --start N --end M [--all] | write --tab <tab> --file captions.json");
}

main().catch(e => { console.error('ERROR:', e?.message ?? e); process.exit(1); });
