// ─────────────────────────────────────────────────────────────────────────────
// Persistence — write a template or post (+ its slides) to Supabase from Node,
// via the service-role client. Mirrors the hook's create path minus the React
// debounce/undo/optimistic-concurrency machinery. Phase 4 replaces the manual
// parent-rollback with a single Postgres transaction (RPC).
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { slideToRow, rowToSlide, TEMPLATE_TABLES, POST_TABLES } from './slide-serde';
import type { SlideRow, TableConfig } from './slide-serde';
import { defaultCarouselSettings, stripUnfilledPlaceholders, defaultImageBox, defaultChartBox, IMAGES_LAYER_ID, perspectiveForRotation, rotationFromPerspective } from '../../app/components/templateEditorTypes';
import type { ImageBoxFade, ImageBoxCrop, ImageBoxPerspective, ShadowStyle, ChartRelease } from '../../app/components/templateEditorTypes';
import { orderedLayerIds, FADE_LAYER_ID, safeZone, outsideSafeZone } from '../../app/components/templateEditorTypes';
import type { CarouselSettings } from '../../app/components/templateEditorTypes';
import { chartAspect } from '../../app/components/TemplateEditorCanvas/drawing/chart';

export interface CreateResult {
  id: string;         // parent (template | post) id
  slideIds: string[];
}

// Next append position for this user (mirrors the editor's append-to-end convention, so
// CLI-created designs don't all pile up at position 0). Best-effort: falls back to 0.
async function nextPosition(client: SupabaseClient, table: string, userId: string): Promise<number> {
  const { data } = await client
    .from(table).select('position').eq('user_id', userId)
    .order('position', { ascending: false }).limit(1).maybeSingle();
  const top = (data as { position: number | null } | null)?.position;
  return typeof top === 'number' ? top + 1 : 0;
}

async function createDesign(
  client: SupabaseClient,
  tables: TableConfig,
  parentRow: Record<string, unknown>,
  slides: SlideRow[],
): Promise<CreateResult> {
  if (slides.length === 0) throw new Error('createDesign: at least one slide is required');

  const { data: parent, error: pErr } = await client
    .from(tables.parent).insert(parentRow).select('id').single();
  if (pErr || !parent) throw new Error(`parent insert failed: ${pErr?.message ?? 'no row returned'}`);
  const parentId = (parent as { id: string }).id;

  // Re-index positions 0..n and attach the FK; slideToRow explodes each into columns.
  const rows = slides.map((s, i) => ({
    ...slideToRow({ ...s, position: i }),
    [tables.slideFk]: parentId,
  }));

  const { data: inserted, error: sErr } = await client
    .from(tables.slides).insert(rows).select('id');
  if (sErr) {
    // Compensate: no partial parent without slides. (True atomicity needs an RPC — see CLI.md.)
    const { error: delErr } = await client.from(tables.parent).delete().eq('id', parentId);
    const rollback = delErr
      ? `ROLLBACK ALSO FAILED — parent ${parentId} is orphaned: ${delErr.message}`
      : `parent ${parentId} rolled back`;
    throw new Error(`slides insert failed (${rollback}): ${sErr.message}`);
  }

  return { id: parentId, slideIds: ((inserted ?? []) as { id: string }[]).map(r => r.id) };
}

export async function createTemplate(
  client: SupabaseClient,
  opts: { userId: string; name: string; slides: SlideRow[]; position?: number },
): Promise<CreateResult> {
  const position = opts.position ?? await nextPosition(client, TEMPLATE_TABLES.parent, opts.userId);
  return createDesign(
    client, TEMPLATE_TABLES,
    { user_id: opts.userId, name: opts.name, position },
    opts.slides,
  );
}

// Create a POST from a TEMPLATE: deep-clone the template's slides into the post
// tables (fresh slide ids; element locks + slide locked_settings ride along in the
// cloned data) and record provenance in source_template_id. Mirrors the editor's
// createFromTemplate. The post starts as a draft at the next position.
export async function createPostFromTemplate(
  client: SupabaseClient,
  opts: { templateId: string; userId: string; name: string; fillImage?: string; fillImageDims?: { width: number; height: number } },
): Promise<CreateResult & { sourceTemplateId: string; filledSlot?: string; strippedSlots: number; lockedCaptions: number }> {
  const { data: srcRows, error: srcErr } = await client
    .from(TEMPLATE_TABLES.slides).select('*')
    .eq(TEMPLATE_TABLES.slideFk, opts.templateId).order('position');
  if (srcErr) throw new Error(`fetch template slides failed: ${srcErr.message}`);
  let slides = ((srcRows ?? []) as Record<string, unknown>[]).map(rowToSlide);
  if (slides.length === 0) throw new Error(`template ${opts.templateId} not found or has no slides`);

  // Image-layer markers are template-only visuals — a post never contains one. The
  // marker's z-position survives as the __images__ sentinel (stripUnfilledPlaceholders),
  // which is where added images insert. --image adds a REGULAR cover-fit image at the
  // first marker's geometry and z-position (nothing is "filled"; the marker stays gone).
  let markerGeom: { x: number; y: number; width: number; height: number; name?: string; slideIdx: number } | undefined;
  for (let i = 0; i < slides.length && !markerGeom; i++) {
    for (const b of slides[i].settings.imageBoxes ?? []) {
      if (b.placeholder && !b.url) { markerGeom = { x: b.x, y: b.y, width: b.width, height: b.height, name: b.name, slideIdx: i }; break; }
    }
  }
  if (opts.fillImage && !markerGeom) throw new Error(`--image given but template ${opts.templateId} has no image-layer marker`);

  let strippedSlots = 0;
  slides = slides.map(sl => {
    const before = (sl.settings.imageBoxes ?? []).length;
    const settings = stripUnfilledPlaceholders(sl.settings);
    strippedSlots += before - (settings.imageBoxes ?? []).length;
    return { ...sl, settings };
  });

  let filledSlot: string | undefined;
  if (opts.fillImage && markerGeom) {
    const sl = slides[markerGeom.slideIdx];
    // FIT-TO-WIDTH: the photo spans the marker's width at its natural aspect (no crop);
    // the marker's height is just a visual guide. Falls back to the marker's height when
    // the caller didn't probe the image dimensions.
    const height = opts.fillImageDims
      ? Math.round(markerGeom.width * (opts.fillImageDims.height / opts.fillImageDims.width))
      : markerGeom.height;
    const box = {
      ...defaultImageBox({ url: opts.fillImage, x: markerGeom.x, y: markerGeom.y, width: markerGeom.width, height }),
      fit: 'cover' as const,
      ...(markerGeom.name ? { name: markerGeom.name } : {}),
    };
    const imageBoxes = [...(sl.settings.imageBoxes ?? []), box];
    let order = sl.settings.layerOrderIds;
    if (order) {
      const at = order.indexOf(IMAGES_LAYER_ID);
      order = at >= 0 ? [...order.slice(0, at), box.id, ...order.slice(at)] : [...order, box.id];
    }
    sl.settings = { ...sl.settings, imageBoxes, ...(order ? { layerOrderIds: order } : {}) };
    filledSlot = box.id;
  }

  // A caption WRITTEN on the template slide is a STARTING POINT, not boilerplate:
  // it is copied into the post (autofill) and left editable, because the end card's
  // caption is meant to be paraphrased per post rather than repeated verbatim across
  // the account. It used to arrive locked ("filled = locked, blank = free"); that
  // made identical closing text ship on every post, which reads as boilerplate to
  // anyone who follows the account. A template caption that genuinely must not
  // change can still be pinned by putting 'caption' in the template slide's own
  // lockedSettings, which is carried through untouched below.
  const lockedCaptions = slides.filter(
    sl => sl.caption?.trim() && (sl.settings.lockedSettings ?? []).includes('caption'),
  ).length;

  const res = await createPost(client, {
    userId: opts.userId, name: opts.name, slides,
    status: 'draft', sourceTemplateId: opts.templateId,
  });
  return { ...res, sourceTemplateId: opts.templateId, filledSlot, strippedSlots, lockedCaptions };
}

// Rewrite one text box's content. `spans` (when given) carries the styling runs —
// e.g. secondary-weight pop words — and MUST cover exactly the same characters as
// `text` (spans override text at render). Pass spans: undefined for plain text
// (clears any existing runs so stale spans can't override the new text). Text is
// never lock-gated — that's the whole point of the lock system. Note: singleLine
// width violations are caught by the render guard, not here (Node has no font metrics).
export async function setElementText(
  client: SupabaseClient,
  kind: 'template' | 'post',
  opts: { parentId: string; boxId: string; text: string; spans?: { text: string; secondary?: boolean; weight?: number }[]; slideId?: string },
): Promise<{ slideId: string; boxId: string; text: string; spanCount: number }> {
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
  if (opts.spans) {
    const joined = opts.spans.map(s => s.text).join('');
    if (joined !== opts.text) throw new Error(`spans must cover exactly the text (spans join to "${joined}", text is "${opts.text}")`);
  }
  const { data: rows, error } = await client
    .from(tables.slides).select('id, text_boxes').eq(tables.slideFk, opts.parentId);
  if (error) throw new Error(`fetch slides failed: ${error.message}`);

  // Element ids survive slide duplication, so the same boxId can exist on several
  // slides. Writing "the first match" silently edits the wrong slide — find ALL
  // matches and demand --slide when ambiguous.
  const all = (rows ?? []) as { id: string; text_boxes: Record<string, unknown>[] | null }[];
  const matches = all.filter(r => (r.text_boxes ?? []).some(b => b.id === opts.boxId));
  if (matches.length === 0) throw new Error(`text box ${opts.boxId} not found in any slide of ${kind} ${opts.parentId}`);
  const target = opts.slideId
    ? matches.find(r => r.id === opts.slideId)
    : matches.length === 1 ? matches[0] : undefined;
  if (!target) {
    throw new Error(opts.slideId
      ? `text box ${opts.boxId} not found on slide ${opts.slideId}`
      : `text box ${opts.boxId} exists on ${matches.length} slides (${matches.map(r => r.id).join(', ')}) — pass --slide <slideId> to disambiguate`);
  }

  const boxes = target.text_boxes ?? [];
  const idx = boxes.findIndex(b => b.id === opts.boxId);
  const next = boxes.map((b, i) => {
    if (i !== idx) return b;
    // Drop old spans AND the lorem-filler flag: writing real text claims the box
    // (mirrors the editor's commit). Leaving fillPlaceholder:true would let the
    // canvas's placeholder effect overwrite this text with lorem on next open.
    const { spans: _drop, fillPlaceholder: _fp, ...rest } = b;
    return opts.spans ? { ...rest, text: opts.text, spans: opts.spans } : { ...rest, text: opts.text };
  });
  const { error: upErr } = await client.from(tables.slides).update({ text_boxes: next }).eq('id', target.id);
  if (upErr) throw new Error(`update failed: ${upErr.message}`);
  return { slideId: target.id, boxId: opts.boxId, text: opts.text, spanCount: opts.spans?.length ?? 0 };
}

