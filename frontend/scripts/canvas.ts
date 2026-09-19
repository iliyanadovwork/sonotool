// ─────────────────────────────────────────────────────────────────────────────
// canvas CLI — headless creation of templates/posts for the sonotool editor.
//
//   tsx scripts/canvas.ts demo
//   tsx scripts/canvas.ts create --kind template|post --name "..." --user <uuid> --spec spec.json
//   tsx scripts/canvas.ts render --slide <slideId> --kind template|post --out out.png   (Phase 2)
//
// Run from the frontend/ directory (loads frontend/.env.local for the service-role key).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { loadEnvLocal } from './load-env';
import { createAdminClient } from '../src/lib/template-editor/admin-client';
import { buildSlides, type DesignSpec } from '../src/lib/template-editor/build';
import { createTemplate, createPost, duplicateDesign, fillPlaceholder, setElementLocks, setSlideSettingLocks, createPostFromTemplate, setElementText, setSlideSettings, addImageElement, setSubjectStroke, removeImageElement, setImageEffects, rotateImageElement, setImageSource, moveImageElement, setSlideCaption, addSlideToDesign, removeChartElement, expandImageBox, splitImageBox, POST_CAPTION_MAX, addChartElement, setChartConfig, findChartDataGaps, setImageStyle, setImageCrop, setImagePerspective, type ChartSnapshot } from '../src/lib/template-editor/persist';
import { chartAspect } from '../src/app/components/TemplateEditorCanvas/drawing/chart';
import { defaultShadowStyle } from '../src/app/components/templateEditorTypes';
import type { ImageBoxFade, ImageBoxPerspective, ShadowStyle } from '../src/app/components/templateEditorTypes';
import { TEMPLATE_TABLES, POST_TABLES } from '../src/lib/template-editor/slide-serde';
import { renderSlideToPng, renderSlideRowToPng } from '../src/lib/template-editor/render';
import { validateDesignSpec } from '../src/lib/template-editor/validate';
import { resolveImageRef, probeImageUrlDimensions, put, isVideoPath, probeVideo, videoPosterFrame } from '../src/lib/template-editor/assets';
import { preparePublish } from '../src/lib/template-editor/publish';
import { inspectDesign } from '../src/lib/template-editor/inspect';

// Default owner for designs created headlessly; override with --user.
const DEFAULT_USER = '42bde827-f2fa-4258-bab4-1a6679a5cce0';

type Flags = Record<string, string | boolean>;

function parseFlags(argv: string[]): Flags {
  const out: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const body = a.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) { out[body.slice(0, eq)] = body.slice(eq + 1); continue; }   // --key=value
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[body] = next; i++; }   // --key value
    else out[body] = true;                                                        // --key (bare)
  }
  return out;
}

// A string-valued flag: the string, or undefined if absent. A value-expecting flag passed
// bare (`--user` with no value) is an error, never a silent default — that once mis-attributed
// ownership to DEFAULT_USER when `--user=<uuid>` failed to parse.
function strFlag(flags: Flags, name: string): string | undefined {
  const v = flags[name];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new Error(`--${name} expects a value`);
  return v;
}

function parseKind(flags: Flags, def: 'template' | 'post'): 'template' | 'post' {
  const v = strFlag(flags, 'kind');
  if (v === undefined) return def;
  const k = v.toLowerCase();
  if (k !== 'template' && k !== 'post') throw new Error(`--kind must be 'template' or 'post' (got '${v}')`);
  return k;
}

// Parse "k=v,k=v" pairs with true/false/number coercion (shared by --set flags).
function parsePairs(raw: string, flagName: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=');
    if (eq < 1) throw new Error(`${flagName}: bad pair "${pair}" (want key=value)`);
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    out[k] = v === 'true' ? true : v === 'false' ? false : (v !== '' && !Number.isNaN(Number(v))) ? Number(v) : v;
  }
  return out;
}

