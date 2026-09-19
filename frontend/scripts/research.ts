// ─────────────────────────────────────────────────────────────────────────────
// Research toolkit: search, read, and recover deleted pages.
//
// Built after a post shipped thin because research stopped at three walls:
//   * the Claude Code web-search cap (200/session, shared with subagents),
//   * bot-walled pages that 403 every plain fetch,
//   * and content that has since been DELETED, which no live fetch can reach.
//
// Three subcommands, each removing one of those:
//
//   search  — a self-hosted SearXNG meta-search (70+ engines, no key, no quota),
//             falling back to Serper if the container is not up.
//               npx tsx scripts/research.ts search "ken carson cartunez" [--n 15]
//
//   read    — fetch a page and extract just the ARTICLE as markdown, via Mozilla
//             Readability. Raw innerText drags in nav menus and ad slots, which is
//             how a 701-comment thread came back looking like a sitemap.
//               npx tsx scripts/research.ts read <url> [--raw]
//
//   archive — Wayback Machine CDX lookup: every snapshot of a URL over time. The
//             ONLY route to a deleted post. Ken Carson's cartunez tracklist tweet
//             was deleted within hours; a live fetch can never see it.
//               npx tsx scripts/research.ts archive <url> [--limit 20] [--get <ts>]
//
// Node-only. Relative imports so `tsx` resolves without the Next alias.
// ─────────────────────────────────────────────────────────────────────────────

import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { loadEnvLocal } from './load-env';

const SEARX = process.env.SEARXNG_URL || 'http://localhost:8888';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function flagVal(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
}
const has = (argv: string[], name: string): boolean => argv.includes(`--${name}`);

// ── search ───────────────────────────────────────────────────────────────────
async function search(query: string, argv: string[]): Promise<void> {
  const n = Number(flagVal(argv, 'n') ?? 12);
  const url = `${SEARX}/search?q=${encodeURIComponent(query)}&format=json`;
  let results: { title?: string; url?: string; content?: string; engine?: string }[] = [];
  let via = 'searxng';
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`searxng ${r.status}`);
    results = (await r.json()).results ?? [];
  } catch (e) {
    // Fall back rather than fail: the container may simply not be running.
    const key = process.env.SERPER_API_KEY;
    if (!key) throw new Error(`search: SearXNG unreachable at ${SEARX} (${e instanceof Error ? e.message : e}) and SERPER_API_KEY is not set. Start it with:\n  docker run -d --name searxng -p 8888:8080 -v ~/.searxng:/etc/searxng searxng/searxng:latest`);
    via = 'serper';
    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: n }),
    });
    if (!r.ok) throw new Error(`serper ${r.status}`);
    const j = await r.json();
    results = (j.organic ?? []).map((o: Record<string, string>) => ({ title: o.title, url: o.link, content: o.snippet }));
  }
  console.log(JSON.stringify({
    ok: true, via, query, count: results.length,
    results: results.slice(0, n).map(r => ({ title: r.title, url: r.url, snippet: r.content, engine: r.engine })),
  }, null, 2));
}

// ── read ─────────────────────────────────────────────────────────────────────
async function read(url: string, argv: string[]): Promise<void> {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(30_000) });
  const status = r.status;
  const html = await r.text();
  if (has(argv, 'raw')) {
    console.log(JSON.stringify({ ok: true, url, status, chars: html.length, html: html.slice(0, 40_000) }, null, 2));
    return;
  }
  const dom = new JSDOM(html, { url });
  // Readability MUTATES the document, so parse a clone if you ever need the DOM after.
  const article = new Readability(dom.window.document).parse();
  if (!article) {
    console.log(JSON.stringify({ ok: false, url, status, error: 'Readability found no article — try --raw, or capture.ts for a JS-rendered page' }, null, 2));
    return;
  }
  const md = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' }).turndown(article.content ?? '');
  console.log(JSON.stringify({
    ok: true, url, status,
    title: article.title, byline: article.byline, siteName: article.siteName,
    publishedTime: article.publishedTime, chars: md.length,
    markdown: md.length > 30_000 ? `${md.slice(0, 30_000)}\n…[truncated]` : md,
  }, null, 2));
}