// Patch a slide's SETTINGS values (canvasColor, fade knobs, …) from the CLI: fetch
// the row, merge the camelCase patch over the deserialized settings, and write the
// row back through slideToRow (the same full-column serialization the editor's
// autosave uses). Keys are validated against defaultCarouselSettings().
export async function setSlideSettings(
  client: SupabaseClient,
  kind: 'template' | 'post',
  opts: { parentId: string; slideId: string; patch: Record<string, unknown> },
): Promise<{ slideId: string; applied: Record<string, unknown> }> {
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;

  // Only SCALAR settings are settable here (canvasColor, fade knobs, toggles, …).
  // Structural fields (textBoxes, imageBoxes, layerOrderIds, slots, spans, …) have
  // their own commands — admitting them let one bad k=v pair destroy every element
  // on the slide. Values are also type-checked against the default's type.
  const defs = defaultCarouselSettings() as unknown as Record<string, unknown>;
  const scalar = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
  for (const [k, v] of Object.entries(opts.patch)) {
    if (!(k in defs)) throw new Error(`unknown settings key: ${k}`);
    if (!scalar(defs[k])) throw new Error(`"${k}" is structural — not settable via set-settings (use the element commands)`);
    const dt = typeof defs[k];
    if (defs[k] !== null && v !== null && typeof v !== dt) {
      throw new Error(`"${k}" expects a ${dt} (got ${typeof v}: ${JSON.stringify(v)})`);
    }
  }

  const { data: row, error } = await client
    .from(tables.slides).select('*')
    .eq('id', opts.slideId).eq(tables.slideFk, opts.parentId).single();
  if (error || !row) throw new Error(`slide ${opts.slideId} not found in ${kind} ${opts.parentId}: ${error?.message ?? 'no row'}`);

  const slide = rowToSlide(row as Record<string, unknown>);

  // Posts honour template locks in the CLI too: settings the template locked are not
  // writable here, same as they're hidden in the posts UI. (Templates edit freely.)
  if (kind === 'post' && slide.settings.lockedSettings?.length) {
    const lockedHit = Object.keys(opts.patch).filter(k => slide.settings.lockedSettings!.includes(k));
    if (lockedHit.length) throw new Error(`locked by template (not writable on posts): ${lockedHit.join(', ')}`);
  }

  const merged = { ...slide, settings: { ...slide.settings, ...opts.patch } as typeof slide.settings };

  // Write ONLY the columns the patch actually changed (diff of the serialized rows) —
  // a full-row update would silently revert columns a concurrent editor save changed
  // between our read and write.
  const before = slideToRow(slide) as Record<string, unknown>;
  const after = slideToRow(merged) as Record<string, unknown>;
  const changed: Record<string, unknown> = {};
  for (const col of Object.keys(after)) {
    if (JSON.stringify(after[col]) !== JSON.stringify(before[col])) changed[col] = after[col];
  }
  if (Object.keys(changed).length === 0) return { slideId: opts.slideId, applied: {} };

  const { error: upErr } = await client
    .from(tables.slides).update(changed).eq('id', opts.slideId);
  if (upErr) throw new Error(`update failed: ${upErr.message}`);
  return { slideId: opts.slideId, applied: opts.patch };
}

// Add an image element to an existing design's slide (the CLI analog of dropping an
// image onto the canvas). `cover: true` renders it slot-like (object-fit: cover via the
// placeholder draw path — as filled content, so in posts it's inert with no island).
// z: 'top' (default, like a canvas drop) or 'bottom' (behind everything, e.g. a photo
// under the fade/text). Inserting never reorders existing layers relative to each other.
export async function addImageElement(
  client: SupabaseClient,
  kind: 'template' | 'post',
  opts: {
    parentId: string; slideId: string; url: string;
    x: number; y: number; width: number; height: number;
    z?: 'top' | 'bottom'; cover?: boolean; name?: string;
    // Video branding: when set the box plays this source and `url` is its poster
    // frame (the still renderer cannot play video).
    videoUrl?: string;
  },
): Promise<{ slideId: string; boxId: string; outsideSafeZone?: string[] }> {
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
  const { data: row, error } = await client
    .from(tables.slides).select('*')
    .eq('id', opts.slideId).eq(tables.slideFk, opts.parentId).single();
  if (error || !row) throw new Error(`slide ${opts.slideId} not found in ${kind} ${opts.parentId}: ${error?.message ?? 'no row'}`);

  const box = {
    ...defaultImageBox({ url: opts.url, x: opts.x, y: opts.y, width: opts.width, height: opts.height }),
    ...(opts.cover ? { fit: 'cover' as const } : {}),
    ...(opts.name ? { name: opts.name } : {}),
    ...(opts.videoUrl ? { videoUrl: opts.videoUrl, videoMuted: true } : {}),
  };

  const r = row as Record<string, unknown>;
  const boxes = [...((r.image_boxes as Record<string, unknown>[] | null) ?? []), box];
  // Maintain the explicit z-order when one exists; missing arrays keep the fallback ordering.
  // Default insertion targets the template's image-layer marker (__images__ sentinel) when
  // present — that's "where images go" per the template; --z top|bottom overrides.
  let order = (r.layer_order_ids as string[] | null) ?? null;
  if (order) {
    const sentinelAt = order.indexOf(IMAGES_LAYER_ID);
    if (opts.z === 'bottom') order = [box.id, ...order];
    else if (opts.z === 'top' || sentinelAt < 0) order = [...order, box.id];
    else order = [...order.slice(0, sentinelAt), box.id, ...order.slice(sentinelAt)];
  }

  const { error: upErr } = await client
    .from(tables.slides)
    .update({ image_boxes: boxes, ...(order ? { layer_order_ids: order } : {}) })
    .eq('id', opts.slideId);
  if (upErr) throw new Error(`update failed: ${upErr.message}`);
  // Report (don't forbid) a box landing outside the slide's safe zone.
  const zone = safeZone(rowToSlide(r).settings as CarouselSettings);
  const fullBleed = box.x <= 0 && box.y <= 0 && box.width >= 1080 && box.height >= 1350;
  const esc = fullBleed ? [] : outsideSafeZone(box, zone);
  return { slideId: opts.slideId, boxId: box.id, ...(esc.length ? { outsideSafeZone: esc } : {}) };
}

// Set (or clear) the white-outline stroke around a split image box's detected
// subject. Requires the split to exist (splitEnabled + fgUrl) — the stroke is
// drawn from the cut-out's silhouette, so there is nothing to outline without it.
export async function setSubjectStroke(
  client: SupabaseClient,
  kind: 'template' | 'post',
  opts: { parentId: string; boxId: string; stroke: { color: string; width: number } | null },
): Promise<{ slideId: string; boxId: string; stroke: { color: string; width: number } | null }> {
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
  const { data: rows, error } = await client
    .from(tables.slides).select('id, image_boxes').eq(tables.slideFk, opts.parentId);
  if (error) throw new Error(`fetch slides failed: ${error.message}`);

  for (const row of (rows ?? []) as { id: string; image_boxes: Record<string, unknown>[] | null }[]) {
    const boxes = row.image_boxes ?? [];
    const idx = boxes.findIndex(b => b.id === opts.boxId);
    if (idx < 0) continue;
    const b = boxes[idx];
    if (opts.stroke && !(b.splitEnabled && b.fgUrl)) {
      throw new Error('stroke: this image has no detected subject yet (splitEnabled + fgUrl required) — run background detection first');
    }
    const next = boxes.map((bx, i) => {
      if (i !== idx) return bx;
      const { fgStroke: _drop, ...rest } = bx;
      return opts.stroke ? { ...rest, fgStroke: opts.stroke } : rest;
    });
    const { error: upErr } = await client.from(tables.slides).update({ image_boxes: next }).eq('id', row.id);
    if (upErr) throw new Error(`update failed: ${upErr.message}`);
    return { slideId: row.id, boxId: opts.boxId, stroke: opts.stroke };
  }
  throw new Error(`image box ${opts.boxId} not found in any slide of ${kind} ${opts.parentId}`);
}

// Rotate an image box about its centre. The canvas has no first-class rotation —
// the per-corner perspective warp expresses it exactly (and composes with
// split/stroke/effects, since the warp is applied to the finished box buffer at
// blit time). degrees: positive = clockwise on screen (canvas y is down); 0 clears.
// REPLACES any existing perspective warp on the box.
export async function rotateImageElement(
  client: SupabaseClient,
  kind: 'template' | 'post',
  opts: { parentId: string; boxId: string; degrees: number },
): Promise<{ slideId: string; boxId: string; degrees: number }> {
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
  const { data: rows, error } = await client
    .from(tables.slides).select('id, image_boxes').eq(tables.slideFk, opts.parentId);
  if (error) throw new Error(`fetch slides failed: ${error.message}`);

  for (const row of (rows ?? []) as { id: string; image_boxes: Record<string, unknown>[] | null }[]) {
    const boxes = row.image_boxes ?? [];
    const idx = boxes.findIndex(b => b.id === opts.boxId);
    if (idx < 0) continue;
    const b = boxes[idx];
    if (kind === 'post' && Array.isArray(b.lockedProps) && (b.lockedProps as string[]).includes('perspective')) {
      throw new Error('rotate: this element\'s perspective is template-locked — unlock it on the template first');
    }
    const quad = perspectiveForRotation(Number(b.width), Number(b.height), opts.degrees);
    const next = boxes.map((bx, i) => {
      if (i !== idx) return bx;
      const { perspective: _drop, ...rest } = bx;
      return quad ? { ...rest, perspective: quad } : rest;
    });
    const { error: upErr } = await client.from(tables.slides).update({ image_boxes: next }).eq('id', row.id);
    if (upErr) throw new Error(`update failed: ${upErr.message}`);
    return { slideId: row.id, boxId: opts.boxId, degrees: opts.degrees };
  }
  throw new Error(`image box ${opts.boxId} not found in any slide of ${kind} ${opts.parentId}`);
}

