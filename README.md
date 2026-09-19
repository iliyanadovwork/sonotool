# Sonotool

A content-production platform: design a post on a canvas, render it to video in the
browser, and publish it to Instagram, without the assets ever leaving the machine
for a third-party render service.

Next.js 16 / React 19 / TypeScript, Supabase for storage and auth, ~51,000 lines of
source across five sections and 55 API routes. 205 unit tests, `tsc --noEmit` clean.

---

## The parts worth reading

**Client-side video export** (`src/lib/video-reels/`, `src/app/components/TikTokCanvas/`)
The export path decodes the source into raw frames and redraws each one from the exact
render state the preview last used, so the download cannot drift from what was on screen.
WebCodecs (`VideoEncoder`/`VideoDecoder`) with mediabunny for MP4 muxing, across four
modules. Frames flow through a bounded queue with backpressure, and a watchdog fails a
silently stalled decoder rather than hanging forever.

**SSRF guard** (`src/lib/ssrf.ts`, tested in `src/lib/ssrf.test.ts`)
Every server-side fetch of a user-supplied URL goes through one implementation. It
decodes IPv4-mapped IPv6 in dotted *and* hex form, because `new URL()` serialises
`[::ffff:127.0.0.1]` to `::ffff:7f00:1`, a dotted-only check misses it. Redirects are
followed by hand (`redirect: 'manual'`) so every hop is re-validated, and responses are
capped in bytes against the actual stream rather than the attacker-controlled
`Content-Length`.

This used to be two implementations, a hardened one here and a weaker regex copy
guarding the image proxy. They are now one, and `ssrf.test.ts` is what stops a second
appearing. Writing that test also found a bypass in the *good* one: it matched only the
compressed `::ffff:` spelling, so the fully-expanded `0:0:0:0:0:ffff:127.0.0.1`, the
same address, went through. Fixed, with the case pinned.

**Three-tier caption generation** (`src/app/api/posts/instagram/generate-caption/`)
Gemini with Google Search grounding → DeepSeek with a SERP context → OpenRouter. Each
tier is tried in order and the response is streamed, so a slow first tier does not block
the UI. A pool of Gemini keys is tried in priority order rather than a single key.

**In-browser background removal** (`src/lib/`, transformers.js + ONNX)
Runs on the WASM backend deliberately, not WebGPU: the GPU backend loads cleanly and
then fails at inference with no way to fall back, so the slower backend is the correct
one.

---

## Running it

```bash
cd frontend
npm run preflight        # add :fix to auto-install
npm run dev              # port 3011
```

`preflight` installs npm dependencies and the Playwright browser, prints exact commands
for the system tools it deliberately will not install for you (ffmpeg, yt-dlp, whisper),
names which API keys are missing and what each one disables, and exits non-zero when
something required is absent.

```bash
npm test                 # vitest, 205 tests
npx tsc --noEmit         # clean
npm run build
```

## Configuration

Copy `frontend/.env.local.example` to `frontend/.env.local` and fill in what you need.
Nothing is required to boot; each missing key disables a specific feature and
`preflight` tells you which.

| Variable | Enables |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | auth, storage, saved designs |
| `GEMINI_API_KEYS` | grounded caption generation (comma-separated pool) |
| `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY` | caption fallback tiers |
| `SERPER_API_KEY` | search grounding for captions |
| `NEXT_PUBLIC_SHARED_SPREADSHEET_ID` | the Google Sheet backing the video-reels queue |

## Layout

```
frontend/src/app/          routes, 55 API handlers, section components
frontend/src/lib/          ssrf, video-reels, template-editor, shared logic
frontend/scripts/          one-off operational scripts
supabase/                  schema
```

The five sections are `template-editor`, `posts`, `branding`, `chart-reels` and
`video-reels` (`APP_SECTIONS` in `src/app/page.tsx`). `video-reels` is the largest by a
wide margin, 93 files, ~17,900 lines.

## Notes

One collaborator built the Chart Reels section.