// ── archive ──────────────────────────────────────────────────────────────────
async function archive(url: string, argv: string[]): Promise<void> {
  const get = flagVal(argv, 'get');
  if (get) {
    // A specific snapshot, rendered back as readable markdown.
    const snap = `https://web.archive.org/web/${get}/${url}`;
    await read(snap, argv);
    return;
  }
  const limit = Number(flagVal(argv, 'limit') ?? 20);
  const fmt = (ts: string) => `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)} ${ts.slice(8, 10)}:${ts.slice(10, 12)}`;

  // Two Wayback endpoints on DIFFERENT hosts, and they are not equally reachable:
  // the full CDX index and all snapshot replay live on web.archive.org, while the
  // availability probe lives on archive.org. Measured here: archive.org answers
  // 200, web.archive.org times out entirely. So try the rich index, and fall back
  // to the probe rather than reporting "no snapshots" when the truth is "could not
  // ask" — those are very different answers for a fact-check.
  try {
    const cdx = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json&limit=${limit}&collapse=digest&fl=timestamp,original,statuscode,digest`;
    const r = await fetch(cdx, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25_000) });
    if (!r.ok) throw new Error(`CDX ${r.status}`);
    const rows = (await r.json()) as string[][];
    const [, ...data] = rows.length ? rows : [[]];
    console.log(JSON.stringify({
      ok: true, via: 'cdx', url, snapshots: data.length,
      hint: data.length ? 'replay one with --get <timestamp>' : 'no snapshots — the page may never have been archived',
      results: data.map(([ts, original, statuscode]) => ({
        timestamp: ts, when: fmt(ts), statuscode,
        replay: `https://web.archive.org/web/${ts}/${original}`,
      })),
    }, null, 2));
    return;
  } catch (cdxErr) {
    const probe = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
    const r = await fetch(probe, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25_000) });
    if (!r.ok) throw new Error(`archive: CDX failed (${cdxErr instanceof Error ? cdxErr.message : cdxErr}) and the availability probe returned ${r.status}`);
    const j = await r.json() as { archived_snapshots?: { closest?: { timestamp: string; url: string; status: string } } };
    const closest = j.archived_snapshots?.closest;
    console.log(JSON.stringify({
      ok: true, via: 'availability-probe', url,
      snapshots: closest ? 1 : 0,
      note: 'The full CDX index (web.archive.org) is unreachable from this machine, so only the single closest snapshot can be reported, and --get cannot replay it from here. Open the replay URL in a browser.',
      results: closest ? [{ timestamp: closest.timestamp, when: fmt(closest.timestamp), statuscode: closest.status, replay: closest.url }] : [],
    }, null, 2));
  }
}



// A meme reply carries no descriptive text — the image IS the post. Tiling the
// candidates into one numbered PNG is the only way to actually judge them, and
// picking a meme blind from JSON is how you end up shipping an irrelevant one.
async function contactSheet(results: { media: string[]; poster?: string[] }[], out: string): Promise<void> {
  const sharp = (await import('sharp')).default;
  const CELL = 420, COLS = 4, PAD = 10, LABEL = 34;
  const tiles = await Promise.all(results.slice(0, 16).map(async (r, i) => {
    try {
      // For a video row media[0] is an mp4, which sharp cannot decode — tile its poster.
      const src = r.poster?.[0] ?? r.media[0];
      const buf = Buffer.from(await (await fetch(src, { signal: AbortSignal.timeout(20_000) })).arrayBuffer());
      const img = await sharp(buf).resize(CELL, CELL, { fit: 'contain', background: '#111' }).png().toBuffer();
      const tag = Buffer.from(
        `<svg width="${CELL}" height="${LABEL}"><rect width="100%" height="100%" fill="#000"/>` +
        `<text x="8" y="24" font-family="monospace" font-size="20" fill="#0f0">[${i + 1}]</text></svg>`);
      return await sharp({ create: { width: CELL, height: CELL + LABEL, channels: 3, background: '#111' } })
        .composite([{ input: tag, top: 0, left: 0 }, { input: img, top: LABEL, left: 0 }]).png().toBuffer();
    } catch { return null; }
  }));
  const ok = tiles.filter((t): t is Buffer => t !== null);
  if (!ok.length) return;
  const rows = Math.ceil(ok.length / COLS);
  const W = COLS * CELL + (COLS + 1) * PAD, H = rows * (CELL + LABEL) + (rows + 1) * PAD;
  await sharp({ create: { width: W, height: H, channels: 3, background: '#1a1a1a' } })
    .composite(ok.map((input, i) => ({
      input,
      left: PAD + (i % COLS) * (CELL + PAD),
      top: PAD + Math.floor(i / COLS) * (CELL + LABEL + PAD),
    }))).png().toFile(out);
}