// Append a slide to an existing design. Mirrors the editor's addSlide /
// duplicateSlide: appended at the end, auto-named main / supporting_N by
// position. `fromSlideId` deep-clones that slide (fresh id, same elements and
// locks) — the usual way to grow a carousel, since a blank slide has none of the
// template's furniture (texture, logo, text frames).

// Cloning a slide must MINT NEW BOX IDS. The slide row gets a fresh id from the
// DB, but every box inside it is copied verbatim, so a naive clone leaves two
// slides sharing box ids — and then `--box <id>` is ambiguous: CLI edits land on
// whichever slide is found first, silently mutating the wrong one. (This bit us
// for real: a `remove-image` stripped the cover off a different slide.)
// References BETWEEN boxes (layerOrderIds, behindSubjectOf) are remapped through
// the same table so the clone keeps its layering instead of pointing back at the
// original's boxes.
function remapClonedBoxIds(s: CarouselSettings): CarouselSettings {
  const map = new Map<string, string>();
  const mint = <T extends { id?: string }>(box: T): T => {
    if (!box?.id) return box;
    const next = randomUUID();
    map.set(box.id, next);
    return { ...box, id: next };
  };
  const out: CarouselSettings = {
    ...s,
    textBoxes:  (s.textBoxes  ?? []).map(mint),
    imageBoxes: (s.imageBoxes ?? []).map(mint),
    ...(s.chartBoxes ? { chartBoxes: s.chartBoxes.map(mint) } : {}),
  };
  // Sentinels ('__fade__', '__images__', 'background', 'subject') are not box ids
  // and must pass through untouched, so translate only what the map knows.
  if (out.layerOrderIds) out.layerOrderIds = out.layerOrderIds.map(k => map.get(k) ?? k);
  out.imageBoxes = (out.imageBoxes ?? []).map(b => {
    const host = (b as { behindSubjectOf?: string }).behindSubjectOf;
    return host && map.has(host) ? { ...b, behindSubjectOf: map.get(host) } : b;
  });
  return out;
}

export async function addSlideToDesign(
  client: SupabaseClient,
  kind: 'template' | 'post',
  opts: { parentId: string; fromSlideId?: string; name?: string },
): Promise<{ parentId: string; slideId: string; position: number; name: string; clonedFrom?: string }> {
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
  const { data: rows, error } = await client
    .from(tables.slides).select('*').eq(tables.slideFk, opts.parentId).order('position');
  if (error) throw new Error(`fetch slides failed: ${error.message}`);
  const existing = (rows ?? []) as Record<string, unknown>[];
  if (existing.length === 0) throw new Error(`${kind} ${opts.parentId} not found or has no slides`);

  const position = existing.length;
  const name = opts.name ?? (position === 0 ? 'main' : `supporting_${position}`);

  let row: Record<string, unknown>;
  if (opts.fromSlideId) {
    const src = existing.find(r => r.id === opts.fromSlideId);
    if (!src) throw new Error(`slide ${opts.fromSlideId} not found in ${kind} ${opts.parentId}`);
    // Through the domain so every column is re-serialized consistently (and the
    // fresh id comes from the DB default, not the source row).
    const cloned = rowToSlide(src);
    row = {
      ...slideToRow({ ...cloned, position, name, settings: remapClonedBoxIds(cloned.settings) }),
      [tables.slideFk]: opts.parentId,
    };
  } else {
    row = {
      [tables.slideFk]: opts.parentId, name, position,
      // Same as the editor's blank slide: drop the two circle layers.
      layer_order: ['background', 'subject'],
    };
  }
  const { data: ins, error: insErr } = await client
    .from(tables.slides).insert(row).select('id').single();
  if (insErr || !ins) throw new Error(`slide insert failed: ${insErr?.message ?? 'no row returned'}`);
  return {
    parentId: opts.parentId, slideId: (ins as { id: string }).id, position, name,
    ...(opts.fromSlideId ? { clonedFrom: opts.fromSlideId } : {}),
  };
}

// ── Designated caption (PER SLIDE) ───────────────────────────────────────────
// Captions live on the slide rows (SlideRow.caption): each slide carries its own,
// and a carousel publish uses the FIRST slide's. Hard cap 2199 chars — one under
// Instagram's 2200 — enforced here AND by the DB check constraints. null clears.
// The old post-level caption column survives as a read-only legacy fallback.
export const POST_CAPTION_MAX = 2199;

export async function setSlideCaption(
  client: SupabaseClient,
  kind: 'template' | 'post',
  opts: { parentId: string; slideId?: string; caption: string | null },   // slideId omitted → the position-0 slide
): Promise<{ parentId: string; slideId: string; position: number; length: number }> {
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
  const caption = opts.caption === '' ? null : opts.caption;
  if (caption !== null && caption.length > POST_CAPTION_MAX) {
    throw new Error(`caption is ${caption.length} chars — the limit is ${POST_CAPTION_MAX} (over by ${caption.length - POST_CAPTION_MAX})`);
  }
  let slideId = opts.slideId;
  let position: number;
  if (slideId) {
    const { data, error } = await client
      .from(tables.slides).select('id, position').eq('id', slideId).eq(tables.slideFk, opts.parentId).maybeSingle();
    if (error) throw new Error(`fetch slide failed: ${error.message}`);
    if (!data) throw new Error(`slide ${slideId} not found in ${kind} ${opts.parentId}`);
    position = (data as { position: number }).position;
  } else {
    const { data, error } = await client
      .from(tables.slides).select('id, position').eq(tables.slideFk, opts.parentId)
      .order('position').limit(1).maybeSingle();
    if (error) throw new Error(`fetch slides failed: ${error.message}`);
    if (!data) throw new Error(`${kind} ${opts.parentId} not found or has no slides`);
    slideId = (data as { id: string }).id;
    position = (data as { position: number }).position;
  }
  const { error: upErr } = await client.from(tables.slides).update({ caption }).eq('id', slideId);
  if (upErr) throw new Error(`update failed: ${upErr.message}`);
  return { parentId: opts.parentId, slideId, position, length: caption?.length ?? 0 };
}

// Move / resize an image box. Position-only changes leave everything else alone
// (a rotation quad is centre-relative, so it rides along); a resize recomputes a
// pure-rotation quad for the new dims and keeps fit-cover cropping honest.
export async function moveImageElement(
  client: SupabaseClient,
  kind: 'template' | 'post',
  opts: { parentId: string; boxId: string; x?: number; y?: number; width?: number; height?: number },
): Promise<{ slideId: string; boxId: string; x: number; y: number; width: number; height: number }> {
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
  const { data: rows, error } = await client
    .from(tables.slides).select('id, image_boxes').eq(tables.slideFk, opts.parentId);
  if (error) throw new Error(`fetch slides failed: ${error.message}`);

  for (const row of (rows ?? []) as { id: string; image_boxes: Record<string, unknown>[] | null }[]) {
    const boxes = row.image_boxes ?? [];
    const idx = boxes.findIndex(b => b.id === opts.boxId);
    if (idx < 0) continue;
    const b = boxes[idx] as Record<string, unknown>;
    const want: Record<string, number | undefined> = { x: opts.x, y: opts.y, width: opts.width, height: opts.height };
    if (kind === 'post' && Array.isArray(b.lockedProps)) {
      const geom = ['x', 'y', 'width', 'height'].filter(k => want[k] !== undefined && (b.lockedProps as string[]).includes(k));
      if (geom.length) throw new Error(`move: ${geom.join('/')} is template-locked on this element — unlock it on the template first`);
    }
    const x = opts.x ?? Number(b.x), y = opts.y ?? Number(b.y);
    const width = opts.width ?? Number(b.width), height = opts.height ?? Number(b.height);
    const resized = width !== Number(b.width) || height !== Number(b.height);
    const next = boxes.map((bx, i) => {
      if (i !== idx) return bx;
      const out: Record<string, unknown> = { ...bx, x, y, width, height };
      if (resized && bx.perspective) {
        const quad = perspectiveForRotation(width, height, rotationFromPerspective(Number(b.width), bx.perspective as never));
        if (quad) out.perspective = quad; else delete out.perspective;
      }
      return out;
    });
    const { error: upErr } = await client.from(tables.slides).update({ image_boxes: next }).eq('id', row.id);
    if (upErr) throw new Error(`update failed: ${upErr.message}`);
    return { slideId: row.id, boxId: opts.boxId, x, y, width, height };
  }
  throw new Error(`image box ${opts.boxId} not found in any slide of ${kind} ${opts.parentId}`);
}

// Swap the image an existing box shows, keeping the box's place in the composition
// (position, z-order, effects, stroke, rotation). The height follows the new image's
// natural aspect (width kept) unless keepSize; a stale crop is always dropped; a
// pure-rotation perspective quad is recomputed for the new dimensions. Split state:
// pass fgUrl (the new image's cutout) to keep it — without one, the old cutout is
// stale for the new image, so splitEnabled/fgUrl/bgHidden/fgStroke are cleared.
export async function setImageSource(
  client: SupabaseClient,
  kind: 'template' | 'post',
  opts: {
    parentId: string; boxId: string; url: string; fgUrl?: string;
    naturalWidth?: number; naturalHeight?: number; keepSize?: boolean;
  },
): Promise<{ slideId: string; boxId: string; url: string; fgUrl: string | null; width: number; height: number; clearedSplit: boolean }> {
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
  const { data: rows, error } = await client
    .from(tables.slides).select('id, image_boxes').eq(tables.slideFk, opts.parentId);
  if (error) throw new Error(`fetch slides failed: ${error.message}`);

  for (const row of (rows ?? []) as { id: string; image_boxes: Record<string, unknown>[] | null }[]) {
    const boxes = row.image_boxes ?? [];
    const idx = boxes.findIndex(b => b.id === opts.boxId);
    if (idx < 0) continue;
    const b = boxes[idx] as Record<string, unknown>;

    const oldW = Number(b.width), oldH = Number(b.height);
    const hasNatural = !!(opts.naturalWidth && opts.naturalHeight);
    const width = oldW;
    const height = (opts.keepSize || !hasNatural)
      ? oldH
      : Math.round(oldW * (opts.naturalHeight! / opts.naturalWidth!));
    const clearedSplit = !opts.fgUrl && !!b.splitEnabled;

    const next = boxes.map((bx, i) => {
      if (i !== idx) return bx;
      // crop is a source-rect into the OLD image — always stale after a swap.
      const { crop: _crop, perspective, splitEnabled, fgUrl, bgHidden, fgStroke, ...rest } = bx;
      const out: Record<string, unknown> = { ...rest, url: opts.url, width, height };
      if (hasNatural) out.aspect = opts.naturalWidth! / opts.naturalHeight!;
      // A rotation rides on the box dims — re-express it for the new height.
      if (perspective && (height !== oldH)) {
        const quad = perspectiveForRotation(width, height, rotationFromPerspective(oldW, perspective as never));
        if (quad) out.perspective = quad;
      } else if (perspective) out.perspective = perspective;
      if (opts.fgUrl) {
        out.splitEnabled = true; out.fgUrl = opts.fgUrl;
        if (bgHidden !== undefined) out.bgHidden = bgHidden;
        if (fgStroke !== undefined) out.fgStroke = fgStroke;
      } else if (!clearedSplit) {
        if (splitEnabled !== undefined) out.splitEnabled = splitEnabled;
        if (fgUrl !== undefined) out.fgUrl = fgUrl;
        if (bgHidden !== undefined) out.bgHidden = bgHidden;
        if (fgStroke !== undefined) out.fgStroke = fgStroke;
      }
      return out;
    });
    const { error: upErr } = await client.from(tables.slides).update({ image_boxes: next }).eq('id', row.id);
    if (upErr) throw new Error(`update failed: ${upErr.message}`);
    return { slideId: row.id, boxId: opts.boxId, url: opts.url, fgUrl: opts.fgUrl ?? null, width, height, clearedSplit };
  }
  throw new Error(`image box ${opts.boxId} not found in any slide of ${kind} ${opts.parentId}`);
}

