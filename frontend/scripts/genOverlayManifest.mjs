// Regenerate src/app/components/overlayLibrary.ts from whatever overlay textures are currently
// in the Supabase bucket. Run from frontend/:  node scripts/genOverlayManifest.mjs

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';

const BUCKET = 'overlay-textures';
const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

async function listIds(prefix) {
  const ids = new Set();
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 100, offset });
    if (error) { console.error('list', prefix, ':', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    for (const o of data) { const m = o.name.match(/^(\d+)\.jpe?g$/i); if (m) ids.add(m[1]); }
    if (data.length < 100) break;
  }
  return ids;
}
const fullIds  = await listIds('overlays');
const thumbIds = await listIds('overlays/thumbs');
const sorted = [...fullIds].filter(id => thumbIds.has(id)).sort();   // only ids with both full + thumb
console.log(`full: ${fullIds.size}, thumbs: ${thumbIds.size}, complete: ${sorted.length}`);

const out = `// AUTO-GENERATED — developer overlay-texture library hosted in the Supabase "${BUCKET}" bucket.
// Regenerate with scripts/genOverlayManifest.mjs (or scripts/uploadOverlays.mjs when adding more).
export const OVERLAY_BUCKET = '${BUCKET}';
export const OVERLAY_IDS: string[] = ${JSON.stringify(sorted)};
const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const overlayUrl = (id: string) => \`\${BASE}/storage/v1/object/public/${BUCKET}/overlays/\${id}.jpg\`;
export const overlayThumbUrl = (id: string) => \`\${BASE}/storage/v1/object/public/${BUCKET}/overlays/thumbs/\${id}.jpg\`;
`;
writeFileSync(new URL('../src/app/components/overlayLibrary.ts', import.meta.url), out);
console.log(`manifest written: ${sorted.length} overlays`);