// ── reddit memes (Arctic Shift) ──────────────────────────────────────────────
// Reddit's own .json endpoints return 403 to datacenter and script traffic now,
// and the OAuth app flow needs credentials nobody has set up. Arctic Shift is an
// unauthenticated mirror of the same post objects and is current to today, so it
// is the one keyless route to Reddit meme VIDEO. (Giphy's terms forbid this use
// outright and Tenor stopped issuing keys in Jan 2026 — neither is an option.)
const REDDIT_MEME_SUBS = ['memes', 'dankmemes', 'funny', 'MemeVideos', 'PublicFreakout'];

interface RedditHit { title: string; subreddit: string; score: number; url: string; video?: string; hasAudio?: boolean; durationSec?: number; permalink: string; }

async function redditMemes(query: string, subs: string[], n: number): Promise<RedditHit[]> {
  const out: RedditHit[] = [];
  for (const sub of subs) {
    const u = new URL('https://arctic-shift.photon-reddit.com/api/posts/search');
    u.searchParams.set('subreddit', sub);
    u.searchParams.set('limit', '100');
    u.searchParams.set('sort', 'desc');
    if (query) u.searchParams.set('query', query);
    const r = await fetch(u, { signal: AbortSignal.timeout(45_000) }).catch(() => null);
    if (!r?.ok) continue;
    const j = await r.json() as { data?: Record<string, any>[] };   // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const it of j.data ?? []) {
      const rv = (it.secure_media?.reddit_video ?? it.media?.reddit_video) as
        { fallback_url?: string; has_audio?: boolean; duration?: number } | undefined;
      const url = String(it.url ?? '');
      const isImg = /\.(jpe?g|png|gif)$/i.test(url);
      if (!rv?.fallback_url && !isImg) continue;
      out.push({
        title: String(it.title ?? ''), subreddit: String(it.subreddit ?? sub),
        score: Number(it.score ?? 0), url,
        ...(rv?.fallback_url ? { video: rv.fallback_url, hasAudio: !!rv.has_audio, durationSec: rv.duration } : {}),
        permalink: `https://reddit.com${it.permalink ?? ''}`,
      });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, n);
}

// A v.redd.it fallback_url is a SILENT video track even when has_audio is true —
// the audio is a separate file whose name is not in the post JSON, and the old
// DASH_audio.mp4 name 403s on current uploads. Read the DASH manifest for the
// real track names and mux, or you ship a muted meme.
async function fetchRedditVideo(videoUrl: string, outPath: string): Promise<{ muxed: boolean; note?: string }> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const id = videoUrl.match(/v\.redd\.it\/([A-Za-z0-9]+)/)?.[1];
  const vTmp = `${outPath}.video.mp4`;
  await run('curl', ['-sL', '--max-time', '120', '-o', vTmp, videoUrl]);

  let audioName: string | undefined;
  if (id) {
    const mpd = await fetch(`https://v.redd.it/${id}/DASHPlaylist.mpd`, { signal: AbortSignal.timeout(30_000) })
      .then(r => (r.ok ? r.text() : '')).catch(() => '');
    // Highest-numbered AUDIO BaseURL wins; absent entirely on silent uploads.
    audioName = [...mpd.matchAll(/<BaseURL>([^<]*AUDIO[^<]*)<\/BaseURL>/gi)].map(m => m[1]).sort().pop();
  }
  if (!audioName) {
    await run('mv', [vTmp, outPath]);
    return { muxed: false, note: 'no audio track in the DASH manifest — video is silent at source' };
  }
  const aTmp = `${outPath}.audio.mp4`;
  await run('curl', ['-sL', '--max-time', '120', '-o', aTmp, `https://v.redd.it/${id}/${audioName}`]);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', vTmp, '-i', aTmp, '-c', 'copy', '-shortest', outPath]);
  await run('rm', ['-f', vTmp, aTmp]);
  return { muxed: true };
}