// Remove an image element from a design's slide: the box and its z-order entry go;
// sentinels (__images__, __fade__) and every other layer stay untouched.
export async function removeImageElement(
  client: SupabaseClient,
  kind: 'template' | 'post',
  opts: { parentId: string; boxId: string },
): Promise<{ slideId: string; boxId: string }> {
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
  const { data: rows, error } = await client
    .from(tables.slides).select('id, image_boxes, layer_order_ids').eq(tables.slideFk, opts.parentId);
  if (error) throw new Error(`fetch slides failed: ${error.message}`);

  type Row = { id: string; image_boxes: Record<string, unknown>[] | null; layer_order_ids: string[] | null };
  for (const row of (rows ?? []) as Row[]) {
    const boxes = row.image_boxes ?? [];
    if (!boxes.some(b => b.id === opts.boxId)) continue;
    const { error: upErr } = await client.from(tables.slides).update({
      image_boxes: boxes.filter(b => b.id !== opts.boxId),
      ...(row.layer_order_ids ? { layer_order_ids: row.layer_order_ids.filter(id => id !== opts.boxId) } : {}),
    }).eq('id', row.id);
    if (upErr) throw new Error(`update failed: ${upErr.message}`);
    return { slideId: row.id, boxId: opts.boxId };
  }
  throw new Error(`image box ${opts.boxId} not found in any slide of ${kind} ${opts.parentId}`);
}

// Patch an image box's effects (blur / noise / brightness). On a non-split box these
// apply to the whole image; on a split box they style the SUBJECT layer (use the
// editor for separate bg-layer effects). null clears all effects.
export async function setImageEffects(
  client: SupabaseClient,
  kind: 'template' | 'post',
  opts: {
    parentId: string; boxId: string;
    effects: { blur?: number; noise?: number; brightness?: number } | null;
    // 'fg' (default) = the subject on a split box, or the whole image when not
    // split. 'bg' = the BACKGROUND layer — what house rule 6 blurs.
    layer?: 'fg' | 'bg';
  },
): Promise<{ slideId: string; boxId: string; effects: Record<string, number> | null }> {
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
  const { data: rows, error } = await client
    .from(tables.slides).select('id, image_boxes').eq(tables.slideFk, opts.parentId);
  if (error) throw new Error(`fetch slides failed: ${error.message}`);

  for (const row of (rows ?? []) as { id: string; image_boxes: Record<string, unknown>[] | null }[]) {
    const boxes = row.image_boxes ?? [];
    const idx = boxes.findIndex(b => b.id === opts.boxId);
    if (idx < 0) continue;
    const key = opts.layer === 'bg' ? 'bgEffects' : 'fgEffects';
    const next = boxes.map((bx, i) => {
      if (i !== idx) return bx;
      const rest = { ...bx };
      const prev = rest[key];
      delete rest[key];
      if (!opts.effects) return rest;
      return { ...rest, [key]: { ...(prev as Record<string, unknown> ?? {}), ...opts.effects } };
    });
    const { error: upErr } = await client.from(tables.slides).update({ image_boxes: next }).eq('id', row.id);
    if (upErr) throw new Error(`update failed: ${upErr.message}`);
    const out = next[idx][key] as Record<string, number> | undefined;
    return { slideId: row.id, boxId: opts.boxId, effects: out ?? null };
  }
  throw new Error(`image box ${opts.boxId} not found in any slide of ${kind} ${opts.parentId}`);
}

// ── Shared: locate an element id inside a jsonb-array column across slides ──
// Element ids survive slide duplication (real in production data: one texture box
// cloned onto three supporting slides keeps a single id), so "first match" can
// silently edit the wrong slide. Same contract as setElementText: demand slideId
// when the id is ambiguous. New verbs use this; the older image verbs predate it.
async function findElementSlide(
  client: SupabaseClient,
  tables: TableConfig,
  parentId: string,
  column: 'image_boxes' | 'chart_boxes',
  boxId: string,
  slideId?: string,
): Promise<{ slideRowId: string; boxes: Record<string, unknown>[]; idx: number }> {
  const { data: rows, error } = await client
    .from(tables.slides).select(`id, ${column}`).eq(tables.slideFk, parentId);
  if (error) throw new Error(`fetch slides failed: ${error.message}`);
  const all = (rows ?? []) as ({ id: string } & Record<string, unknown>)[];
  const matches = all.filter(r => ((r[column] as Record<string, unknown>[] | null) ?? []).some(b => b.id === boxId));
  if (matches.length === 0) throw new Error(`element ${boxId} not found in ${column} of any slide of ${parentId}`);
  const target = slideId
    ? matches.find(r => r.id === slideId)
    : matches.length === 1 ? matches[0] : undefined;
  if (!target) {
    throw new Error(slideId
      ? `element ${boxId} not found on slide ${slideId}`
      : `element ${boxId} exists on ${matches.length} slides (${matches.map(r => r.id).join(', ')}) — pass --slide <slideId> to disambiguate`);
  }
  const boxes = (target[column] as Record<string, unknown>[] | null) ?? [];
  return { slideRowId: target.id, boxes, idx: boxes.findIndex(b => b.id === boxId) };
}

// Posts honour template locks in the CLI too — same rule every existing verb applies.
function assertPropsUnlocked(kind: 'template' | 'post', box: Record<string, unknown>, props: string[], verb: string): void {
  if (kind !== 'post' || !Array.isArray(box.lockedProps)) return;
  const hit = props.filter(p => (box.lockedProps as string[]).includes(p));
  if (hit.length) throw new Error(`${verb}: ${hit.join('/')} is template-locked on this element — unlock it on the template first`);
}

// ── Chart elements ───────────────────────────────────────────────────────────
// A ChartBox snapshots its series + releases at write time (self-contained render);
// the CLI resolves the snapshot from the running app and passes it in here.

export interface ChartSnapshot {
  spotifyId: string;
  artistName: string;
  artistImage?: string;
  data: { index: number; timestamp: string }[];
  releases?: ChartRelease[];
}

// Whitelisted, type-checked ChartBox display fields settable via the CLI (add-chart
// --set / set-chart --set). Everything else on the box is identity, snapshot, or
// geometry — owned by the dedicated flags.
const CHART_ENUMS: Record<string, readonly string[]> = {
  layout: ['mobile', 'web'],
  period: ['1D', '1W', '1M', '3M', '6M', '1Y', 'ALL'],
  mode: ['line', 'candle'],
  endMode: ['custom', 'lowest', 'highest', 'none'],   // 'none' clears back to end-of-data
};
const CHART_BOOLS = new Set(['showHeader', 'showPlatformIcons', 'showGrid', 'showReleases', 'showReleaseNames', 'showReleaseDates', 'showXDates', 'showWatermark', 'animate', 'showLastDot', 'fillArea', 'hidden']);
const CHART_COLORS = new Set(['positiveColor', 'negativeColor', 'gridColor', 'labelColor', 'bgColor']);
const CHART_DATES = new Set(['endDate', 'sinceRelease', 'startDate']);
const CHART_NUMBERS: Record<string, readonly [number, number]> = { opacity: [0, 100] };

export function validateChartPatch(patch: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (k in CHART_ENUMS) {
      if (typeof v !== 'string' || !CHART_ENUMS[k].includes(v)) throw new Error(`chart ${k} must be one of ${CHART_ENUMS[k].join('|')} (got ${JSON.stringify(v)})`);
    } else if (CHART_BOOLS.has(k)) {
      if (typeof v !== 'boolean') throw new Error(`chart ${k} expects true|false (got ${JSON.stringify(v)})`);
    } else if (CHART_COLORS.has(k)) {
      if (typeof v !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(v)) throw new Error(`chart ${k} must be a hex colour (got ${JSON.stringify(v)})`);
    } else if (CHART_DATES.has(k)) {
      // 'none' clears the field — without it sinceRelease/endDate could never be
      // unset from the CLI (parsePairs cannot express null).
      if (v !== 'none' && (typeof v !== 'string' || Number.isNaN(new Date(v).getTime()))) throw new Error(`chart ${k} must be an ISO date or 'none' to clear (got ${JSON.stringify(v)})`);
    } else if (k in CHART_NUMBERS) {
      const [lo, hi] = CHART_NUMBERS[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`chart ${k} must be a number ${lo}..${hi} (got ${JSON.stringify(v)})`);
    } else if (k === 'name') {
      if (typeof v !== 'string') throw new Error('chart name must be a string');
    } else {
      throw new Error(`unknown/unsettable chart field: ${k} (settable: ${[...Object.keys(CHART_ENUMS), ...CHART_BOOLS, ...CHART_COLORS, ...CHART_DATES, ...Object.keys(CHART_NUMBERS), 'name'].join(', ')})`);
    }
  }
}

// Apply a validated chart patch onto a box, with the editor's semantics:
// - 'none' on sinceRelease/endDate/endMode DELETES the key (clears the window).
// - Setting `period` drops sinceRelease (unless the patch manages it itself) —
//   sinceRelease overrides period while set, so without this the editor-visible
//   behaviour of the period buttons ({ period, sinceRelease: undefined }) is
//   unreachable and --set period=… is a silent no-op on release-anchored charts.
const CLEARABLE_CHART_FIELDS = new Set(['sinceRelease', 'endDate', 'endMode']);
function applyChartPatch(out: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (CLEARABLE_CHART_FIELDS.has(k) && v === 'none') { delete out[k]; continue; }
    out[k] = v;
  }
  if ('period' in patch && !('sinceRelease' in patch)) delete out.sinceRelease;
}

