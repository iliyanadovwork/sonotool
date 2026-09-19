// One-off: resize the developer overlay textures (via sharp) and upload them to a public Supabase
// bucket, then write src/app/components/overlayLibrary.ts (the id manifest used by the Elements drawer).
//
// Run from the frontend/ dir:  node scripts/uploadOverlays.mjs
// Resumable + idempotent: skips ids already in the bucket, and the manifest only lists confirmed uploads.

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC    = process.env.OVERLAY_SRC_DIR
  ?? join(process.cwd(), 'assets', 'OverlayTextures');
const BUCKET = 'overlay-textures';
const FULL_MAX = 2048, FULL_Q = 82;   // web overlay
const THUMB_MAX = 400, THUMB_Q = 72;  // gallery thumbnail
const CONCURRENCY = 3;                 // keep peak memory down on the giant source files
const PROGRESS = join(tmpdir(), 'overlay-progress.txt');

sharp.cache(false);       // don't hold decoded images in memory
sharp.concurrency(2);     // bound libvips' own thread pool

const log = (m) => { console.log(m); try { writeFileSync(PROGRESS, m + '\n'); } catch {} };

// ── env ───────────────────────────────────────────────────────────────────────
const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SECRET_KEY;
if (!URL_ || !KEY) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY'); process.exit(1); }
const supabase = createClient(URL_, KEY, { auth: { persistSession: false } });

// ── bucket ────────────────────────────────────────────────────────────────────
const { error: bErr } = await supabase.storage.createBucket(BUCKET, { public: true });
if (bErr && !/exist/i.test(bErr.message)) { console.error('createBucket:', bErr.message); process.exit(1); }

// ── what's already uploaded (resume) ────────────────────────────────────────────
const present = new Set();
for (let offset = 0; ; offset += 100) {
  const { data, error } = await supabase.storage.from(BUCKET).list('overlays', { limit: 100, offset });
  if (error) { console.error('list:', error.message); break; }
  if (!data || data.length === 0) break;
  for (const o of data) { const m = o.name.match(/^(\d+)\.jpe?g$/i); if (m) present.add(m[1]); }
  if (data.length < 100) break;
}

const files = readdirSync(SRC).filter(f => /\.jpe?g$/i.test(f)).sort();
const todo = files.filter(f => !present.has(f.replace(/\.[^.]+$/, '')));
log(`${files.length} source, ${present.size} already uploaded, ${todo.length} to do`);

// ── resize + upload ──────────────────────────────────────────────────────────────
// Uploads occasionally hang (no built-in timeout), which would freeze the whole run — so race
// each upload against a timeout and retry a few times before giving up on that image.
async function uploadWithRetry(path, buf, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const res = await Promise.race([
      supabase.storage.from(BUCKET).upload(path, buf, { contentType: 'image/jpeg', upsert: true }),
      new Promise(resolve => setTimeout(() => resolve({ error: new Error('timeout') }), 30000)),
    ]).catch(e => ({ error: e }));
    if (!res.error) return res;
    await new Promise(r => setTimeout(r, 800 * (i + 1)));   // backoff
  }
  return { error: new Error('failed after retries') };
}

let done = 0, failed = 0;
async function processOne(file) {
  const id = file.replace(/\.[^.]+$/, '');
  try {
    const src = join(SRC, file);
    // Decode the (possibly huge) source once for the full size, then derive the thumb from that
    // small buffer — keeps peak memory low and avoids re-decoding 50MB files.
    const full = await sharp(src, { failOn: 'none', limitInputPixels: false, sequentialRead: true }).rotate()
      .resize({ width: FULL_MAX, height: FULL_MAX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: FULL_Q, mozjpeg: true }).toBuffer();
    const thumb = await sharp(full)
      .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: THUMB_Q, mozjpeg: true }).toBuffer();
    const r1 = await uploadWithRetry(`overlays/${id}.jpg`, full);
    const r2 = await uploadWithRetry(`overlays/thumbs/${id}.jpg`, thumb);
    if (r1.error || r2.error) { failed++; console.error(id, 'upload:', (r1.error || r2.error).message); }
    else present.add(id);
  } catch (e) {
    failed++; console.error(id, 'process:', e.message);
  }
  done++;
  if (done % 5 === 0 || done === todo.length) log(`${done}/${todo.length} (failed ${failed})`);
}

const queue = [...todo];
async function worker() { while (queue.length) await processOne(queue.shift()); }
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

// ── manifest (only confirmed-uploaded ids) ────────────────────────────────────────
const ids = [...present].sort();
const out = `// AUTO-GENERATED by scripts/uploadOverlays.mjs — developer overlay-texture library
// hosted in the Supabase "${BUCKET}" bucket. Do not edit by hand; re-run the script to refresh.
export const OVERLAY_BUCKET = '${BUCKET}';
export const OVERLAY_IDS: string[] = ${JSON.stringify(ids)};
const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const overlayUrl = (id: string) => \`\${BASE}/storage/v1/object/public/${BUCKET}/overlays/\${id}.jpg\`;
export const overlayThumbUrl = (id: string) => \`\${BASE}/storage/v1/object/public/${BUCKET}/overlays/thumbs/\${id}.jpg\`;
`;
writeFileSync(new URL('../src/app/components/overlayLibrary.ts', import.meta.url), out);
log(`done — ${ids.length}/${files.length} present in bucket, manifest written (failed this run: ${failed})`);
