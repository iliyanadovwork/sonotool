// ─────────────────────────────────────────────────────────────────────────────
// Preflight for the post pipeline. Run this BEFORE building a carousel.
//
//   npx tsx scripts/preflight.ts          → report what is missing
//   npx tsx scripts/preflight.ts --fix    → also install everything installable
//
// Why this exists. A teammate cloning the repo has the rules and the CLI but not
// the browser binary, the media tools or the keys, and the failures they get are
// opaque: `render` dies with ERR_CONNECTION_REFUSED, `poster` dies with "ffprobe
// not found", `memes` returns an auth error. This names each one, says what it
// costs you, and installs the ones a script is allowed to install.
//
// It deliberately does NOT install system packages itself. Running brew/apt on
// someone's machine is not ours to do; we print the exact command instead.
// ─────────────────────────────────────────────────────────────────────────────

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvLocal } from './load-env';

const run = promisify(execFile);
const FIX = process.argv.includes('--fix');
const ROOT = join(__dirname, '..');

type Tier = 'required' | 'video' | 'optional';
interface Check {
  name: string;
  tier: Tier;
  ok: boolean;
  detail: string;
  /** Runs only with --fix. Absent = a human has to do it. */
  fix?: () => Promise<void>;
  /** Shown when we cannot fix it ourselves. */
  manual?: string;
}

const checks: Check[] = [];
// `which` rather than `command -v` with shell:true — the shell form triggers a Node
// deprecation warning and needlessly concatenates unescaped args.
const has = async (bin: string) => {
  try { await run('which', [bin]); return true; }
  catch { return false; }
};

async function main() {
  loadEnvLocal();

  // ── node modules ──────────────────────────────────────────────────────────
  const nodeModules = existsSync(join(ROOT, 'node_modules'));
  checks.push({
    name: 'npm dependencies', tier: 'required', ok: nodeModules,
    detail: nodeModules ? 'node_modules present' : 'node_modules missing — every script fails',
    fix: async () => { await run('npm', ['install'], { cwd: ROOT, maxBuffer: 1 << 26 }); },
  });

  // ── playwright browser (render.ts + capture.ts both drive chromium) ────────
  let chromium = false;
  try {
    const { stdout } = await run('npx', ['playwright', 'install', '--dry-run', 'chromium'], { cwd: ROOT });
    chromium = !/is not installed|will be installed/i.test(stdout);
  } catch { chromium = false; }
  checks.push({
    name: 'playwright chromium', tier: 'required', ok: chromium,
    detail: chromium ? 'installed' : 'missing — render and capture cannot run',
    fix: async () => { await run('npx', ['playwright', 'install', 'chromium'], { cwd: ROOT, maxBuffer: 1 << 26 }); },
  });

  // ── media tools ───────────────────────────────────────────────────────────
  const brew = await has('brew');
  for (const [bin, why] of [
    ['ffmpeg',  'video slides: cropping letterbox, muxing Reddit audio'],
    ['ffprobe', 'video slides: probing dimensions and duration'],
  ] as const) {
    const present = await has(bin);
    checks.push({
      name: bin, tier: 'video', ok: present,
      detail: present ? 'installed' : `missing — ${why}`,
      manual: brew ? 'brew install ffmpeg' : 'install ffmpeg (apt install ffmpeg / choco install ffmpeg)',
    });
  }
  for (const [bin, why, cmd] of [
    ['yt-dlp', 'pulling a video from a page URL', 'brew install yt-dlp   (or: pipx install yt-dlp)'],
    ['whisper-ctranslate2', 'transcribing a clip before writing about it (rule 23)', 'pipx install whisper-ctranslate2'],
  ] as const) {
    const present = await has(bin);
    checks.push({ name: bin, tier: 'optional', ok: present, detail: present ? 'installed' : `missing — ${why}`, manual: cmd });
  }

  // ── env keys: the only things a script must never invent ───────────────────
  const KEYS: Array<[string, Tier, string]> = [
    ['NEXT_PUBLIC_SUPABASE_URL', 'required', 'the database the posts live in'],
    ['SUPABASE_SECRET_KEY',      'required', 'service-role writes from the CLI'],
    ['TWITTERAPI_IO_KEY',        'optional', 'sourcing posts, memes and mp4s from X (twitterapi.io)'],
    ['BRIA_API_TOKEN',           'optional', 'expand / erase / upscale on images (bria.ai)'],
    ['SERPER_API_KEY',           'optional', 'web search fallback when SearXNG is not running'],
  ];
  for (const [key, tier, why] of KEYS) {
    const present = !!process.env[key];
    checks.push({
      name: key, tier, ok: present,
      detail: present ? 'set' : `not set — ${why}`,
      manual: `add ${key}=... to frontend/.env.local`,
    });
  }

  // ── dev server (render talks to it) ───────────────────────────────────────
  const app = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3011';
  let up = false;
  try { up = (await fetch(app, { signal: AbortSignal.timeout(4000) })).ok; } catch { /* down */ }
  checks.push({
    name: 'dev server', tier: 'required', ok: up,
    detail: up ? `reachable at ${app}` : `not reachable at ${app} — render writes nothing`,
    manual: 'npm run dev   (ASK THE USER FIRST — CLAUDE.md says do not start or restart it yourself)',
  });

  // ── apply fixes ───────────────────────────────────────────────────────────
  if (FIX) {
    for (const c of checks.filter(c => !c.ok && c.fix)) {
      process.stdout.write(`installing ${c.name} ... `);
      try { await c.fix!(); c.ok = true; c.detail = 'installed just now'; console.log('done'); }
      catch (e) { console.log(`FAILED (${(e as Error).message.split('\n')[0].slice(0, 70)})`); }
    }
  }

  // ── report ────────────────────────────────────────────────────────────────
  const label = { required: 'REQUIRED', video: 'VIDEO SLIDES', optional: 'OPTIONAL' } as const;
  for (const tier of ['required', 'video', 'optional'] as Tier[]) {
    const group = checks.filter(c => c.tier === tier);
    console.log(`\n${label[tier]}`);
    for (const c of group) console.log(`  ${c.ok ? 'ok  ' : 'MISS'}  ${c.name.padEnd(26)} ${c.detail}`);
  }

  const todo = checks.filter(c => !c.ok && c.manual);
  if (todo.length) {
    console.log('\nYou need to do these yourself:');
    for (const c of todo) console.log(`  ${c.name.padEnd(26)} ${c.manual}`);
  }
  const fixable = checks.filter(c => !c.ok && c.fix);
  if (fixable.length && !FIX) console.log(`\n${fixable.length} item(s) can be installed for you: re-run with --fix`);

  const blocked = checks.filter(c => !c.ok && c.tier === 'required');
  console.log(blocked.length ? `\nNOT READY — ${blocked.length} required item(s) missing.` : '\nReady to build.');
  process.exit(blocked.length ? 1 : 0);
}

main().catch(e => { console.error('preflight failed:', e instanceof Error ? e.message : e); process.exit(2); });