// ── memes ────────────────────────────────────────────────────────────────────
// Find the community's REACTION to a story: the jokes, the reaction images, the
// quote-tweets. Meme slides in past posts have all been this — a fan's line about
// the news, not a generic template from a meme site — so the search goes where
// those actually live: X posts about the topic that carry media, ranked by likes.
//
//   research.ts memes "ken carson cartunez" [--min-faves 500] [--video] [--n 20]
//   research.ts memes --replies <statusId>        → mine ONE post's replies
//
// Returns text + engagement + direct media URLs, ready to eyeball and pass to
// canvas.ts add-image.
async function memes(query: string, argv: string[]): Promise<void> {
  const key = process.env.TWITTERAPI_IO_KEY;
  if (!key) throw new Error('memes: TWITTERAPI_IO_KEY is not set in .env.local');
  const n = Number(flagVal(argv, 'n') ?? 20);
  const minFaves = Number(flagVal(argv, 'min-faves') ?? 300);
  const wantVideo = has(argv, 'video');
  const repliesTo = flagVal(argv, 'replies');

  // filter:images / filter:videos is what separates a reaction MEME from a plain
  // hot take; min_faves keeps it to jokes that actually landed with the fanbase.
  if (has(argv, 'reddit')) {
    const subs = (flagVal(argv, 'subs') ?? REDDIT_MEME_SUBS.join(',')).split(',').map(x => x.trim()).filter(Boolean);
    const hits = await redditMemes(query, subs, n);
    const dir = flagVal(argv, 'fetch');
    const fetched: Record<string, unknown>[] = [];
    if (dir) {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(dir, { recursive: true });
      for (const [i, h] of hits.entries()) {
        if (!h.video) continue;
        const out = `${dir}/reddit-${i + 1}.mp4`;
        try { fetched.push({ index: i + 1, out, ...(await fetchRedditVideo(h.video, out)) }); }
        catch (e) { fetched.push({ index: i + 1, error: e instanceof Error ? e.message : String(e) }); }
      }
    }
    const sheet = flagVal(argv, 'sheet');
    if (sheet) await contactSheet(hits.filter(h => !h.video).map(h => ({ media: [h.url] })), sheet);
    console.log(JSON.stringify({
      ok: true, source: 'reddit/arctic-shift', subreddits: subs, count: hits.length,
      sheet: sheet ?? null,
      ...(dir ? { fetched } : {}),
      hint: 'Reddit memes are GENERIC — they are about a mood, never about your specific story. Use them for an emotional beat; use --replies for a joke about the actual news. Videos need --fetch <dir> (the raw URL is a SILENT track).',
      results: hits,
    }, null, 2));
    return;
  }

  const media = wantVideo ? 'filter:videos' : 'filter:images';
  const q = repliesTo
    ? `conversation_id:${repliesTo} ${media}`
    : `${query} ${media} min_faves:${minFaves} -filter:retweets`;

  const url = `https://api.twitterapi.io/twitter/tweet/advanced_search?queryType=Top&query=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { 'X-API-Key': key }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`memes: twitterapi.io returned ${r.status}`);
  const j = await r.json() as { tweets?: Record<string, unknown>[] };

  const out = (j.tweets ?? []).map(t => {
    // extendedEntities is ALWAYS present — as {} when the tweet has no media of
    // its own — so `extendedEntities ?? entities` never falls through: ?? only
    // fires on null/undefined. Pick the first list that actually has entries.
    // A quote-tweet reacting to a video carries the video on the QUOTED tweet,
    // and dropping those silently lost ~10% of reply-mining results.
    const mediaOf = (o: unknown): Record<string, unknown>[] => {
      const e = (o ?? {}) as { extendedEntities?: { media?: Record<string, unknown>[] }; entities?: { media?: Record<string, unknown>[] } };
      return e.extendedEntities?.media?.length ? e.extendedEntities.media
           : e.entities?.media?.length ? e.entities.media
           : [];
    };
    const own = mediaOf(t);
    const ent = { media: own.length ? own : mediaOf(t.quoted_tweet) };
    // A video tweet's media_url_https is only the POSTER FRAME. The playable file
    // lives in video_info.variants, mixed in with an HLS playlist we cannot feed
    // to ffmpeg as simply — so take the highest-bitrate video/mp4 and keep the
    // thumbnail separately (the contact sheet needs something sharp can decode).
    const posters: string[] = [];
    const mediaUrls = (ent.media ?? []).map(m => {
      const poster = (m.media_url_https ?? m.media_url) as string | undefined;
      const info = m.video_info as { variants?: { url?: string; bitrate?: number; content_type?: string }[] } | undefined;
      const isVideo = m.type === 'video' || m.type === 'animated_gif';
      if (isVideo && info?.variants?.length) {
        const best = info.variants
          .filter(v => v.content_type === 'video/mp4' && v.url)
          .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
        if (best?.url) { if (poster) posters.push(poster); return best.url; }
      }
      if (isVideo) return undefined;   // video with no mp4 variant is unusable
      // ?name=orig gets the full-resolution original rather than a timeline thumb.
      return poster ? `${poster}?name=orig` : undefined;
    }).filter((u): u is string => typeof u === 'string');
    const a = (t.author ?? {}) as { userName?: string };
    // X marks whether the uploader permits downloads. It is not a licence, but it
    // is the one signal in the payload about the creator's own intent, so surface
    // it rather than deciding silently on their behalf.
    const dl = (ent.media[0]?.allow_download_status ?? {}) as { allow_download?: boolean };
    return {
      text: String(t.text ?? '').replace(/\s+/g, ' ').trim(),
      author: a.userName,
      likes: t.likeCount, views: t.viewCount, replies: t.replyCount,
      createdAt: t.createdAt,
      url: t.url,
      media: mediaUrls,
      ...(posters.length ? { poster: posters } : {}),
      ...(dl.allow_download === undefined ? {} : { allowDownload: dl.allow_download }),
    };
  }).filter(x => x.media.length > 0)
    // In reply mode the root post is part of its own conversation; it is the NEWS,
    // not a reaction to it, so drop it or it always ranks first on likes.
    .filter(x => !repliesTo || !String(x.url ?? '').endsWith(`/${repliesTo}`))
    .sort((a, b) => Number(b.likes ?? 0) - Number(a.likes ?? 0))
    .slice(0, n);

  const sheetPath = flagVal(argv, 'sheet');
  if (sheetPath && out.length) await contactSheet(out, sheetPath);

  console.log(JSON.stringify({
    ok: true, query: q, count: out.length, sheet: sheetPath ?? null,
    hint: out.length
      ? 'LOOK at the sheet before picking (--sheet candidates.png); the text of a meme reply is just "@handle". Then: canvas.ts add-image --image "<media url>". Meme slides take a SHORT punchy line, not an analytical paragraph.'
      : 'Nothing with media at that engagement — lower --min-faves, drop a word from the query, or try --replies <statusId> on the news post everyone is replying to.',
    results: out,
  }, null, 2));
}

async function main(): Promise<void> {
  loadEnvLocal();   // frontend/.env.local — SERPER_API_KEY, TWITTERAPI_IO_KEY
  const [cmd, arg, ...rest] = process.argv.slice(2);
  const argv = process.argv.slice(2);
  // `memes --replies <id>` needs no positional query.
  if (cmd === 'memes' && !arg && argv.includes('--replies')) return memes('', argv);
  if (!cmd || !arg) {
    console.log([
      'research toolkit',
      '  tsx scripts/research.ts search  "<query>" [--n 15]        → SearXNG meta-search (falls back to Serper)',
      '  tsx scripts/research.ts read    <url> [--raw]             → article text as markdown (Readability)',
      '  tsx scripts/research.ts archive <url> [--limit 20]        → Wayback snapshots of a URL',
      '  tsx scripts/research.ts archive <url> --get <timestamp>   → read one snapshot (recovers DELETED pages)',
      '  tsx scripts/research.ts memes   "<topic>" [--min-faves 300] [--video]  → reaction memes about a story, with media URLs',
      '  tsx scripts/research.ts memes   --replies <statusId>       → mine one post\'s replies for reactions',
      '      add --sheet cand.png to tile every candidate into ONE image you can actually look at',
      '  tsx scripts/research.ts memes   "<mood>" --reddit [--subs memes,funny] [--fetch dir/]  → GENERIC meme images/videos from Reddit (no key; --fetch muxes the audio)',
    ].join('\n'));
    process.exit(arg ? 0 : 1);
  }
  void rest;
  if (cmd === 'search') return search(arg, argv);
  if (cmd === 'read') return read(arg, argv);
  if (cmd === 'archive') return archive(arg, argv);
  if (cmd === 'memes') return memes(arg, argv);
  throw new Error(`unknown subcommand ${JSON.stringify(cmd)} (search|read|archive|memes)`);
}

main().catch((err: unknown) => {
  console.error('ERROR:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