// The ChartBox fields whose change alters the box's design aspect. The editor
// pairs every one of these with a height refit (the box is a fixed-aspect
// replica that never stretches); the CLI mirrors that unless the caller pinned
// the geometry explicitly.
const CHART_ASPECT_FIELDS = ['layout', 'showHeader', 'showXDates', 'showReleases', 'showReleaseNames'] as const;

// ── Chart geometry is HOUSE STYLE, not a per-call choice ─────────────────────
// Charts run full-bleed-minus-gutters and centred: 60px of canvas either side.
// Enforced here (not left to a guideline) so every caller — CLI, agent, future
// code — lands on it without having to know.
const CANVAS_W = 1080;
const CANVAS_H = 1350;
export const CHART_GUTTER = 60;
export const CHART_WIDTH = CANVAS_W - CHART_GUTTER * 2;   // 960

// Vertical room for a chart starting at `y`: down to the TOP of the nearest
// element below it, else the canvas floor. Elements that sit above the chart
// don't constrain it.
function chartRoomBelow(y: number, slide: Record<string, unknown>, margin = 24): number {
  const tops: number[] = [];
  for (const col of ['text_boxes', 'image_boxes'] as const) {
    for (const b of ((slide[col] as Record<string, unknown>[] | null) ?? [])) {
      const by = Number(b.y);
      // Skip the full-bleed background textures — they span the whole canvas and
      // would otherwise report zero room on every slide.
      const bh = Number(b.height);
      if (!Number.isFinite(by) || (by <= 0 && bh >= CANVAS_H - 1)) continue;
      if (by > y) tops.push(by);
    }
  }
  const floor = tops.length ? Math.min(...tops) : CANVAS_H;
  return Math.max(0, floor - y - margin);
}

// Pick the layout that FITS. The 'web' (desktop) design is ~22% shorter than
// 'mobile' at the same width (500-wide design vs 390), so when the mobile chart
// would collide with whatever sits below it, switch to desktop rather than
// letting it overlap — the collision this prevents happened twice by hand.
// Returns the height too, so the caller never computes the locked aspect itself.
function fitChartLayout(
  width: number, room: number, box: { showHeader?: unknown; showXDates?: unknown; showReleases?: unknown; showReleaseNames?: unknown; layout?: unknown },
): { layout: 'mobile' | 'web'; height: number; width: number; shrunk?: true } {
  const header = box.showHeader !== false;
  const names = box.showReleases !== false && box.showReleaseNames === true;
  const xdates = box.showXDates !== false;
  const h = (w: number, l: 'mobile' | 'web') => Math.round(w / chartAspect(header, names, xdates, l));

  // An explicit layout choice is respected; only the height auto-fits.
  if (box.layout === 'web' || box.layout === 'mobile') {
    const l = box.layout as 'mobile' | 'web';
    return { layout: l, height: h(width, l), width };
  }
  const mobile = h(width, 'mobile');
  if (!room || mobile <= room) return { layout: 'mobile', height: mobile, width };
  const web = h(width, 'web');
  if (web <= room) return { layout: 'web', height: web, width };
  // Neither fits. Narrow the desktop design until it does — but only down to a
  // width that's still readable. Below that, silently emitting a postage-stamp
  // chart is the wrong failure: say what's in the way and let the caller move it.
  const MIN_READABLE_W = 600;
  const shrunkW = Math.floor(width * (room / web));
  if (shrunkW < MIN_READABLE_W) {
    throw new Error(
      `no room for a chart here: ${room}px of clear space, which needs a chart narrower than ${MIN_READABLE_W}px to fit. ` +
      `Move it up with --y, or clear the element below it.`,
    );
  }
  return { layout: 'web', height: h(shrunkW, 'web'), width: shrunkW, shrunk: true };
}
function chartRefitHeight(box: Record<string, unknown>): number {
  const namesOn = box.showReleases !== false && box.showReleaseNames === true;
  return Math.round(Number(box.width) / chartAspect(
    box.showHeader !== false, namesOn, box.showXDates !== false,
    box.layout as 'mobile' | 'web' | undefined,
  ));
}

// Add a chart element to a slide (the CLI analog of the editor's ChartSearchCard
// "add"). Mirrors addImageElement's z-order handling, except charts have no
// sentinel zone — default insertion is on top, like a canvas drop.
/**
 * The index backend was OFF from 2026-06-13 to 2026-07-28, so no points exist for
 * those 45 days. The renderer joins the two surviving points with one straight
 * segment, which LOOKS like an artist whose sentiment sat perfectly still — and
 * that is what a writer then describes on the slide. It is not flat, it is absent.
 *
 * Scans the points a given period would actually display and reports any gap
 * bigger than `maxGapDays`, so the caller can refuse to narrate a hole.
 */
export const PERIOD_DAYS: Record<string, number> = {
  '1D': 1, '1W': 7, '1M': 30, '3M': 91, '6M': 182, '1Y': 365, ALL: Number.MAX_SAFE_INTEGER,
};

export function findChartDataGaps(
  data: { timestamp?: string; index?: number }[] | null | undefined,
  period: string,
  maxGapDays = 3,
): { from: string; to: string; days: number }[] {
  const pts = (data ?? [])
    .map(p => (p?.timestamp ? Date.parse(p.timestamp) : NaN))
    .filter(t => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (pts.length < 2) return [];
  const DAY = 86_400_000;
  const span = (PERIOD_DAYS[period] ?? PERIOD_DAYS.ALL) * DAY;
  // Same windowing the renderer uses: count back from the last point.
  const cutoff = pts[pts.length - 1] - span;
  const gaps: { from: string; to: string; days: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i] < cutoff) continue;                  // entirely before the window
    const days = Math.round((pts[i] - pts[i - 1]) / DAY);
    if (days > maxGapDays) {
      gaps.push({
        from: new Date(pts[i - 1]).toISOString().slice(0, 10),
        to: new Date(pts[i]).toISOString().slice(0, 10),
        days,
      });
    }
  }
  return gaps;
}

export async function addChartElement(
  client: SupabaseClient,
  kind: 'template' | 'post',
  opts: {
    parentId: string; slideId: string; snapshot: ChartSnapshot;
    // Geometry is house style: only y is a real choice. width/x are forced to the
    // 60px-gutter standard, and height comes from the fitted layout.
    y: number; width?: number; height?: number;
    z?: 'top' | 'bottom'; name?: string; patch?: Record<string, unknown>;
  },
): Promise<{ slideId: string; boxId: string; points: number; releases: number; x: number; y: number; width: number; height: number; layout: 'mobile' | 'web'; autoFitted: boolean }> {
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
  if (opts.patch) validateChartPatch(opts.patch);
  if (opts.snapshot.data.length < 2) throw new Error(`chart needs at least 2 data points (got ${opts.snapshot.data.length})`);

  const { data: row, error } = await client
    .from(tables.slides).select('id, chart_boxes, image_boxes, text_boxes, layer_order_ids, show_fade, show_top_fade')
    .eq('id', opts.slideId).eq(tables.slideFk, opts.parentId).single();
  if (error || !row) throw new Error(`slide ${opts.slideId} not found in ${kind} ${opts.parentId}: ${error?.message ?? 'no row'}`);

  const r0 = row as Record<string, unknown>;
  // Decide the display config FIRST — the aspect (and so the height) depends on
  // which chrome is on.
  const cfg: Record<string, unknown> = { showHeader: true, ...(opts.patch ?? {}) };
  const width = opts.width ?? CHART_WIDTH;
  const fit = opts.height !== undefined
    ? { layout: (cfg.layout as 'mobile' | 'web') ?? 'mobile', height: opts.height, width, shrunk: undefined }
    : fitChartLayout(width, chartRoomBelow(opts.y, r0), cfg);

  const box: Record<string, unknown> = {
    ...defaultChartBox({
      // Always centred: 60px gutters at the house width, and still centred if a
      // caller narrows it. x is never a caller decision.
      x: Math.round((CANVAS_W - fit.width) / 2),
      y: opts.y, width: fit.width, height: fit.height,
      spotifyId: opts.snapshot.spotifyId, artistName: opts.snapshot.artistName,
      artistImage: opts.snapshot.artistImage,
      data: opts.snapshot.data, releases: opts.snapshot.releases,
    }),
    // The editor's ChartSearchCard adds charts header-on; match it.
    showHeader: true,
    ...(opts.name ? { name: opts.name } : {}),
  };
  if (opts.patch) applyChartPatch(box, opts.patch);
  // Record the fitted layout so the box renders at the aspect we sized it for.
  if (cfg.layout === undefined && fit.layout === 'web') box.layout = 'web';

  const r = r0;
  const boxes = [...((r.chart_boxes as Record<string, unknown>[] | null) ?? []), box];
  let order = (r.layer_order_ids as string[] | null) ?? null;
  if (order) {
    order = opts.z === 'bottom' ? [box.id as string, ...order] : [...order, box.id as string];
  } else if (opts.z === 'bottom') {
    // No stored z-order: the implicit fallback renders unordered charts on TOP,
    // which would make --z bottom a silent no-op with the opposite effect.
    // Materialize the fallback order first, then prepend.
    const synth = orderedLayerIds(
      (r.image_boxes as { id: string }[] | null) ?? [],
      (r.text_boxes as { id: string }[] | null) ?? [],
      undefined,
      r.show_fade === true || r.show_top_fade === true,
      boxes.slice(0, -1) as { id: string }[],
    ).map(l => (l.kind === 'fade' ? FADE_LAYER_ID : l.id));
    order = [box.id as string, ...synth];
  }

  const { error: upErr } = await client
    .from(tables.slides)
    .update({ chart_boxes: boxes, ...(order ? { layer_order_ids: order } : {}) })
    .eq('id', opts.slideId);
  if (upErr) throw new Error(`update failed: ${upErr.message}`);
  return {
    slideId: opts.slideId, boxId: box.id as string,
    points: opts.snapshot.data.length, releases: opts.snapshot.releases?.length ?? 0,
    x: box.x as number, y: box.y as number, width: box.width as number, height: box.height as number,
    layout: fit.layout, autoFitted: opts.height === undefined,
  };
}