// Resolve an artist's chart snapshot through the running app (same routes the
// editor's ChartSearchCard uses): search by name unless --spotify-id was given,
// then fetch the full series + releases. Needs the dev/prod server up.
async function resolveArtistSnapshot(appUrl: string, opts: { artist?: string; spotifyId?: string }): Promise<ChartSnapshot & { matchedName: string }> {
  // fetch() rejects with a bare TypeError when the app isn't running — surface
  // the actionable cause instead of "fetch failed".
  const get = async (url: string): Promise<Response> => {
    try { return await fetch(url); }
    catch (e) { throw new Error(`could not reach the app at ${appUrl} (${(e as Error & { cause?: { code?: string } })?.cause?.code ?? (e as Error).message}) — is the dev server running?`); }
  };
  let id = opts.spotifyId;
  let searchedName: string | undefined;
  let searchedImage: string | undefined;
  if (!id) {
    if (!opts.artist) throw new Error('pass --artist "name" or --spotify-id <id>');
    const res = await get(`${appUrl}/api/posts/charts/search?q=${encodeURIComponent(opts.artist)}`);
    if (!res.ok) throw new Error(`artist search failed (${res.status})`);
    const data = await res.json() as { results?: { id: string; name: string; image_url?: string }[] };
    const hit = data.results?.[0];
    if (!hit) throw new Error(`no artist found for "${opts.artist}"`);
    id = hit.id;
    searchedName = hit.name;
    searchedImage = hit.image_url;
  }
  const res = await get(`${appUrl}/api/posts/charts/artist/${encodeURIComponent(id)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(err?.error || `artist fetch failed (${res.status})`);
  }
  const data = await res.json() as Record<string, unknown>;
  const artist = (data.artist ?? data) as Record<string, unknown>;
  const points = (artist?.data_points ?? []) as { index: number; timestamp: string }[];
  if (points.length < 2) throw new Error(String((data as { error?: string }).error || `no chart data for artist ${id}`));
  const releasesRaw = typeof artist.releases === 'string' ? JSON.parse(artist.releases) : (artist.releases ?? []);
  const releases = (Array.isArray(releasesRaw) ? releasesRaw : []).map((rel: { date?: string; name?: string; image?: string; type?: string }) => ({
    date: rel.date, name: rel.name, image: rel.image, type: rel.type,
  }));
  const name = (artist.name as string) ?? searchedName ?? opts.artist ?? id;
  return {
    spotifyId: id,
    artistName: name,
    // Mirror ChartSearchCard: fall back to the search hit's avatar when the
    // artist route has none, so the header keeps its face.
    artistImage: (artist.image_url as string) ?? searchedImage ?? undefined,
    data: points,
    releases,
    matchedName: name,
  };
}

// Post-write caption report: measured facts an agent can't reliably eyeball
// (char counts) plus mechanical detections of CAPTIONS.md's banned patterns.
// Deliberately NOT enforcement — the write has already happened; this exists so
// the very next thing the writing agent reads is what to verify. See CAPTIONS.md.
function captionReport(caption: string): Record<string, unknown> {
  const firstSentence = caption.split(/(?<=[.!?])\s|\n/, 1)[0] ?? caption;
  const detected: string[] = [];
  if (/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u.test(caption)) detected.push('emoji');
  if (/(^|\s)#\w/.test(caption)) detected.push('hashtag');
  if (/(^|\s)@\w/.test(caption)) detected.push('@handle');
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|io|net|org|co|app|ai|tv|xyz)\b/i.test(caption)) detected.push('url/domain');
  if (/\[\d{1,3}\]|\[[a-z0-9-]+\.[a-z]{2,}[^\]]*\]/i.test(caption)) detected.push('citation-marker');
  return {
    length: caption.length,
    firstSentenceChars: firstSentence.length,
    hookFitsFeedPreview: firstSentence.length <= 125,
    bannedPatternsDetected: detected,
    paragraphs: caption.split(/\n{2,}/).length,
    verify: 'Check these against src/lib/template-editor/CAPTIONS.md (hook ≤125 chars; slide 1 length 1500-2000; zero banned patterns; 15-20 woven search phrases). If any rule fails, rewrite and re-run set-caption.',
  };
}

// A minimal, safe demo design (text + styling) to prove the create pipeline.
function demoSpec(): DesignSpec {
  return {
    name: 'CLI demo — headless',
    slides: [
      {
        name: 'main',
        settings: { canvasColor: '#0b0b0f', showFade: true, fadeIntensity: 90 },
        textBoxes: [
          {
            text: 'BUILT FROM THE CLI',
            x: 90, y: 980, width: 900, height: 260,
            fontLabel: 'Inter', fontSize: 92, fontWeight: 700,
            color: '#ffffff', align: 'left', vAlign: 'bottom',
            allCaps: true, lineHeight: 8, letterSpacing: -2, fillPlaceholder: false,
          },
          {
            text: 'No browser, no clicks — just a spec',
            x: 90, y: 1290, width: 900, height: 46,
            fontLabel: 'Inter', fontSize: 30, fontWeight: 500,
            color: '#c9c9d2', align: 'left', vAlign: 'top', fillPlaceholder: false,
          },
        ],
      },
    ],
  };
}


// --from/--to: an arbitrary chart window, expressed as dates rather than one of the
// fixed periods. The fixed enum cannot express "start after the data outage", which
// is the case that forced this. Folded into the same patch the --set pairs produce.
function applyWindowFlags(
  patch: Record<string, unknown> | undefined,
  flags: Flags,
  verb: string,
): Record<string, unknown> | undefined {
  const from = strFlag(flags, 'from');
  const to = strFlag(flags, 'to');
  if (from === undefined && to === undefined) return patch;
  const out = { ...(patch ?? {}) };
  const check = (label: string, v: string) => {
    if (v !== 'none' && Number.isNaN(new Date(v).getTime())) {
      throw new Error(`${verb} ${label}: expected an ISO date like 2026-07-28 (or 'none' to clear), got ${JSON.stringify(v)}`);
    }
  };
  if (from !== undefined) { check('--from', from); out.startDate = from; }
  if (to !== undefined) {
    check('--to', to);
    // endDate is only read when endMode is 'custom', so set both together — passing
    // --to alone and silently getting end-of-data would be a trap.
    out.endDate = to;
    out.endMode = to === 'none' ? 'none' : 'custom';
  }
  return out;
}

async function main() {
  loadEnvLocal();   // frontend/.env.local
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  if (cmd === 'demo' || cmd === 'create') {
    const kind = parseKind(flags, 'template');
    const userId = strFlag(flags, 'user') ?? DEFAULT_USER;

    // create --from-template <templateId>: make a POST from a template (deep-clone
    // slides, inherit locks, record source_template_id). No spec involved.
    const fromTemplate = strFlag(flags, 'from-template');
    if (fromTemplate) {
      const name = strFlag(flags, 'name');
      if (!name) throw new Error('create --from-template: --name "<post name>" is required');
      const client = createAdminClient();
      // --image fills the template's photo slot AT creation (slots are template-only
      // visuals; a post never contains an unfilled placeholder — the rest are stripped).
      const imageRef = strFlag(flags, 'image');
      const ownStorage = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/`;
      const fillImage = imageRef
        ? (imageRef.startsWith(ownStorage) ? imageRef : (await resolveImageRef(client, userId, imageRef)).url)
        : undefined;
      const fillImageDims = fillImage ? (await probeImageUrlDimensions(fillImage)) ?? undefined : undefined;
      const res = await createPostFromTemplate(client, { templateId: fromTemplate, userId, name, fillImage, fillImageDims });
      console.log(JSON.stringify({
        ok: true, kind: 'post', id: res.id, name, slideIds: res.slideIds,
        sourceTemplateId: res.sourceTemplateId,
        ...(res.filledSlot ? { filledSlot: res.filledSlot } : {}),
        ...(res.strippedSlots ? { strippedSlots: res.strippedSlots } : {}),
      }, null, 2));
      return;
    }

    let raw: unknown;
    let fallbackName: string;
    if (cmd === 'demo') {
      raw = demoSpec();
      fallbackName = 'CLI demo';
    } else {
      const specPath = strFlag(flags, 'spec');
      if (!specPath) throw new Error('create: --spec <file.json> is required');
      raw = JSON.parse(readFileSync(specPath, 'utf8'));
      fallbackName = 'Untitled';
    }

    const spec: DesignSpec = validateDesignSpec(raw);   // clear errors before touching the DB
    const name = strFlag(flags, 'name') ?? spec.name ?? fallbackName;

    const client = createAdminClient();
    const slides = buildSlides(spec);
    const result = kind === 'post'
      ? await createPost(client, { userId, name, slides })
      : await createTemplate(client, { userId, name, slides });

    const app = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3011';
    console.log(JSON.stringify({ ok: true, kind, id: result.id, name, slideIds: result.slideIds, app }, null, 2));
    return;
  }

  if (cmd === 'fill') {
    const id = strFlag(flags, 'id');
    if (!id) throw new Error('fill: --id <template|post id> is required');
    const image = strFlag(flags, 'image');
    if (!image) throw new Error('fill: --image <file|url> is required');
    const kind = parseKind(flags, 'template');
    const userId = strFlag(flags, 'user') ?? DEFAULT_USER;
    const slideIndex = Number(strFlag(flags, 'slide') ?? '0');
    const slotIndex = Number(strFlag(flags, 'slot') ?? '0');

    const client = createAdminClient();
    // An image that's already in THIS project's public storage is used as-is —
    // no point mirroring our own bucket into a duplicate copy.
    const ownStorage = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/`;
    const imageUrl = image.startsWith(ownStorage)
      ? image
      : (await resolveImageRef(client, userId, image)).url;
    const res = await fillPlaceholder(client, kind, { parentId: id, imageUrl, slideIndex, slotIndex });
    console.log(JSON.stringify({ ok: true, ...res }, null, 2));
    return;
  }

  if (cmd === 'add-image') {
    // Add an image element to an existing design's slide (the CLI analog of dropping an
    // image onto the canvas). --cover renders it slot-like (object-fit: cover, inert in
    // posts); --z bottom puts it behind everything (e.g. a photo under the fade/text).
    const id = strFlag(flags, 'id');
    const slideId = strFlag(flags, 'slide');
    const imageRef = strFlag(flags, 'image');
    if (!id || !slideId || !imageRef) throw new Error('add-image: --id <template|post id> --slide <slideId> --image <file|url> are required');
    const kind = parseKind(flags, 'post');
    const userId = strFlag(flags, 'user') ?? DEFAULT_USER;

    const x = Number(strFlag(flags, 'x') ?? '0');
    const y = Number(strFlag(flags, 'y') ?? '0');
    const width = Number(strFlag(flags, 'width') ?? '1080');
    const heightFlag = strFlag(flags, 'height');
    if (![x, y, width].every(Number.isFinite) || width <= 0) {
      throw new Error('add-image: --x/--y/--width must be numbers (width > 0)');
    }
    // --z omitted = auto: target the Image Layer zone (the __images__ sentinel) when the
    // slide has one, else top. Passing 'top'/'bottom' forces the extremes.
    const zRaw = strFlag(flags, 'z');
    if (zRaw !== undefined && zRaw !== 'top' && zRaw !== 'bottom') throw new Error("add-image: --z must be 'top' or 'bottom' (omit for the Image Layer zone)");

    const client = createAdminClient();
    const ownStorage = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/`;

    // ── Video branding (mp4 / webm / mov) ────────────────────────────────────
    // An ImageBox can carry a `videoUrl`, and the canvas draws its live frames — so
    // an animated logo or sting is just an image box with the video field set. The
    // still `url` gets a POSTER FRAME, because the headless renderer cannot play
    // video and would otherwise export an empty box.
    const isVid = isVideoPath(imageRef);
    let url: string;
    let videoUrl: string | undefined;
    let height: number;

    if (isVid) {
      const localVid = !/^https?:\/\//i.test(imageRef);
      videoUrl = imageRef.startsWith(ownStorage) ? imageRef : (await resolveImageRef(client, userId, imageRef)).url;

      // Dimensions: ffprobe the local file, else require them explicitly rather than
      // guessing and distorting the asset.
      let vdims: { width: number; height: number; duration: number } | null = null;
      if (localVid) vdims = await probeVideo(imageRef);
      if (heightFlag !== undefined) {
        height = Number(heightFlag);
        if (!Number.isFinite(height) || height <= 0) throw new Error('add-image: --height must be a number > 0');
      } else if (vdims) {
        height = Math.round(width * (vdims.height / vdims.width));
      } else {
        throw new Error('add-image: could not read the video dimensions (ffprobe unavailable, or the source is remote) — pass --height explicitly');
      }

      // Poster frame → the box's static url, so PNG renders and the first paint look right.
      let poster: Buffer | null = null;
      if (localVid) poster = await videoPosterFrame(imageRef);
      url = poster
        ? (await put(client, userId, poster, `poster-${Date.now()}.png`, 'image/png')).url
        : '';
      if (!poster) {
        console.error('NOTE: no poster frame (needs ffmpeg + a local file). The box will be blank in still PNG renders; the editor and MP4 export still play the video.');
      }
    } else {
      url = imageRef.startsWith(ownStorage) ? imageRef : (await resolveImageRef(client, userId, imageRef)).url;
      // FIT-TO-WIDTH policy: --height omitted → the image spans --width at its natural
      // aspect (nothing cropped). An explicit --height reintroduces the cover-crop frame.
      if (heightFlag !== undefined) {
        height = Number(heightFlag);
        if (!Number.isFinite(height) || height <= 0) throw new Error('add-image: --height must be a number > 0');
      } else {
        const dims = await probeImageUrlDimensions(url);
        if (!dims) throw new Error('add-image: could not read the image dimensions for fit-to-width — pass --height explicitly');
        height = Math.round(width * (dims.height / dims.width));
      }
    }
    const res = await addImageElement(client, kind, {
      parentId: id, slideId, url, videoUrl, x, y, width, height,
      // fit:'cover' is a no-op at the natural aspect but keeps any LATER box resize
      // un-stretched, so CLI-added images always carry it.
      z: zRaw, cover: true,
      name: strFlag(flags, 'name'),
    });
    console.log(JSON.stringify({ ok: true, ...res, url }, null, 2));
    return;
  }

  if (cmd === 'set-effects') {
    // Image effects: set-effects --id --box [--blur N] [--noise N] [--brightness N] | --none
    const id = strFlag(flags, 'id');
    const boxId = strFlag(flags, 'box');
    if (!id || !boxId) throw new Error('set-effects: --id <template|post id> --box <imageBoxId> are required');
    const kind = parseKind(flags, 'post');
    const none = flags.none === true || flags.none === 'true';
    const effects: { blur?: number; noise?: number; brightness?: number } = {};
    for (const k of ['blur', 'noise', 'brightness'] as const) {
      const v = strFlag(flags, k);
      if (v !== undefined) {
        const n = Number(v);
        // brightness is SIGNED (-100 darkens, +100 brightens, 0 = none); blur and
        // noise are radii/amounts and can only be positive. Rejecting negative
        // brightness here made darkening a backdrop impossible from the CLI even
        // though the editor and the renderer both support it.
        const min = k === 'brightness' ? -100 : 0;
        const max = k === 'brightness' ? 100 : Infinity;
        if (!Number.isFinite(n) || n < min || n > max) {
          throw new Error(`set-effects: --${k} must be a number ${k === 'brightness' ? 'between -100 and 100' : '>= 0'}`);
        }
        effects[k] = n;
      }
    }
    if (!none && Object.keys(effects).length === 0) throw new Error('set-effects: pass at least one of --blur/--noise/--brightness (or --none to clear)');
    const layerRaw = strFlag(flags, 'layer');
    if (layerRaw !== undefined && layerRaw !== 'fg' && layerRaw !== 'bg') throw new Error("set-effects: --layer must be 'fg' or 'bg'");
    const client = createAdminClient();
    const res = await setImageEffects(client, kind, {
      parentId: id, boxId, effects: none ? null : effects,
      layer: layerRaw as 'fg' | 'bg' | undefined,
    });
    console.log(JSON.stringify({ ok: true, ...res }, null, 2));
    return;
  }

  if (cmd === 'remove-image') {
    // Remove an image element (box + its z-order entry; sentinels/other layers untouched).
    const id = strFlag(flags, 'id');
    const boxId = strFlag(flags, 'box');
    if (!id || !boxId) throw new Error('remove-image: --id <template|post id> --box <imageBoxId> are required');
    const kind = parseKind(flags, 'post');
    const client = createAdminClient();
    const res = await removeImageElement(client, kind, { parentId: id, boxId });
    console.log(JSON.stringify({ ok: true, removed: res.boxId, slideId: res.slideId }, null, 2));
    return;
  }

  if (cmd === 'stroke') {
    // White (or any-colour) outline around a split image's detected subject.
    // stroke --id <id> --box <imageBoxId> [--color #ffffff] [--width 12] | --off
    const id = strFlag(flags, 'id');
    const boxId = strFlag(flags, 'box');
    if (!id || !boxId) throw new Error('stroke: --id <template|post id> --box <imageBoxId> are required');
    const kind = parseKind(flags, 'post');
    const off = flags.off === true || flags.off === 'true';
    const color = strFlag(flags, 'color') ?? '#ffffff';
    const width = Number(strFlag(flags, 'width') ?? '12');
    if (!off && (!Number.isFinite(width) || width <= 0 || width > 100)) throw new Error('stroke: --width must be 1-100 (canvas px)');
    if (!off && !/^#[0-9a-fA-F]{3,8}$/.test(color)) throw new Error(`stroke: --color must be a hex colour (got "${color}")`);

    const client = createAdminClient();
    const res = await setSubjectStroke(client, kind, { parentId: id, boxId, stroke: off ? null : { color, width } });
    console.log(JSON.stringify({ ok: true, ...res }, null, 2));
    return;
  }

  if (cmd === 'move') {
    // Move / resize an image box: move --id <id> --box <imageBoxId> [--x N] [--y N] [--width N] [--height N]
    const id = strFlag(flags, 'id');
    const boxId = strFlag(flags, 'box');
    if (!id || !boxId) throw new Error('move: --id <template|post id> --box <imageBoxId> are required');
    const kind = parseKind(flags, 'post');
    const dims: Record<'x' | 'y' | 'width' | 'height', number | undefined> = { x: undefined, y: undefined, width: undefined, height: undefined };
    for (const k of ['x', 'y', 'width', 'height'] as const) {
      const v = strFlag(flags, k);
      if (v !== undefined) {
        const n = Number(v);
        if (!Number.isFinite(n) || ((k === 'width' || k === 'height') && n <= 0)) throw new Error(`move: --${k} must be a number${k === 'width' || k === 'height' ? ' > 0' : ''}`);
        dims[k] = n;
      }
    }
    if (Object.values(dims).every(v => v === undefined)) throw new Error('move: pass at least one of --x/--y/--width/--height');
    const client = createAdminClient();
    const res = await moveImageElement(client, kind, { parentId: id, boxId, ...dims });
    console.log(JSON.stringify({ ok: true, ...res }, null, 2));
    return;
  }

  if (cmd === 'set-image') {
    // Swap what an existing image box shows (the CLI analog of "replace image"):
    // keeps position/z-order/effects/stroke/rotation, refits height to the new
    // image's natural aspect (--keep-size to opt out), drops the stale crop.
    // --fg <file|url> supplies the NEW image's cutout so split/outline survive;
    // without it, split state (old image's cutout) is stale and gets cleared.
    const id = strFlag(flags, 'id');
    const boxId = strFlag(flags, 'box');
    const imageRef = strFlag(flags, 'image');
    if (!id || !boxId || !imageRef) throw new Error('set-image: --id <template|post id> --box <imageBoxId> --image <file|url> are required');
    const kind = parseKind(flags, 'post');
    const userId = strFlag(flags, 'user') ?? DEFAULT_USER;
    const fgRef = strFlag(flags, 'fg');
    const keepSize = flags['keep-size'] === true || flags['keep-size'] === 'true';

    const client = createAdminClient();
    const ownStorage = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/`;
    const resolve = async (ref: string) => ref.startsWith(ownStorage) ? ref : (await resolveImageRef(client, userId, ref)).url;
    const url = await resolve(imageRef);
    const fgUrl = fgRef === undefined ? undefined : (fgRef === imageRef ? url : await resolve(fgRef));
    const dims = await probeImageUrlDimensions(url);
    const res = await setImageSource(client, kind, {
      parentId: id, boxId, url, fgUrl,
      naturalWidth: dims?.width, naturalHeight: dims?.height, keepSize,
    });
    console.log(JSON.stringify({ ok: true, ...res }, null, 2));
    return;
  }

  if (cmd === 'rotate') {
    // Rotate an image box about its centre (stored as a pure-rotation perspective quad).
    // rotate --id <id> --box <imageBoxId> --degrees <-180..180>   (0 clears; +ve = clockwise)
    const id = strFlag(flags, 'id');
    const boxId = strFlag(flags, 'box');
    if (!id || !boxId) throw new Error('rotate: --id <template|post id> --box <imageBoxId> are required');
    const kind = parseKind(flags, 'post');
    const degrees = Number(strFlag(flags, 'degrees'));
    if (!Number.isFinite(degrees) || degrees < -180 || degrees > 180) throw new Error('rotate: --degrees must be a number in -180..180 (positive = clockwise; 0 clears)');
    const client = createAdminClient();
    const res = await rotateImageElement(client, kind, { parentId: id, boxId, degrees });
    console.log(JSON.stringify({ ok: true, ...res }, null, 2));
    return;
  }

  if (cmd === 'set-settings') {
    // Patch slide-level settings values: --set fadeIntensity=100,fadeReach=35,canvasColor=#000
    // Values are coerced: true/false → boolean, numeric → number, else string.
    const id = strFlag(flags, 'id');
    const slideId = strFlag(flags, 'slide');
    const setRaw = strFlag(flags, 'set');
    if (!id || !slideId || !setRaw) throw new Error('set-settings: --id <template|post id> --slide <slideId> --set k=v,k=v are required');
    const kind = parseKind(flags, 'template');

    const patch: Record<string, unknown> = {};
    for (const pair of setRaw.split(',')) {
      const eq = pair.indexOf('=');
      if (eq < 1) throw new Error(`set-settings: bad pair "${pair}" (want key=value)`);
      const k = pair.slice(0, eq).trim();
      const v = pair.slice(eq + 1).trim();
      patch[k] = v === 'true' ? true : v === 'false' ? false : (v !== '' && !Number.isNaN(Number(v))) ? Number(v) : v;
    }
    const client = createAdminClient();
    const res = await setSlideSettings(client, kind, { parentId: id, slideId, patch });
    console.log(JSON.stringify({ ok: true, ...res }, null, 2));
    return;
  }

  if (cmd === 'set-text') {
    // Rewrite a text box's content. Markup: **word** marks a secondary-weight run
    // (the template's highlight style, e.g. Heavy 900); \n (literal backslash-n)
    // makes a manual line break. Plain text (no **) clears existing styling runs.
    const id = strFlag(flags, 'id');
    const boxId = strFlag(flags, 'box');
    const raw = strFlag(flags, 'text');
    if (!id || !boxId || raw === undefined) throw new Error('set-text: --id <template|post id> --box <textBoxId> --text "…" are required (markup: **secondary**, \\n)');
    const kind = parseKind(flags, 'post');

    const full = raw.replace(/\\n/g, '\n');
    let spans: { text: string; secondary?: boolean }[] | undefined;
    if (full.includes('**')) {
      spans = [];
      const parts = full.split('**');
      if (parts.length % 2 === 0) throw new Error('set-text: unbalanced ** markup');
      parts.forEach((p, i) => { if (p) spans!.push(i % 2 ? { text: p, secondary: true } : { text: p }); });
    }
    const text = full.replace(/\*\*/g, '');

    const client = createAdminClient();
    const res = await setElementText(client, kind, { parentId: id, boxId, text, spans, slideId: strFlag(flags, 'slide') });
    console.log(JSON.stringify({ ok: true, ...res }, null, 2));
    return;
  }

  if (cmd === 'lock') {
    // Set template-defined style locks on an element (text OR image box): the listed
    // properties become read-only in POSTS mode (text stays editable; a placeholder
    // stays fillable). `--props none` clears all locks; `geometry` = x,y,width,height.
    // Per-element-kind validation happens in setElementLocks.
    const id = strFlag(flags, 'id');
    if (!id) throw new Error('lock: --id <template|post id> is required');
    const kind = parseKind(flags, 'template');

    // Slide-level mode: lock slide-wide SETTINGS (canvasColor, fades, …) on one slide.
    const slideId = strFlag(flags, 'slide');
    if (slideId) {
      const settingsRaw = strFlag(flags, 'settings');
      if (!settingsRaw) throw new Error('lock --slide: --settings canvasColor,showFade,… (or "none") is required');
      const settings = settingsRaw === 'none' ? [] : settingsRaw.split(',').map(s => s.trim()).filter(Boolean);
      const client = createAdminClient();
      const res = await setSlideSettingLocks(client, kind, { parentId: id, slideId, settings });
      console.log(JSON.stringify({ ok: true, ...res }, null, 2));
      return;
    }

    const boxId = strFlag(flags, 'box');
    const propsRaw = strFlag(flags, 'props');
    if (!boxId || !propsRaw) throw new Error('lock: --box <elementId> --props a,b,c (or "none", alias "geometry") — or --slide <slideId> --settings … for slide-wide locks');

    const props = propsRaw === 'none' ? [] : propsRaw.split(',').map(p => p.trim()).filter(Boolean)
      .flatMap(p => p === 'geometry' ? ['x', 'y', 'width', 'height'] : [p]);

    const client = createAdminClient();
    const res = await setElementLocks(client, kind, { parentId: id, boxId, props: [...new Set(props)] });
    console.log(JSON.stringify({ ok: true, ...res }, null, 2));
    return;
  }

  if (cmd === 'split-image') {
    // Subject/background split, fully headless: same model + weights the editor
    // uses, so the matte is identical to one made by hand. Needs no dev server.
    const id = strFlag(flags, 'id');
    const boxId = strFlag(flags, 'box');
    if (!id || !boxId) throw new Error('split-image: --id <template|post id> --box <imageBoxId> are required');
    const kind = parseKind(flags, 'post');
    const userId = strFlag(flags, 'user') ?? DEFAULT_USER;
    const num = (name: string, lo: number, hi: number) => {
      const raw = strFlag(flags, name);
      if (raw === undefined) return undefined;
      const v = Number(raw);
      if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`split-image: --${name} must be ${lo}-${hi}`);
      return v;
    };
    const blur = num('blur', 0, 40);
    const bgNoise = num('bg-noise', 0, 100);
    const fgNoise = num('fg-noise', 0, 100);
    // House style is edge-faded blur; --hard-blur opts out.
    const edgeFade = !(flags['hard-blur'] === true || flags['hard-blur'] === 'true');
    // --drop-bg: keep ONLY the subject (background removed, not blurred). Use it
    // for secondary objects so they sit IN the scene instead of on a rectangle.
    const dropBg = flags['drop-bg'] === true || flags['drop-bg'] === 'true';
    // Trimming only makes sense once the background is gone; default it on there
    // so a floated object's bounds wrap the object, not a transparent frame.
    const trim = flags['no-trim'] === true || flags['no-trim'] === 'true' ? false : dropBg;
    // Imported lazily: the model runtime is Node-only and heavy, so it must not
    // load for every unrelated CLI command.
    const { cutoutPng } = await import('../src/lib/template-editor/cutout');
    const client = createAdminClient();
    const res = await splitImageBox(client, kind, {
      parentId: id, boxId, slideId: strFlag(flags, 'slide'), blur, bgNoise, fgNoise, edgeFade, dropBg, trim,
      cutout: (u: string) => cutoutPng(u),
      uploadBuffer: async (buf: Buffer, name: string, ct: string) => (await put(client, userId, buf, name, ct)).url,
    });
    console.log(JSON.stringify({ ok: true, ...res }, null, 2));
    return;
  }

  if (cmd === 'poster') {
    // Give a video box a still POSTER frame. The headless renderer cannot decode
    // video, so a box whose url is the mp4 itself renders as nothing and the page
    // dies on timeout. ffmpeg reads the URL directly, so this works on assets
    // uploaded through the app as well as local files.
    const id = strFlag(flags, 'id');
    const boxId = strFlag(flags, 'box');
    if (!id || !boxId) throw new Error('poster: --id <template|post id> --box <imageBoxId> are required');
    const kind = parseKind(flags, 'post');
    const userId = strFlag(flags, 'user') ?? DEFAULT_USER;
    const atRaw = strFlag(flags, 'at');
    const at = atRaw === undefined ? 0.1 : Number(atRaw);
    if (!Number.isFinite(at) || at < 0) throw new Error('poster: --at must be a number of seconds >= 0');

    const client = createAdminClient();
    const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
    const { data: rows, error } = await client
      .from(tables.slides).select('id, image_boxes').eq(tables.slideFk, id);
    if (error) throw new Error(`fetch slides failed: ${error.message}`);
    const all = (rows ?? []) as { id: string; image_boxes: Record<string, unknown>[] | null }[];
    const slideIdFlag = strFlag(flags, 'slide');
    const matches = all.filter(r => (r.image_boxes ?? []).some(b => b.id === boxId));
    if (matches.length === 0) throw new Error(`poster: image box ${boxId} not found in ${kind} ${id}`);
    const target = slideIdFlag ? matches.find(r => r.id === slideIdFlag) : matches.length === 1 ? matches[0] : undefined;
    if (!target) {
      throw new Error(slideIdFlag
        ? `poster: box ${boxId} not found on slide ${slideIdFlag}`
        : `poster: box ${boxId} exists on ${matches.length} slides — pass --slide <slideId>`);
    }
    const boxes = target.image_boxes ?? [];
    const idx = boxes.findIndex(b => b.id === boxId);
    const box = boxes[idx] as Record<string, unknown>;
    const src = (box.videoUrl as string | undefined) ?? (box.url as string | undefined);
    if (!src) throw new Error(`poster: box ${boxId} has no video`);
    if (!isVideoPath(src)) throw new Error(`poster: box ${boxId} is not a video box (${src.split('/').pop()})`);

    const png = await videoPosterFrame(src, at);
    if (!png) throw new Error('poster: ffmpeg could not grab a frame (is ffmpeg installed, and is the source reachable?)');
    const url = (await put(client, userId, png, `poster-${boxId}.png`, 'image/png')).url;

    // Ensure videoUrl is set too: dropping an mp4 in the editor can leave `url`
    // holding the video, in which case that IS the source we just postered.
    const next = boxes.map((b, i) => (i === idx ? { ...b, url, videoUrl: src } : b));
    const { error: upErr } = await client.from(tables.slides).update({ image_boxes: next }).eq('id', target.id);
    if (upErr) throw new Error(`poster: update failed: ${upErr.message}`);
    console.log(JSON.stringify({ ok: true, slideId: target.id, boxId, atSeconds: at, videoUrl: src, poster: url }, null, 2));
    return;
  }

  if (cmd === 'border') {
    // Give a pasted image its own edge. Bakes the stroke INTO the pixels, and the
    // rounding with it, then zeroes the box's cornerRadius — the renderer's radius
    // clips the image, so a baked straight border under a box radius comes out as
    // four blunt stubs. One shape, one radius, nothing to clip.
    const id = strFlag(flags, 'id');
    const boxId = strFlag(flags, 'box');
    if (!id || !boxId) throw new Error('border: --id <template|post id> --box <imageBoxId> are required');
    const kind = parseKind(flags, 'post');
    const userId = strFlag(flags, 'user') ?? DEFAULT_USER;
    const numOpt = (name: string, lo: number, hi: number, dflt: number) => {
      const raw = strFlag(flags, name);
      if (raw === undefined) return dflt;
      const v = Number(raw);
      if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`border: --${name} must be ${lo}-${hi}`);
      return v;
    };
    const widthCanvas = numOpt('width', 0.5, 40, 2);
    const radiusCanvas = numOpt('radius', 0, 200, 0);
    const padCanvas = numOpt('pad', 0, 300, 0);
    const color = strFlag(flags, 'color') ?? '#ffffff';
    if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) throw new Error(`border: --color must be a hex colour (got ${JSON.stringify(color)})`);
    const none = flags.none === true || flags.none === 'true';

    const client = createAdminClient();
    const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
    const { data: rows, error } = await client
      .from(tables.slides).select('id, image_boxes').eq(tables.slideFk, id);
    if (error) throw new Error(`fetch slides failed: ${error.message}`);
    const all = (rows ?? []) as { id: string; image_boxes: Record<string, unknown>[] | null }[];
    const slideIdFlag = strFlag(flags, 'slide');
    const matches = all.filter(r => (r.image_boxes ?? []).some(b => b.id === boxId));
    if (matches.length === 0) throw new Error(`border: image box ${boxId} not found in ${kind} ${id}`);
    const target = slideIdFlag ? matches.find(r => r.id === slideIdFlag) : matches.length === 1 ? matches[0] : undefined;
    if (!target) {
      throw new Error(slideIdFlag
        ? `border: box ${boxId} not found on slide ${slideIdFlag}`
        : `border: box ${boxId} exists on ${matches.length} slides — pass --slide <slideId>`);
    }
    const boxes = target.image_boxes ?? [];
    const idx = boxes.findIndex(b => b.id === boxId);
    const box = boxes[idx] as Record<string, unknown>;
    const srcUrl = box?.url as string | undefined;
    if (!srcUrl) throw new Error(`border: box ${boxId} has no image`);
    if (none) throw new Error('border: --none cannot undo a baked border — re-run set-image with the original file');

    const res = await fetch(srcUrl);
    if (!res.ok) throw new Error(`border: could not fetch the image (${res.status})`);
    const before = Buffer.from(await res.arrayBuffer());

    // --width/--radius are given in CANVAS px; convert to source px so the stroke
    // reads the same thickness whatever resolution the asset happens to be.
    const { borderImagePng } = await import('../src/lib/template-editor/cutout');
    const mod = await import('sharp');
    const S = (mod as unknown as { default: typeof import('sharp') }).default ?? (mod as unknown as typeof import('sharp'));
    const srcW = (await S(before).metadata()).width ?? 0;
    const boxW = Number(box.width) || srcW;
    const scale = srcW && boxW ? srcW / boxW : 1;
    const after = await borderImagePng(before, {
      widthPx: widthCanvas * scale,
      radiusPx: radiusCanvas * scale,
      padPx: padCanvas * scale,
      color,
    });
    const url = (await put(client, userId, after, `border-${boxId}.png`, 'image/png')).url;

    const next = boxes.map((b, i) => (i === idx ? { ...b, url, cornerRadius: 0 } : b));
    const { error: upErr } = await client.from(tables.slides).update({ image_boxes: next }).eq('id', target.id);
    if (upErr) throw new Error(`border: update failed: ${upErr.message}`);
    console.log(JSON.stringify({
      ok: true, slideId: target.id, boxId, color,
      widthCanvasPx: widthCanvas, radiusCanvasPx: radiusCanvas, padCanvasPx: padCanvas,
      sourceScale: Number(scale.toFixed(3)), cornerRadius: 0, url,
    }, null, 2));
    return;
  }

  if (cmd === 'feather') {
    // Soften/pull in a cut-out's alpha edge. The segmenter cuts on a hard boundary,
    // so the outer ring of kept pixels still holds blended BACKGROUND colour — on a
    // dark slide that reads as a pale outline tracing the subject. Nothing about the
    // composition is touched; only fgUrl is replaced.
    const id = strFlag(flags, 'id');
    const boxId = strFlag(flags, 'box');
    if (!id || !boxId) throw new Error('feather: --id <template|post id> --box <imageBoxId> are required');
    const kind = parseKind(flags, 'post');
    const userId = strFlag(flags, 'user') ?? DEFAULT_USER;
    const numOpt = (name: string, lo: number, hi: number, dflt: number) => {
      const raw = strFlag(flags, name);
      if (raw === undefined) return dflt;
      const v = Number(raw);
      if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`feather: --${name} must be ${lo}-${hi}`);
      return v;
    };
    // --amount = feather softness in px; --erode = how far the edge is pulled IN, in px.
    const featherPx = numOpt('amount', 0, 20, 1.5);
    const erodePx = numOpt('erode', 0, 20, 2);

    const client = createAdminClient();
    const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
    const { data: rows, error } = await client
      .from(tables.slides).select('id, image_boxes').eq(tables.slideFk, id);
    if (error) throw new Error(`fetch slides failed: ${error.message}`);
    const all = (rows ?? []) as { id: string; image_boxes: Record<string, unknown>[] | null }[];
    const slideIdFlag = strFlag(flags, 'slide');
    const matches = all.filter(r => (r.image_boxes ?? []).some(b => b.id === boxId));
    if (matches.length === 0) throw new Error(`feather: image box ${boxId} not found in ${kind} ${id}`);
    const target = slideIdFlag ? matches.find(r => r.id === slideIdFlag) : matches.length === 1 ? matches[0] : undefined;
    if (!target) {
      throw new Error(slideIdFlag
        ? `feather: box ${boxId} not found on slide ${slideIdFlag}`
        : `feather: box ${boxId} exists on ${matches.length} slides — pass --slide <slideId>`);
    }
    const boxes = target.image_boxes ?? [];
    const idx = boxes.findIndex(b => b.id === boxId);
    // --edges N feathers the image's own RECTANGLE border (for a plain pasted image);
    // without it we feather the SUBJECT's silhouette on a split box. Different jobs:
    // one dissolves the frame, the other cleans the matte.
    // --edges accepts a plain number (all four sides) or per-side pairs, matching the
    // house `--fade "top=40,color=#000"` shape: --edges "bottom=350,left=40".
    const edgesRaw = strFlag(flags, 'edges');
    let edgeSpec: Record<string, number> | undefined;
    if (edgesRaw !== undefined) {
      const okSide = (k: string) => ['top', 'right', 'bottom', 'left'].includes(k);
      if (/^[0-9.]+$/.test(edgesRaw.trim())) {
        const n = Number(edgesRaw);
        if (!Number.isFinite(n) || n <= 0 || n > 2000) throw new Error('feather: --edges must be 1-2000 px');
        edgeSpec = { edgePx: n };
      } else {
        edgeSpec = {};
        for (const pair of edgesRaw.split(',')) {
          const [k, v] = pair.split('=').map(t => t.trim());
          if (!okSide(k)) throw new Error(`feather --edges: unknown side ${JSON.stringify(k)} (top|right|bottom|left, or a bare number for all four)`);
          const n = Number(v);
          if (!Number.isFinite(n) || n <= 0 || n > 2000) throw new Error(`feather --edges: ${k} must be 1-2000 px`);
          edgeSpec[k] = n;
        }
        if (Object.keys(edgeSpec).length === 0) throw new Error('feather --edges: nothing to feather');
      }
    }
    const edgePx = edgeSpec;
    const box = boxes[idx] as Record<string, unknown>;
    const fgUrl = box?.fgUrl as string | undefined;
    const plainUrl = box?.url as string | undefined;
    // On a SPLIT box --edges targets the cut-out, so fading `bottom` dissolves the
    // subject's body into the fade. On a plain box it targets the image itself.
    const srcUrl = edgePx !== undefined ? (fgUrl ?? plainUrl) : fgUrl;
    const writesFg = edgePx === undefined || !!fgUrl;
    if (!srcUrl) {
      throw new Error(edgePx !== undefined
        ? `feather --edges: box ${boxId} has no image`
        : `feather: box ${boxId} has no cut-out — run split-image first, or pass --edges N to feather the image border instead`);
    }

    const res = await fetch(srcUrl);
    if (!res.ok) throw new Error(`feather: could not fetch image (${res.status})`);
    const before = Buffer.from(await res.arrayBuffer());
    const { featherCutoutPng, featherImageEdgesPng } = await import('../src/lib/template-editor/cutout');
    const after = edgePx !== undefined
      ? await featherImageEdgesPng(before, edgePx)
      : await featherCutoutPng(before, { featherPx, erodePx });
    const url = (await put(client, userId, after, `feather-${boxId}.png`, 'image/png')).url;

    const next = boxes.map((b, i) => (i === idx
      ? (writesFg ? { ...b, fgUrl: url } : { ...b, url })
      : b));
    const { error: upErr } = await client.from(tables.slides).update({ image_boxes: next }).eq('id', target.id);
    if (upErr) throw new Error(`feather: update failed: ${upErr.message}`);
    console.log(JSON.stringify({ ok: true, slideId: target.id, boxId, ...(edgePx !== undefined ? { edges: edgePx, wrote: writesFg ? 'fgUrl' : 'url', url } : { featherPx, erodePx, fgUrl: url }) }, null, 2));
    return;
  }

  if (cmd === 'expand-image') {
    // Generative outpaint IN PLACE: the box's image is replaced by a version
    // filling the whole canvas (same BRIA contract + in-place swap as the
    // editor's expand button). House rule 6 then detects background on that box
    // in the EDITOR (browser-only) and blurs the background layer via
    // `set-effects --layer bg --blur N`.
    const id = strFlag(flags, 'id');
    const boxId = strFlag(flags, 'box');
    if (!id || !boxId) throw new Error('expand-image: --id <template|post id> --box <imageBoxId> are required');
    const kind = parseKind(flags, 'post');
    const userId = strFlag(flags, 'user') ?? DEFAULT_USER;
    const appUrl = strFlag(flags, 'app') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3011';
    const client = createAdminClient();
    const res = await expandImageBox(client, kind, {
      parentId: id, boxId, slideId: strFlag(flags, 'slide'), appUrl,
      uploadBuffer: async (buf: Buffer, name: string, ct: string) => (await put(client, userId, buf, name, ct)).url,
    });
    console.log(JSON.stringify({ ok: true, ...res }, null, 2));
    return;
  }

  if (cmd === 'remove-chart') {
    const id = strFlag(flags, 'id');
    const boxId = strFlag(flags, 'box');
    if (!id || !boxId) throw new Error('remove-chart: --id <template|post id> --box <chartBoxId> are required');
    const kind = parseKind(flags, 'post');
    const client = createAdminClient();
    const res = await removeChartElement(client, kind, { parentId: id, boxId, slideId: strFlag(flags, 'slide') });
    console.log(JSON.stringify({ ok: true, removed: res.boxId, slideId: res.slideId }, null, 2));
    return;
  }

  if (cmd === 'add-slide') {
    // Append a slide. --from <slideId> deep-clones that slide (the usual way to
    // grow a carousel — a blank slide has none of the template's furniture:
    // texture, logo, text frames, locks).
    const id = strFlag(flags, 'id');
    if (!id) throw new Error('add-slide: --id <template|post id> is required');
    const kind = parseKind(flags, 'post');
    const client = createAdminClient();
    const res = await addSlideToDesign(client, kind, {
      parentId: id, fromSlideId: strFlag(flags, 'from'), name: strFlag(flags, 'name'),
    });
    console.log(JSON.stringify({ ok: true, kind, ...res }, null, 2));
    return;
  }

  if (cmd === 'set-caption') {
    // Per-SLIDE Instagram caption (max 2199 chars — one under IG's 2200). Each
    // slide carries its own; a carousel publish uses the FIRST slide's.
    // set-caption --id <postId> [--slide <slideId>] [--text "…" | --file <path> | --clear]
    // --slide omitted → the position-0 slide (the caption that publishes).
    const id = strFlag(flags, 'id');
    if (!id) throw new Error('set-caption: --id <template|post id> is required');
    const kind = parseKind(flags, 'post');
    const clear = flags.clear === true || flags.clear === 'true';
    const file = strFlag(flags, 'file');
    const text = strFlag(flags, 'text');
    if (!clear && file === undefined && text === undefined) throw new Error('set-caption: pass --text "…", --file <path>, or --clear');
    const caption = clear ? null : file !== undefined ? readFileSync(file, 'utf8').replace(/\n+$/, '') : text!;
    const client = createAdminClient();
    const res = await setSlideCaption(client, kind, { parentId: id, slideId: strFlag(flags, 'slide'), caption });
    console.log(JSON.stringify({
      ok: true, ...res, max: POST_CAPTION_MAX, cleared: caption === null,
      ...(caption !== null ? { captionCheck: captionReport(caption) } : {}),
    }, null, 2));
    return;
  }

  if (cmd === 'add-chart') {
    // Add an artist index chart (the CLI analog of the editor's ChartSearchCard):
    // resolves the artist through the running app, snapshots series + releases onto
    // the box (self-contained render), sizes to the editor's default aspect when
    // --height is omitted.
    const id = strFlag(flags, 'id');
    const slideId = strFlag(flags, 'slide');
    if (!id || !slideId) throw new Error('add-chart: --id <template|post id> --slide <slideId> are required');
    const kind = parseKind(flags, 'post');
    const appUrl = strFlag(flags, 'app') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3011';
    const patch = applyWindowFlags(
      flags.set !== undefined ? parsePairs(String(strFlag(flags, 'set')), 'add-chart --set') : undefined,
      flags, 'add-chart');

    const snapshot = await resolveArtistSnapshot(appUrl, { artist: strFlag(flags, 'artist'), spotifyId: strFlag(flags, 'spotify-id') });

    // Geometry is HOUSE STYLE, decided in persist (addChartElement): 960 wide
    // with 60px gutters, always centred, and the layout auto-fitted to the room
    // above whatever sits below it — mobile when it fits, desktop when it does
    // not. --x is deliberately not a flag. --width/--height are escape hatches;
    // passing --height opts out of the auto-fit.
    const widthFlag = strFlag(flags, 'width');
    const width = widthFlag !== undefined ? Number(widthFlag) : undefined;
    if (width !== undefined && (!Number.isFinite(width) || width <= 0)) throw new Error('add-chart: --width must be a number > 0');
    const heightFlag = strFlag(flags, 'height');
    const height = heightFlag !== undefined ? Number(heightFlag) : undefined;
    if (height !== undefined && (!Number.isFinite(height) || height <= 0)) throw new Error('add-chart: --height must be a number > 0');
    const y = Number(strFlag(flags, 'y') ?? '110');
    if (!Number.isFinite(y)) throw new Error('add-chart: --y must be a number');
    const zRaw = strFlag(flags, 'z');
    if (zRaw !== undefined && zRaw !== 'top' && zRaw !== 'bottom') throw new Error("add-chart: --z must be 'top' or 'bottom'");

    const client = createAdminClient();
    const res = await addChartElement(client, kind, {
      parentId: id, slideId, snapshot, y, width, height,
      z: zRaw as 'top' | 'bottom' | undefined, name: strFlag(flags, 'name'), patch,
    });
    // A gap in the snapshot is drawn as one straight segment, which reads as a flat
    // market and gets written up as one. Surface it so the slide text never
    // narrates a period when the backend simply had nothing.
    const gaps = patch?.startDate
      ? findChartDataGaps((snapshot.data as { timestamp?: string }[] ?? []).filter(d => !d.timestamp || d.timestamp >= String(patch.startDate)), 'ALL')
      : findChartDataGaps(snapshot.data as { timestamp?: string }[], String(patch?.period ?? 'ALL'));
    console.log(JSON.stringify({
      ok: true, ...res, artist: snapshot.matchedName, spotifyId: snapshot.spotifyId,
      ...(gaps.length ? { dataGaps: gaps, warning: `This window contains ${gaps.length} gap(s) with NO data. The chart draws them as a straight line. Do NOT describe them as flat or steady — pick a period that starts after ${gaps[gaps.length - 1].to}.` } : {}),
    }, null, 2));
    return;
  }

  if (cmd === 'set-chart') {
    // Reconfigure an existing chart box: display fields via --set k=v (period, mode,
    // layout, show* toggles, colours…), geometry via --x/--y/--width/--height, and/or
    // re-point at another artist (--artist/--spotify-id → fresh data snapshot).
    const id = strFlag(flags, 'id');
    const boxId = strFlag(flags, 'box');
    if (!id || !boxId) throw new Error('set-chart: --id <template|post id> --box <chartBoxId> are required');
    const kind = parseKind(flags, 'post');
    const patch = applyWindowFlags(
      flags.set !== undefined ? parsePairs(String(strFlag(flags, 'set')), 'set-chart --set') : undefined,
      flags, 'set-chart');
    const geom: Record<'x' | 'y' | 'width' | 'height', number | undefined> = { x: undefined, y: undefined, width: undefined, height: undefined };
    for (const k of ['x', 'y', 'width', 'height'] as const) {
      const v = strFlag(flags, k);
      if (v !== undefined) {
        const num = Number(v);
        if (!Number.isFinite(num) || ((k === 'width' || k === 'height') && num <= 0)) throw new Error(`set-chart: --${k} must be a number${k === 'width' || k === 'height' ? ' > 0' : ''}`);
        geom[k] = num;
      }
    }
    const artist = strFlag(flags, 'artist');
    const spotifyId = strFlag(flags, 'spotify-id');
    let snapshot: ChartSnapshot | undefined;
    if (artist || spotifyId) {
      const appUrl = strFlag(flags, 'app') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3011';
      snapshot = await resolveArtistSnapshot(appUrl, { artist, spotifyId });
    }
    const standard = flags.standard === true || flags.standard === 'true';
    if (!patch && !snapshot && !standard && Object.values(geom).every(v => v === undefined)) {
      throw new Error('set-chart: nothing to change — pass --set k=v, geometry flags, --standard, or --artist/--spotify-id');
    }
    const client = createAdminClient();
    const res = await setChartConfig(client, kind, { parentId: id, boxId, slideId: strFlag(flags, 'slide'), patch, ...geom, snapshot, standard });
    // Echo which artist a re-snapshot resolved to — search takes the top hit, so a
    // wrong match must be visible in the output, not silent.
    console.log(JSON.stringify({ ok: true, ...res, ...(snapshot ? { artist: snapshot.artistName, spotifyId: snapshot.spotifyId } : {}) }, null, 2));
    return;
  }

  if (cmd === 'set-image-style') {
    // Presentation knobs on an image box: opacity, corner radius, blend mode, per-edge
    // fade, drop shadow. Value flags accept 'none' to clear that facet.
    //   --fade "top=200,bottom=0,color=#000000" | --fade none
    //   --shadow "blur=24,x=0,y=8,opacity=60,color=#000000,lift=0" | --shadow none
    const id = strFlag(flags, 'id');
    const boxId = strFlag(flags, 'box');
    if (!id || !boxId) throw new Error('set-image-style: --id <template|post id> --box <imageBoxId> are required');
    const kind = parseKind(flags, 'post');

    // --behind-subject <hostBoxId> tucks this box between the host's background
    // and its subject, so it passes BEHIND the subject where they overlap.
    const behindRaw = strFlag(flags, 'behind-subject');
    const opacityRaw = strFlag(flags, 'opacity');
    const radiusRaw = strFlag(flags, 'corner-radius');
    const blendRaw = strFlag(flags, 'blend');
    const fadeRaw = strFlag(flags, 'fade');
    const shadowRaw = strFlag(flags, 'shadow');

    let fade: ImageBoxFade | null | undefined;
    if (fadeRaw !== undefined) {
      if (fadeRaw === 'none') fade = null;
      else {
        const pairs = parsePairs(fadeRaw, '--fade');
        const edges = { top: 0, bottom: 0, left: 0, right: 0 };
        let color: string | undefined;
        for (const [k, v] of Object.entries(pairs)) {
          if (k === 'color') {
            // The renderer's hexToRgba parses fixed #RRGGBB slices; anything else
            // (e.g. #fff, red) makes addColorStop THROW and crashes the slide draw.
            if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw new Error(`--fade color must be a 6-digit hex colour like #000000 (got ${JSON.stringify(v)})`);
            color = v; continue;
          }
          if (!(k in edges)) throw new Error(`--fade: unknown key "${k}" (top/bottom/left/right/color)`);
          // Fade edges are PERCENT of the box dimension (what the editor's 0-100%
          // sliders write) — NOT pixels; the draw computes reach as boxDim * v/100.
          if (typeof v !== 'number' || v < 0 || v > 100) throw new Error(`--fade ${k} must be 0-100 (percent of the box dimension, like the editor's sliders)`);
          edges[k as keyof typeof edges] = v;
        }
        if (Object.values(edges).every(v => v === 0)) throw new Error('--fade: give at least one non-zero edge (or "none" to clear)');
        fade = { enabled: true, ...edges, ...(color ? { color } : {}) };
      }
    }

    let shadow: ShadowStyle | null | undefined;
    if (shadowRaw !== undefined) {
      if (shadowRaw === 'none') shadow = null;
      else {
        const pairs = parsePairs(shadowRaw, '--shadow');
        const base = { ...defaultShadowStyle(), enabled: true };
        // No 'lift': image-box shadows never read it (applyShadow ignores it, and
        // the editor hides Lift for image boxes) — accepting it would lie.
        const keyMap: Record<string, keyof ShadowStyle> = { blur: 'blur', x: 'offsetX', y: 'offsetY', opacity: 'opacity', color: 'color' };
        for (const [k, v] of Object.entries(pairs)) {
          const prop = keyMap[k];
          if (!prop) throw new Error(`--shadow: unknown key "${k}" (blur/x/y/opacity/color)`);
          if (prop === 'color') {
            // applyShadow parses fixed #RRGGBB(AA) slices — shorter hex renders NO shadow.
            if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v)) throw new Error('--shadow color must be #RRGGBB or #RRGGBBAA');
            base.color = v;
          } else {
            if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`--shadow ${k} must be a number`);
            (base as unknown as Record<string, unknown>)[prop] = v;
          }
        }
        shadow = base;
      }
    }

    const client = createAdminClient();
    const res = await setImageStyle(client, kind, {
      parentId: id, boxId, slideId: strFlag(flags, 'slide'),
      behindSubjectOf: behindRaw === undefined ? undefined : (behindRaw === 'none' ? null : behindRaw),
      opacity: opacityRaw !== undefined ? Number(opacityRaw) : undefined,
      cornerRadius: radiusRaw !== undefined ? Number(radiusRaw) : undefined,
      blend: blendRaw === undefined ? undefined : (blendRaw === 'none' ? null : blendRaw),
      fade, shadow,
    });
    console.log(JSON.stringify({ ok: true, ...res }, null, 2));
    return;
  }

  if (cmd === 'set-crop') {
    // Per-edge source crop, as FRACTIONS of the source image hidden on each edge:
    //   set-crop --id --box --rect "top=0.1,bottom=0,left=0.2,right=0"  |  --none
    const id = strFlag(flags, 'id');
    const boxId = strFlag(flags, 'box');
    if (!id || !boxId) throw new Error('set-crop: --id <template|post id> --box <imageBoxId> are required');
    const kind = parseKind(flags, 'post');
    const none = flags.none === true || flags.none === 'true';
    const rectRaw = strFlag(flags, 'rect');
    if (!none && rectRaw === undefined) throw new Error('set-crop: pass --rect "top=0.1,left=0.2,…" (fractions 0-0.95) or --none to clear');
    let crop: { top: number; bottom: number; left: number; right: number } | null = null;
    if (!none) {
      const pairs = parsePairs(rectRaw!, '--rect');
      crop = { top: 0, bottom: 0, left: 0, right: 0 };
      for (const [k, v] of Object.entries(pairs)) {
        if (!(k in crop)) throw new Error(`--rect: unknown key "${k}" (top/bottom/left/right)`);
        if (typeof v !== 'number') throw new Error(`--rect ${k} must be a number (fraction 0-0.95)`);
        crop[k as keyof typeof crop] = v;
      }
    }
    const client = createAdminClient();
    const res = await setImageCrop(client, kind, { parentId: id, boxId, slideId: strFlag(flags, 'slide'), crop });
    console.log(JSON.stringify({ ok: true, ...res }, null, 2));
    return;
  }

  if (cmd === 'distort') {
    // Freeform perspective warp: per-corner offsets in canvas px (dx,dy added to the
    // box's natural corners). Omitted corners stay at 0,0. `rotate` is the pure-
    // rotation special case of this; both write the same stored quad.
    //   distort --id --box [--tl dx,dy] [--tr dx,dy] [--br dx,dy] [--bl dx,dy] | --none
    const id = strFlag(flags, 'id');
    const boxId = strFlag(flags, 'box');
    if (!id || !boxId) throw new Error('distort: --id <template|post id> --box <imageBoxId> are required');
    const kind = parseKind(flags, 'post');
    const none = flags.none === true || flags.none === 'true';
    let quad: ImageBoxPerspective | null = null;
    if (!none) {
      const corner = (name: 'tl' | 'tr' | 'br' | 'bl') => {
        const raw = strFlag(flags, name);
        if (raw === undefined) return { x: 0, y: 0 };
        const parts = raw.split(',');
        // Number('') === 0, so "30," would silently mean dy=0 — reject it instead.
        if (parts.length !== 2 || parts[0].trim() === '' || parts[1].trim() === '') throw new Error(`distort: --${name} wants "dx,dy" (got "${raw}")`);
        const x = Number(parts[0]), y = Number(parts[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`distort: --${name} wants "dx,dy" numbers (got "${raw}")`);
        return { x, y };
      };
      quad = { tl: corner('tl'), tr: corner('tr'), br: corner('br'), bl: corner('bl') };
      if ([quad.tl, quad.tr, quad.br, quad.bl].every(c => c.x === 0 && c.y === 0)) {
        throw new Error('distort: all corners are 0,0 — pass at least one offset (or --none to clear)');
      }
    }
    const client = createAdminClient();
    const res = await setImagePerspective(client, kind, { parentId: id, boxId, slideId: strFlag(flags, 'slide'), quad });
    console.log(JSON.stringify({ ok: true, ...res }, null, 2));
    return;
  }

  if (cmd === 'inspect') {
    const id = strFlag(flags, 'id');
    if (!id) throw new Error('inspect: --id <template|post id> is required');
    const kind = parseKind(flags, 'template');
    const client = createAdminClient();
    const summary = await inspectDesign(client, kind, id);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (cmd === 'duplicate') {
    const id = strFlag(flags, 'id');
    if (!id) throw new Error('duplicate: --id <template|post id> is required');
    const kind = parseKind(flags, 'template');
    const userId = strFlag(flags, 'user') ?? DEFAULT_USER;
    const name = strFlag(flags, 'name');
    const client = createAdminClient();
    const res = await duplicateDesign(client, kind, { sourceId: id, userId, name });
    console.log(JSON.stringify({ ok: true, kind, id: res.id, slideIds: res.slideIds }, null, 2));
    return;
  }

  if (cmd === 'render') {
    const appUrl = strFlag(flags, 'app') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3011';
    const preview = flags.preview === true || flags.preview === 'true';   // draw empty-placeholder frames

    // --spec: render a design spec directly (no DB write) — fast visual iteration.
    const specPath = strFlag(flags, 'spec');
    if (specPath) {
      const spec = validateDesignSpec(JSON.parse(readFileSync(specPath, 'utf8')));
      const slides = buildSlides(spec);
      const idx = Number(strFlag(flags, 'slide-index') ?? '0');
      if (!Number.isInteger(idx) || idx < 0 || idx >= slides.length) {
        throw new Error(`--slide-index out of range (0..${slides.length - 1})`);
      }
      const out = strFlag(flags, 'out') ?? `spec-slide-${idx}.png`;
      const r = await renderSlideRowToPng(slides[idx], appUrl, out, preview);
      console.log(JSON.stringify({ ok: true, out, ...r }, null, 2));
      return;
    }

    // --id --all: render EVERY slide of a design in position order — one visual
    // review command instead of one render per slide.
    const designId = strFlag(flags, 'id');
    if (designId && (flags.all === true || flags.all === 'true')) {
      const kind = parseKind(flags, 'post');
      const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
      const outDir = strFlag(flags, 'out-dir') ?? `render-${designId.slice(0, 8)}`;
      const client = createAdminClient();
      const { data: rows, error } = await client
        .from(tables.slides).select('id, position, name').eq(tables.slideFk, designId).order('position');
      if (error) throw new Error(`fetch slides failed: ${error.message}`);
      const slides = (rows ?? []) as { id: string; position: number; name: string | null }[];
      if (!slides.length) throw new Error(`${kind} ${designId} not found or has no slides (--all defaults to --kind post; pass --kind template for templates)`);
      const { mkdirSync } = await import('node:fs');
      mkdirSync(outDir, { recursive: true });
      // One bad slide must not strand the rest of the batch (or eat the summary
      // for the slides that DID render) — record per-slide errors and continue.
      const outs: ({ slideId: string; out: string; width: number; height: number; bytes: number } | { slideId: string; error: string })[] = [];
      for (const sl of slides) {
        const safe = ((sl.name || 'slide')).replace(/[^\w.-]+/g, '_');
        const out = `${outDir}/${String(sl.position).padStart(2, '0')}-${safe}.png`;
        try {
          const r = await renderSlideToPng({ slideId: sl.id, kind, appUrl, outPath: out, preview });
          outs.push({ slideId: sl.id, out, ...r });
        } catch (e) {
          outs.push({ slideId: sl.id, error: e instanceof Error ? e.message : String(e) });
        }
      }
      const failed = outs.filter(o => 'error' in o).length;
      console.log(JSON.stringify({ ok: failed === 0, kind, id: designId, outDir, rendered: outs.length - failed, failed, slides: outs }, null, 2));
      return;
    }

    const slideId = strFlag(flags, 'slide');
    if (!slideId) throw new Error('render: --slide <slideId>, --id <designId> --all, or --spec <file.json> is required');
    const kind = parseKind(flags, 'template');
    const out = strFlag(flags, 'out') ?? `slide-${slideId}.png`;
    const { width, height, bytes } = await renderSlideToPng({ slideId, kind, appUrl, outPath: out, preview });
    console.log(JSON.stringify({ ok: true, out, width, height, bytes }, null, 2));
    return;
  }

  if (cmd === 'publish') {
    // DRY RUN ONLY — prepares the payload; never posts. Live publishing runs through the
    // app route (team-password unlock + connected IG token, both session-bound).
    const id = strFlag(flags, 'id');
    if (!id) throw new Error('publish: --id <template|post id> is required');
    const kind = parseKind(flags, 'post');
    const userId = strFlag(flags, 'user') ?? DEFAULT_USER;
    const caption = strFlag(flags, 'caption') ?? '';
    const appUrl = strFlag(flags, 'app') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3011';

    const payload = await preparePublish({ id, kind, userId, caption, appUrl });
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      note: 'Prepared only — NOT posted. Publishing runs through the app (team-password unlock + connected Instagram account); the CLI intentionally does not post.',
      endpoint: 'POST /api/posts/instagram/publish',
      payload,
    }, null, 2));
    return;
  }

  if (cmd === 'assets') {
    const ref = strFlag(flags, 'file') ?? strFlag(flags, 'url');
    if (!ref) throw new Error('assets: --file <path> or --url <url> is required');
    const userId = strFlag(flags, 'user') ?? DEFAULT_USER;
    const client = createAdminClient();
    const res = await resolveImageRef(client, userId, ref);
    console.log(JSON.stringify({ ok: true, ...res }, null, 2));
    return;
  }

  console.log([
    'canvas CLI',
    '  tsx scripts/canvas.ts demo',
    '  tsx scripts/canvas.ts create --kind template|post --name "..." --user <uuid> --spec spec.json',
    '  tsx scripts/canvas.ts create --from-template <templateId> --name "..."          → new POST from a template',
    '  tsx scripts/canvas.ts render --slide <slideId> --kind template|post --out out.png',
    '  tsx scripts/canvas.ts render --id <designId> --all [--out-dir dir]              → every slide, position order',
    '  tsx scripts/canvas.ts assets  (--file <path> | --url <url>) [--user <uuid>]   → public image URL',
    '  tsx scripts/canvas.ts publish --id <id> --kind template|post [--caption "..."]  → DRY RUN payload (never posts)',
    '  tsx scripts/canvas.ts duplicate --id <id> --kind template|post [--name "..."]   → clone a design',
    '  tsx scripts/canvas.ts add-image --id <id> --slide <slideId> --image <file|url> [--x --y --width --height --z top|bottom --cover]',
    '  tsx scripts/canvas.ts stroke --id <id> --box <imageBoxId> [--color #fff --width 12 | --off]  → subject outline',
    '  tsx scripts/canvas.ts remove-image --id <id> --box <imageBoxId>',
    '  tsx scripts/canvas.ts set-effects --id <id> --box <imageBoxId> [--layer fg|bg] [--blur N --noise N --brightness N | --none]  → --layer bg blurs the BACKGROUND of a split box',
    '  tsx scripts/canvas.ts rotate --id <id> --box <imageBoxId> --degrees <-180..180>  → rotate about centre (+ve = clockwise, 0 clears)',
    '  tsx scripts/canvas.ts set-image --id <id> --box <imageBoxId> --image <file|url> [--fg <file|url>] [--keep-size]  → swap the image, keep the composition',
    '  tsx scripts/canvas.ts move --id <id> --box <imageBoxId> [--x N --y N --width N --height N]  → move/resize an image box',
    '  tsx scripts/canvas.ts set-caption --id <id> [--slide <slideId>] [--text "…" | --file <path> | --clear]  → PER-SLIDE IG caption (slide 0 publishes; max 2199). RULES: src/lib/template-editor/CAPTIONS.md',
    '  tsx scripts/canvas.ts add-slide --id <id> [--from <slideId>] [--name "…"]        → append a slide (--from deep-clones it)',
    '  tsx scripts/canvas.ts remove-chart --id <id> --box <chartBoxId> [--slide <slideId>]',
    '  tsx scripts/canvas.ts poster --id <id> --box <videoBoxId> [--at 0.1]  → still frame for a video box, so PNG renders work',
    '  tsx scripts/canvas.ts border --id <id> --box <imageBoxId> [--width 2] [--color #ffffff] [--radius 14] [--pad 24]  → bake an edge (and rounding) into a pasted image; zeroes cornerRadius',
    '  tsx scripts/canvas.ts feather --id <id> --box <imageBoxId> [--amount 1.5] [--erode 2] → clean a cut-out silhouette; [--edges 70 | --edges "bottom=350"] → dissolve borders (all sides, or one)',
    '  tsx scripts/canvas.ts expand-image --id <id> --box <imageBoxId>                  → AI-outpaint the image to fill the canvas, IN PLACE',
    '  tsx scripts/canvas.ts split-image --id <id> --box <imageBoxId> [--blur 0-40] [--blur N | --drop-bg] [--bg-noise N --fg-noise N]  → cut the subject out; --blur = house background blur, --drop-bg = remove the background entirely (secondary objects)',
    '  tsx scripts/canvas.ts inspect --id <id> --kind template|post                    → agent-readable summary',
    '  tsx scripts/canvas.ts lock --id <id> --box <textBoxId> --props vAlign,geometry,…|none  → posts-mode style locks',
    '  tsx scripts/canvas.ts set-text --id <id> --box <textBoxId> --text "**Pop** rest\\nline2"  → rewrite text (+secondary runs)',
    '  tsx scripts/canvas.ts fill --id <id> --kind template|post --image <file|url> [--slide N --slot N]  → fill an image placeholder',
    '  tsx scripts/canvas.ts add-chart --id <id> --slide <slideId> (--artist "name" | --spotify-id ID) [--y --z --set k=v,…]  → 960 wide, 60px gutters, centred; layout auto-fits (desktop when mobile is too tall). --from/--to = arbitrary window, e.g. --from 2026-07-28',
    '  tsx scripts/canvas.ts set-chart --id <id> --box <chartBoxId> [--standard → re-apply house geometry + auto-fit] [--set period=1Y,mode=candle,…] [--y] [--artist|--spotify-id → re-snapshot] [--from 2026-07-28 --to 2026-08-25 | --from none → clear]',
    '  tsx scripts/canvas.ts set-image-style --id <id> --box <imageBoxId> [--opacity 0-100] [--corner-radius N] [--blend multiply|…|none] [--fade "top=40,color=#000000"|none] [--shadow "blur=24,y=8,opacity=60"|none] [--behind-subject <hostBoxId>|none → tuck behind that split box\'s subject]',
    '  tsx scripts/canvas.ts set-crop --id <id> --box <imageBoxId> --rect "top=0.1,left=0.2" | --none   → per-edge source crop (fractions)',
    '  tsx scripts/canvas.ts distort --id <id> --box <imageBoxId> [--tl dx,dy --tr dx,dy --br dx,dy --bl dx,dy] | --none  → freeform perspective',
  ].join('\n'));
}

main().catch((err: unknown) => {
  console.error('ERROR:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