// Reconfigure an existing chart box: display fields (--set), geometry, and/or a
// fresh artist snapshot (re-pointing the chart at another artist or refreshing
// its data). Fields not passed are left untouched.
export async function setChartConfig(
  client: SupabaseClient,
  kind: 'template' | 'post',
  opts: {
    parentId: string; boxId: string; slideId?: string;
    patch?: Record<string, unknown>;
    x?: number; y?: number; width?: number; height?: number;
    snapshot?: ChartSnapshot;
    // Re-apply house geometry to an existing chart: house width, centred, and
    // the layout re-fitted to the room actually available on its slide.
    standard?: boolean;
  },
): Promise<{ slideId: string; boxId: string; applied: string[]; points?: number; layout?: 'mobile' | 'web' }> {
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
  if (opts.patch) validateChartPatch(opts.patch);
  if (opts.snapshot && opts.snapshot.data.length < 2) throw new Error(`chart needs at least 2 data points (got ${opts.snapshot.data.length})`);

  for (const k of ['x', 'y', 'width', 'height'] as const) {
    const v = opts[k];
    if (v !== undefined && (!Number.isFinite(v) || ((k === 'width' || k === 'height') && v <= 0))) {
      throw new Error(`chart ${k} must be a finite number${k === 'width' || k === 'height' ? ' > 0' : ''} (got ${JSON.stringify(v)})`);
    }
  }
  const { slideRowId, boxes, idx } = await findElementSlide(client, tables, opts.parentId, 'chart_boxes', opts.boxId, opts.slideId);
  const applied: string[] = [];

  // --standard: measure this slide's real estate and re-fit, exactly as
  // add-chart does for a new chart.
  let std: { layout: 'mobile' | 'web'; height: number; width: number } | null = null;
  if (opts.standard) {
    const { data: slideRow, error: sErr } = await client
      .from(tables.slides).select('text_boxes, image_boxes').eq('id', slideRowId).single();
    if (sErr || !slideRow) throw new Error(`fetch slide failed: ${sErr?.message ?? 'no row'}`);
    const cur = boxes[idx] as Record<string, unknown>;
    const y = opts.y ?? Number(cur.y);
    // Re-fit from scratch: ignore any layout previously pinned on the box, since
    // the whole point is to let the fitter choose again.
    const cfg = { ...cur, ...(opts.patch ?? {}), layout: undefined };
    std = fitChartLayout(opts.width ?? CHART_WIDTH, chartRoomBelow(y, slideRow as Record<string, unknown>), cfg);
  }
  const next = boxes.map((bx, i) => {
    if (i !== idx) return bx;
    const out: Record<string, unknown> = { ...bx };
    for (const k of ['x', 'y', 'width', 'height'] as const) {
      const v = opts[k];
      if (v !== undefined) { out[k] = v; applied.push(k); }
    }
    // Width is house style too: any width change re-centres the box, so a chart
    // can never end up off-centre.
    if (opts.width !== undefined && opts.x === undefined) {
      out.x = Math.round((CANVAS_W - opts.width) / 2);
      applied.push('x(centred)');
    }
    if (opts.patch) { applyChartPatch(out, opts.patch); applied.push(...Object.keys(opts.patch)); }
    if (std) {
      out.width = std.width;
      out.height = std.height;
      out.x = Math.round((CANVAS_W - std.width) / 2);
      out.layout = std.layout === 'web' ? 'web' : undefined;
      if (out.layout === undefined) delete out.layout;
      applied.push('standard(x,width,height,layout)');
    }
    if (opts.snapshot) {
      out.spotifyId = opts.snapshot.spotifyId;
      out.artistName = opts.snapshot.artistName;
      // Always overwrite — keeping the OLD artist's avatar when the new one has
      // none would render artist B's chart under artist A's face.
      if (opts.snapshot.artistImage !== undefined) out.artistImage = opts.snapshot.artistImage;
      else delete out.artistImage;
      out.data = opts.snapshot.data;
      out.releases = opts.snapshot.releases;
      applied.push('snapshot');
    }
    // The box is a fixed-aspect replica: refit the height whenever the aspect
    // could have changed — an aspect-affecting --set field OR a width change —
    // unless the caller pinned --height. Without the width case, `set-chart
    // --width 800` stretched the chart, a state the editor can never produce.
    // (--standard already set both, so skip it there.)
    const aspectPatched = !!opts.patch && CHART_ASPECT_FIELDS.some(f => f in opts.patch!);
    if (!std && (aspectPatched || opts.width !== undefined) && opts.height === undefined) {
      out.height = chartRefitHeight(out);
      applied.push('height(refit)');
    }
    return out;
  });
  const { error: upErr } = await client.from(tables.slides).update({ chart_boxes: next }).eq('id', slideRowId);
  if (upErr) throw new Error(`update failed: ${upErr.message}`);
  return {
    slideId: slideRowId, boxId: opts.boxId, applied,
    ...(opts.snapshot ? { points: opts.snapshot.data.length } : {}),
    ...(std ? { layout: std.layout } : {}),
  };
}

// Remove a chart element: the box and its z-order entry go; sentinels and every
// other layer stay untouched. Mirrors removeImageElement.
export async function removeChartElement(
  client: SupabaseClient,
  kind: 'template' | 'post',
  opts: { parentId: string; boxId: string; slideId?: string },
): Promise<{ slideId: string; boxId: string }> {
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
  const { slideRowId, boxes, idx } = await findElementSlide(client, tables, opts.parentId, 'chart_boxes', opts.boxId, opts.slideId);
  const { data: row } = await client
    .from(tables.slides).select('layer_order_ids').eq('id', slideRowId).single();
  const order = (row as { layer_order_ids: string[] | null } | null)?.layer_order_ids ?? null;
  const { error: upErr } = await client.from(tables.slides).update({
    chart_boxes: boxes.filter((_, i) => i !== idx),
    ...(order ? { layer_order_ids: order.filter(id => id !== opts.boxId) } : {}),
  }).eq('id', slideRowId);
  if (upErr) throw new Error(`update failed: ${upErr.message}`);
  return { slideId: slideRowId, boxId: opts.boxId };
}

// ── Generative expand (in place) ─────────────────────────────────────────────
// Outpaints the box's image to fill the whole canvas and REPLACES it — exactly
// what the editor's expand button does (same BRIA contract, same in-place swap
// to 0,0,1080,1350). One box, not two: the expanded image IS the image.
//
// House rule 6 then finishes the job in the editor — detect background on that
// box and blur the background layer, leaving the subject sharp. That detection
// is browser-only (transformers.js/WebGPU), so it cannot run from here; the
// blur itself is reachable via setImageEffects({ layer: 'bg' }).
//
// Needs the running app (the route proxies BRIA server-side) + BRIA_API_TOKEN.
export async function expandImageBox(
  client: SupabaseClient,
  kind: 'template' | 'post',
  opts: {
    parentId: string; boxId: string; slideId?: string;
    appUrl: string;
    uploadBuffer: (buf: Buffer, name: string, contentType: string) => Promise<string>;
  },
): Promise<{ slideId: string; boxId: string; url: string; from: { x: number; y: number; width: number; height: number } }> {
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
  const { slideRowId, boxes, idx } = await findElementSlide(client, tables, opts.parentId, 'image_boxes', opts.boxId, opts.slideId);
  const src = boxes[idx] as Record<string, unknown>;
  const url = String(src.url ?? '');
  if (!url) throw new Error(`box ${opts.boxId} has no image to expand`);

  // Tell BRIA where the original sits on the canvas so it outpaints the gap
  // around it — same contract the editor's expand button uses.
  const res = await fetch(`${opts.appUrl}/api/ai/expand-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageUrl: url,
      canvasSize: [CANVAS_W, CANVAS_H],
      originalImageSize: [Number(src.width), Number(src.height)],
      originalImageLocation: [Number(src.x), Number(src.y)],
    }),
  }).catch((e: unknown) => {
    throw new Error(`could not reach ${opts.appUrl} for the expand (${(e as Error).message}) — is the dev server running?`);
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(j.error || `expand failed (${res.status})`);
  }
  const expanded = Buffer.from(await res.arrayBuffer());
  const publicUrl = await opts.uploadBuffer(expanded, `expand-${opts.boxId}.png`, 'image/png');

  const from = { x: Number(src.x), y: Number(src.y), width: Number(src.width), height: Number(src.height) };
  const next = boxes.map((b, i) => {
    if (i !== idx) return b;
    // Same in-place replacement the editor performs: fills the canvas, and the
    // old crop / cut-out are stale against the new pixels so they're dropped.
    const { crop: _c, fgUrl: _f, splitEnabled: _s, ...rest } = b as Record<string, unknown>;
    return {
      ...rest, url: publicUrl,
      x: 0, y: 0, width: CANVAS_W, height: CANVAS_H,
      aspect: CANVAS_W / CANVAS_H,
    };
  });
  const { error: upErr } = await client.from(tables.slides).update({ image_boxes: next }).eq('id', slideRowId);
  if (upErr) throw new Error(`update failed: ${upErr.message}`);
  return { slideId: slideRowId, boxId: opts.boxId, url: publicUrl, from };
}

// House-style grain for a split. Subtle on purpose: enough to break up the
// banding a heavy blur creates and to match the two layers' texture, not enough
// to read as an effect.
const BG_NOISE = 12;
const FG_NOISE = 6;

// Split an image box into subject + background: runs a cut-out of the box's
// image and persists it as fgUrl, which is what flips the renderer onto its
// split draw path. `cutout` is INJECTED rather than imported so this module
// stays free of the Node-only model runtime (persist.ts is shared code).
export async function splitImageBox(
  client: SupabaseClient,
  kind: 'template' | 'post',
  opts: {
    parentId: string; boxId: string; slideId?: string;
    cutout: (srcUrl: string) => Promise<{ png: Buffer; bbox: { x: number; y: number; w: number; h: number; sw: number; sh: number } }>;
    uploadBuffer: (buf: Buffer, name: string, contentType: string) => Promise<string>;
    // House style for the split look — applied together, not à la carte:
    //   background: blur with FADED EDGES + a little grain
    //   foreground: the same little grain
    blur?: number;        // background blur; omit to leave bgEffects alone
    bgNoise?: number;     // default BG_NOISE
    fgNoise?: number;     // default FG_NOISE
    edgeFade?: boolean;   // default true — soft-edged blur reads better than a hard box
    // Drop the background ENTIRELY instead of blurring it, so only the cut-out
    // subject renders and whatever is beneath shows through. This is what a
    // secondary OBJECT needs: pasted on its own rectangle it reads as a sticker.
    dropBg?: boolean;
    // Shrink the BOX onto the cut-out subject. Without it the box still spans
    // the whole source frame, so its bounds (and the editor's selection handles)
    // wrap a margin of transparent padding around the object.
    trim?: boolean;
  },
): Promise<{ slideId: string; boxId: string; fgUrl: string; bgEffects?: Record<string, unknown>; fgEffects?: Record<string, unknown> }> {
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
  const { slideRowId, boxes, idx } = await findElementSlide(client, tables, opts.parentId, 'image_boxes', opts.boxId, opts.slideId);
  const src = boxes[idx] as Record<string, unknown>;
  const url = String(src.url ?? '');
  if (!url) throw new Error(`box ${opts.boxId} has no image to split`);

  const { png, bbox } = await opts.cutout(url);
  // Same filename shape the editor writes, so the two are indistinguishable.
  const fgUrl = await opts.uploadBuffer(png, `cutout-${opts.boxId}.png`, 'image/png');

  // Re-frame the box onto the subject, keeping it pixel-identical on canvas.
  // The visible source rect maps linearly onto the box, so convert the subject's
  // source-space bbox into canvas space, then make THAT the box and set the crop
  // to the bbox — same pixels, tight bounds.
  let reframe: Record<string, unknown> | null = null;
  if (opts.trim && bbox.w > 0 && bbox.h > 0) {
    const cur = src as Record<string, unknown>;
    const c = (cur.crop ?? {}) as { top?: number; bottom?: number; left?: number; right?: number };
    const cl = c.left ?? 0, cr = c.right ?? 0, ct = c.top ?? 0, cb = c.bottom ?? 0;
    // The visible source window (what an existing crop already left showing).
    const sx0 = cl * bbox.sw, sy0 = ct * bbox.sh;
    const sx1 = (1 - cr) * bbox.sw, sy1 = (1 - cb) * bbox.sh;
    const vw = sx1 - sx0, vh = sy1 - sy0;
    // INTERSECT the subject with that window — never replace it. The cut-out is
    // computed on the FULL source, so its bbox can reach outside an existing
    // crop; overwriting the crop with it silently undoes a deliberate trim
    // (which is exactly how a cropped-off UI chip came back).
    const ix0 = Math.max(bbox.x, sx0), iy0 = Math.max(bbox.y, sy0);
    const ix1 = Math.min(bbox.x + bbox.w, sx1), iy1 = Math.min(bbox.y + bbox.h, sy1);
    if (vw > 0 && vh > 0 && ix1 > ix0 && iy1 > iy0) {
      const kx = Number(cur.width) / vw, ky = Number(cur.height) / vh;
      reframe = {
        x: Math.round(Number(cur.x) + (ix0 - sx0) * kx),
        y: Math.round(Number(cur.y) + (iy0 - sy0) * ky),
        width: Math.round((ix1 - ix0) * kx),
        height: Math.round((iy1 - iy0) * ky),
        crop: {
          left: ix0 / bbox.sw,
          right: 1 - ix1 / bbox.sw,
          top: iy0 / bbox.sh,
          bottom: 1 - iy1 / bbox.sh,
        },
      };
    }
  }

  let bgOut: Record<string, unknown> | undefined;
  let fgOut: Record<string, unknown> | undefined;
  const next = boxes.map((b, i) => {
    if (i !== idx) return b;
    // Spread — do NOT drop crop like expandImageBox does. That drop is right for
    // an expand (new pixels invalidate the old crop and matte) and wrong here:
    // the matte is derived from these same pixels, so the crop must survive.
    const prev = b as Record<string, unknown>;
    const out: Record<string, unknown> = { ...prev, splitEnabled: true, fgUrl };
    if (opts.dropBg) out.bgHidden = true;
    if (reframe) Object.assign(out, reframe);
    if (opts.blur != null) {
      bgOut = {
        ...(prev.bgEffects as Record<string, unknown> ?? {}),
        blur: opts.blur,
        // Faded blur edges: the blurred layer dissolves at the box edge instead
        // of stopping on a hard line, which is what makes it read as depth
        // rather than as a pasted rectangle.
        blurEdgeFade: opts.edgeFade ?? true,
        noise: opts.bgNoise ?? BG_NOISE,
      };
      out.bgEffects = bgOut;
    }
    // Grain on the SUBJECT too: a clean cut-out over a grainy blur looks pasted
    // on. Matching grain on both layers is what welds them into one photo.
    fgOut = { ...(prev.fgEffects as Record<string, unknown> ?? {}), noise: opts.fgNoise ?? FG_NOISE };
    out.fgEffects = fgOut;
    return out;
  });
  const { error: upErr } = await client.from(tables.slides).update({ image_boxes: next }).eq('id', slideRowId);
  if (upErr) throw new Error(`update failed: ${upErr.message}`);
  return { slideId: slideRowId, boxId: opts.boxId, fgUrl, bgEffects: bgOut, fgEffects: fgOut, ...(reframe ? { trimmedTo: { x: reframe.x, y: reframe.y, width: reframe.width, height: reframe.height } } : {}) };
}

// ── Image style: fade / shadow / opacity / corner radius / blend ─────────────
// The per-box presentation knobs the editor's settings panel owns and the CLI
// previously couldn't reach. Each field: undefined = untouched, null = cleared.
const BLEND_MODES = new Set([
  'source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
  'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'lighter',
]);

export async function setImageStyle(
  client: SupabaseClient,
  kind: 'template' | 'post',
  opts: {
    parentId: string; boxId: string; slideId?: string;
    opacity?: number;             // 0-100
    cornerRadius?: number;        // >= 0 canvas px
    blend?: string | null;        // canvas blend mode; null/'source-over' clears
    fade?: ImageBoxFade | null;   // per-edge fade; null clears
    shadow?: ShadowStyle | null;  // drop shadow; null clears
    // Tuck this box BETWEEN a split box's background and its subject, so it
    // passes behind the subject where they overlap. Pass the host box's id;
    // null detaches. The host must be split (splitEnabled + fgUrl) or there is
    // no gap to draw into.
    behindSubjectOf?: string | null;
  },
): Promise<{ slideId: string; boxId: string; applied: string[] }> {
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
  if (opts.opacity !== undefined && (!Number.isFinite(opts.opacity) || opts.opacity < 0 || opts.opacity > 100)) throw new Error('opacity must be 0-100');
  if (opts.cornerRadius !== undefined && (!Number.isFinite(opts.cornerRadius) || opts.cornerRadius < 0 || opts.cornerRadius > 675)) throw new Error('cornerRadius must be 0-675 canvas px');
  if (typeof opts.blend === 'string' && !BLEND_MODES.has(opts.blend)) throw new Error(`blend must be one of: ${[...BLEND_MODES].join(', ')} (or 'none' to clear)`);

  const { slideRowId, boxes, idx } = await findElementSlide(client, tables, opts.parentId, 'image_boxes', opts.boxId, opts.slideId);
  const touched: string[] = [];
  if (opts.opacity !== undefined) touched.push('opacity');
  if (opts.cornerRadius !== undefined) touched.push('cornerRadius');
  if (opts.blend !== undefined) touched.push('blend');
  if (opts.fade !== undefined) touched.push('fade');
  if (opts.shadow !== undefined) touched.push('shadow');
  if (opts.behindSubjectOf !== undefined) touched.push('behindSubjectOf');
  if (!touched.length) throw new Error('set-image-style: nothing to change — pass at least one of --opacity/--corner-radius/--blend/--fade/--shadow');
  assertPropsUnlocked(kind, boxes[idx], touched, 'set-image-style');

  const next = boxes.map((bx, i) => {
    if (i !== idx) return bx;
    const out: Record<string, unknown> = { ...bx };
    if (opts.opacity !== undefined) out.opacity = opts.opacity;
    if (opts.cornerRadius !== undefined) out.cornerRadius = opts.cornerRadius;
    if (opts.blend !== undefined) {
      // 'source-over' is the default composite — storing it is the same as clearing.
      if (opts.blend === null || opts.blend === 'source-over') delete out.blend; else out.blend = opts.blend;
    }
    if (opts.fade !== undefined) { if (opts.fade === null) delete out.fade; else out.fade = opts.fade; }
    if (opts.shadow !== undefined) { if (opts.shadow === null) delete out.shadow; else out.shadow = opts.shadow; }
    if (opts.behindSubjectOf !== undefined) {
      if (opts.behindSubjectOf === null) delete out.behindSubjectOf; else out.behindSubjectOf = opts.behindSubjectOf;
    }
    return out;
  });
  const { error: upErr } = await client.from(tables.slides).update({ image_boxes: next }).eq('id', slideRowId);
  if (upErr) throw new Error(`update failed: ${upErr.message}`);
  return { slideId: slideRowId, boxId: opts.boxId, applied: touched };
}

// ── Image crop ───────────────────────────────────────────────────────────────
// Per-edge source-rect crop: each value is the FRACTION (0-1) of the source image
// hidden on that edge — the same numbers dragging a centre-edge handle writes.
export async function setImageCrop(
  client: SupabaseClient,
  kind: 'template' | 'post',
  opts: { parentId: string; boxId: string; slideId?: string; crop: ImageBoxCrop | null },
): Promise<{ slideId: string; boxId: string; crop: ImageBoxCrop | null }> {
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
  if (opts.crop) {
    for (const [edge, v] of Object.entries(opts.crop)) {
      if (!Number.isFinite(v) || v < 0 || v > 0.95) throw new Error(`crop ${edge} must be 0-0.95 (fraction of the source hidden; got ${v})`);
    }
    if (opts.crop.top + opts.crop.bottom > 0.95) throw new Error('crop top+bottom must leave at least 5% of the image');
    if (opts.crop.left + opts.crop.right > 0.95) throw new Error('crop left+right must leave at least 5% of the image');
  }
  const { slideRowId, boxes, idx } = await findElementSlide(client, tables, opts.parentId, 'image_boxes', opts.boxId, opts.slideId);
  assertPropsUnlocked(kind, boxes[idx], ['crop'], 'set-crop');
  const next = boxes.map((bx, i) => {
    if (i !== idx) return bx;
    const { crop: _drop, ...rest } = bx;
    return opts.crop ? { ...rest, crop: opts.crop } : rest;
  });
  const { error: upErr } = await client.from(tables.slides).update({ image_boxes: next }).eq('id', slideRowId);
  if (upErr) throw new Error(`update failed: ${upErr.message}`);
  return { slideId: slideRowId, boxId: opts.boxId, crop: opts.crop };
}

// ── Freeform perspective (distort) ───────────────────────────────────────────
// Arbitrary per-corner offsets — the full Distort/Perspective/Skew surface, of
// which `rotate` is the pure-rotation special case. REPLACES any existing quad.
export async function setImagePerspective(
  client: SupabaseClient,
  kind: 'template' | 'post',
  opts: { parentId: string; boxId: string; slideId?: string; quad: ImageBoxPerspective | null },
): Promise<{ slideId: string; boxId: string; quad: ImageBoxPerspective | null }> {
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
  if (opts.quad) {
    for (const corner of ['tl', 'tr', 'br', 'bl'] as const) {
      const c = opts.quad[corner];
      if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || Math.abs(c.x) > 4000 || Math.abs(c.y) > 4000) {
        throw new Error(`distort ${corner} offsets must be finite canvas px within ±4000 (got ${JSON.stringify(c)})`);
      }
    }
  }
  const { slideRowId, boxes, idx } = await findElementSlide(client, tables, opts.parentId, 'image_boxes', opts.boxId, opts.slideId);
  assertPropsUnlocked(kind, boxes[idx], ['perspective'], 'distort');
  const next = boxes.map((bx, i) => {
    if (i !== idx) return bx;
    const { perspective: _drop, ...rest } = bx;
    return opts.quad ? { ...rest, perspective: opts.quad } : rest;
  });
  const { error: upErr } = await client.from(tables.slides).update({ image_boxes: next }).eq('id', slideRowId);
  if (upErr) throw new Error(`update failed: ${upErr.message}`);
  return { slideId: slideRowId, boxId: opts.boxId, quad: opts.quad };
}

// ── Style locks ──────────────────────────────────────────────────────────────
// Properties a template may lock per element kind (a POST then can't change them;
// text stays editable on text boxes, and a placeholder stays fillable — `url` is
// deliberately NOT lockable).
export const LOCKABLE_TEXT_PROPS = new Set([
  'x', 'y', 'width', 'height', 'vAlign', 'align', 'fontLabel', 'fontSize',
  'fontWeight', 'secondaryWeight', 'fitToWidth', 'allCaps', 'singleLine',
  'lineHeight', 'letterSpacing', 'color', 'opacity', 'italic', 'shadow',
]);
export const LOCKABLE_IMAGE_PROPS = new Set([
  'x', 'y', 'width', 'height', 'opacity', 'cornerRadius', 'blend',
  'crop', 'perspective', 'fade', 'shadow', 'fgStroke',
]);

// Slide-level settings a template may lock (the slide-wide knobs; element styling
// is covered by per-box lockedProps).
export const LOCKABLE_SLIDE_SETTINGS = new Set([
  'canvasColor', 'canvasTransparent',
  'showFade', 'fadeIntensity', 'fadeFloor', 'fadeReach',
  'fadeRemoved',       // deleting the fade LAYER — a stronger 'off' than showFade
  'showTopFade', 'topFadeIntensity', 'topFadeFloor', 'topFadeReach',
  'layerOrderIds',     // z-order: posts follow the template's layer layout (no reordering)
  'fadeFloorAnchor',   // the floor-follows-headline binding
  // A caption written on the TEMPLATE slide is boilerplate every post should carry
  // verbatim, so creating a post from that template locks it. A template slide left
  // blank stays fully editable per post. See createPostFromTemplate.
  'caption',
]);

// Set (or clear) the slide-level lock list on one slide (locked_settings column).
export async function setSlideSettingLocks(
  client: SupabaseClient,
  kind: 'template' | 'post',
  opts: { parentId: string; slideId: string; settings: string[] },   // [] clears
): Promise<{ slideId: string; lockedSettings: string[] }> {
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;
  const bad = opts.settings.filter(s => !LOCKABLE_SLIDE_SETTINGS.has(s));
  if (bad.length) {
    throw new Error(`not lockable slide settings: ${bad.join(', ')} (lockable: ${[...LOCKABLE_SLIDE_SETTINGS].join(', ')})`);
  }
  const { data, error } = await client
    .from(tables.slides)
    .update({ locked_settings: opts.settings.length ? opts.settings : null })
    .eq('id', opts.slideId).eq(tables.slideFk, opts.parentId)
    .select('id').maybeSingle();
  if (error) throw new Error(`update failed: ${error.message}`);
  if (!data) throw new Error(`slide ${opts.slideId} not found in ${kind} ${opts.parentId}`);
  return { slideId: opts.slideId, lockedSettings: opts.settings };
}

// Set (or clear) the template-defined lock list on one element (text OR image box):
// finds the slide + array containing the element id, validates the props against
// that element kind, and rewrites the JSONB column.
export async function setElementLocks(
  client: SupabaseClient,
  kind: 'template' | 'post',
  opts: { parentId: string; boxId: string; props: string[] },   // [] clears all locks
): Promise<{ slideId: string; boxId: string; element: 'text' | 'image'; lockedProps: string[] }> {
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;

  const { data: rows, error } = await client
    .from(tables.slides).select('id, text_boxes, image_boxes').eq(tables.slideFk, opts.parentId);
  if (error) throw new Error(`fetch slides failed: ${error.message}`);

  type Row = { id: string; text_boxes: Record<string, unknown>[] | null; image_boxes: Record<string, unknown>[] | null };
  for (const row of (rows ?? []) as Row[]) {
    for (const [column, whitelist, element] of [
      ['text_boxes', LOCKABLE_TEXT_PROPS, 'text'],
      ['image_boxes', LOCKABLE_IMAGE_PROPS, 'image'],
    ] as const) {
      const boxes = row[column] ?? [];
      const idx = boxes.findIndex(b => b.id === opts.boxId);
      if (idx < 0) continue;

      const bad = opts.props.filter(p => !whitelist.has(p));
      if (bad.length) {
        throw new Error(`not lockable on ${element} boxes: ${bad.join(', ')} (lockable: ${[...whitelist].join(', ')})`);
      }
      const next = boxes.map((b, i) => {
        if (i !== idx) return b;
        const { lockedProps: _drop, ...rest } = b;
        return opts.props.length ? { ...rest, lockedProps: opts.props } : rest;
      });
      const { error: upErr } = await client
        .from(tables.slides).update({ [column]: next }).eq('id', row.id);
      if (upErr) throw new Error(`update failed: ${upErr.message}`);
      return { slideId: row.id, boxId: opts.boxId, element, lockedProps: opts.props };
    }
  }
  throw new Error(`element ${opts.boxId} not found in any slide of ${kind} ${opts.parentId}`);
}

// Duplicate an existing template/post: read its slides, deep-clone them into a brand-new
// parent named "<source> copy" (fresh ids, preserved order). Mirrors the editor's
// duplicateTemplate. `kind` picks the table set the source lives in AND the copy goes to.
export async function duplicateDesign(
  client: SupabaseClient,
  kind: 'template' | 'post',
  opts: { sourceId: string; userId: string; name?: string; position?: number },
): Promise<CreateResult> {
  const tables = kind === 'post' ? POST_TABLES : TEMPLATE_TABLES;

  const { data: srcRows, error: srcErr } = await client
    .from(tables.slides).select('*').eq(tables.slideFk, opts.sourceId).order('position');
  if (srcErr) throw new Error(`fetch source slides failed: ${srcErr.message}`);
  const srcSlides = ((srcRows ?? []) as Record<string, unknown>[]).map(rowToSlide);
  if (srcSlides.length === 0) throw new Error(`source ${kind} ${opts.sourceId} not found or has no slides`);

  const { data: srcParent } = await client.from(tables.parent).select('name').eq('id', opts.sourceId).single();
  const name = opts.name ?? `${(srcParent as { name?: string } | null)?.name ?? 'Untitled'} copy`;
  const position = opts.position ?? await nextPosition(client, tables.parent, opts.userId);

  return createDesign(client, tables, { user_id: opts.userId, name, position }, srcSlides);
}

// Fill an image placeholder in a saved template/post: set the url on the Nth placeholder box
// of the given slide (leaving `placeholder: true` so it stays a re-fillable slot). The caller
// resolves `imageUrl` to a public URL first (see assets.resolveImageRef).
export async function fillPlaceholder(
  client: SupabaseClient,
  kind: 'template' | 'post',
  opts: { parentId: string; imageUrl: string; slideIndex?: number; slotIndex?: number },
): Promise<{ slideId: string; boxId: string; url: string }> {
  // Placeholders are template-only design visuals — posts never contain (or fill) them.
  // The CLI honours the same surface the posts UI exposes: fill a photo into a post at
  // creation instead (`create --from-template --image`).
  if (kind === 'post') {
    throw new Error('fill: placeholders are template-only — posts have none. Use `create --from-template --image <file|url>` to fill the slot at post creation.');
  }
  const tables = TEMPLATE_TABLES;   // the guard above leaves only 'template'
  const { data, error } = await client
    .from(tables.slides).select('*').eq(tables.slideFk, opts.parentId).order('position');
  if (error) throw new Error(`fetch slides failed: ${error.message}`);
  const rows = (data ?? []) as Record<string, unknown>[];
  const slideIdx = opts.slideIndex ?? 0;
  const row = rows[slideIdx];
  if (!row) throw new Error(`slide index ${slideIdx} not found (design has ${rows.length} slide(s))`);

  const slide = rowToSlide(row);
  const boxes = slide.settings.imageBoxes ?? [];
  const placeholders = boxes.filter(b => b.placeholder);
  const slot = opts.slotIndex ?? 0;
  const target = placeholders[slot];
  if (!target) throw new Error(`placeholder slot ${slot} not found (slide ${slideIdx} has ${placeholders.length} placeholder(s))`);

  const newBoxes = boxes.map(b => (b.id === target.id ? { ...b, url: opts.imageUrl } : b));
  const { error: upErr } = await client
    .from(tables.slides).update({ image_boxes: newBoxes }).eq('id', slide.id);
  if (upErr) throw new Error(`update failed: ${upErr.message}`);
  return { slideId: slide.id, boxId: target.id, url: opts.imageUrl };
}

export async function createPost(
  client: SupabaseClient,
  opts: {
    userId: string; name: string; slides: SlideRow[];
    status?: string; sourceTemplateId?: string | null; position?: number;
  },
): Promise<CreateResult> {
  const position = opts.position ?? await nextPosition(client, POST_TABLES.parent, opts.userId);
  return createDesign(
    client, POST_TABLES,
    {
      user_id: opts.userId, name: opts.name,
      status: opts.status ?? 'draft',
      source_template_id: opts.sourceTemplateId ?? null,
      position,
    },
    opts.slides,
  );
}
