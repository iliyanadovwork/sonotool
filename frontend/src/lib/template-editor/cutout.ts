// ─────────────────────────────────────────────────────────────────────────────
// Headless subject cut-out (Node).
//
// The Node twin of TemplateEditorCanvas/imageRemoval.ts: same model
// (BiRefNet-lite @512), same weights, same preprocessing — so a cut-out made by
// the CLI is the matte the EDITOR would have produced. That parity is the whole
// point: the same post gets edited by a human and by an agent, and a subject
// whose edges shift depending on which tool touched it last is a real defect.
//
// Differences from the browser version are only about the runtime, never the
// model: onnxruntime-node instead of WASM, and sharp instead of a DOM canvas for
// the final RGBA composite.
//
// IMPORTANT: Node-only. MUST NOT be imported by any app/browser code — only by
// the CLI (scripts/canvas.ts). Uses RELATIVE imports so `tsx` resolves them
// without the Next `@/` alias, same rule as render.ts.
// ─────────────────────────────────────────────────────────────────────────────

import os from 'node:os';
import path from 'node:path';

// Matches imageRemoval.ts exactly. The 512 export is the one the editor uses, so
// it is the one that keeps CLI and editor mattes identical.
const MODEL_ID = 'studioludens/birefnet-lite-512';
// fp16 (~94 MB) — half the download, numerically indistinguishable from fp32
// here (measured max channel delta 2/255).
const DTYPE: 'fp16' | 'fp32' = 'fp16';

type TJS = typeof import('@huggingface/transformers');
let tjsPromise: Promise<TJS> | null = null;
const getTjs = (): Promise<TJS> => (tjsPromise ??= import('@huggingface/transformers'));

type Segmenter = {
  model: Awaited<ReturnType<TJS['AutoModel']['from_pretrained']>>;
  processor: Awaited<ReturnType<TJS['AutoProcessor']['from_pretrained']>>;
};

// Lazy module singleton so a batch of boxes loads the model ONCE (~0.6s warm)
// rather than paying the load per image.
let segmenterPromise: Promise<Segmenter> | null = null;
function loadSegmenter(): Promise<Segmenter> {
  if (segmenterPromise) return segmenterPromise;
  const promise = (async (): Promise<Segmenter> => {
    const { env, AutoModel, AutoProcessor } = await getTjs();
    // The default cache lives INSIDE node_modules, which every `npm install`
    // wipes — silently re-downloading ~96 MB. Keep it in the user's cache dir.
    env.cacheDir = path.join(os.homedir(), '.cache', 'sonotool-canvas-cli', 'hf');
    env.allowLocalModels = false;   // always the HF CDN, then the cache above
    const processor = await AutoProcessor.from_pretrained(MODEL_ID);
    // 'cpu' = onnxruntime-node (native). 'wasm' is not a supported device here,
    // and unlike the browser there is no WebGPU path to avoid.
    const model = await AutoModel.from_pretrained(MODEL_ID, { dtype: DTYPE, device: 'cpu' });
    return { model, processor };
  })();
  segmenterPromise = promise;
  // Clear on failure so a later call can retry — but only if this is still the
  // current promise, so a failed concurrent load can't null out a good one.
  promise.catch(() => { if (segmenterPromise === promise) segmenterPromise = null; });
  return promise;
}

/** Where the visible subject actually sits inside the source image, in source
 *  pixels, plus the source dimensions. Lets a caller shrink the BOX to the
 *  subject so its bounds (and the editor's selection handles) wrap the content
 *  rather than a frame of transparent padding. */
export interface CutoutBBox { x: number; y: number; w: number; h: number; sw: number; sh: number }

/**
 * Cut the subject out of an image: returns a transparent PNG (subject kept,
 * background alpha-zeroed) — exactly the artifact ImageBox.fgUrl expects —
 * plus the subject's bounding box within the source.
 * `src` is a URL or a local path.
 */
export async function cutoutPng(src: string): Promise<{ png: Buffer; bbox: CutoutBBox }> {
  const { RawImage } = await getTjs();
  const seg = await loadSegmenter();

  // RawImage.read handles both URLs and paths, decoding through sharp in Node.
  const image = await RawImage.read(src);

  // Preprocess (512², rescale, ImageNet-normalize) then infer.
  const { pixel_values } = await seg.processor(image);
  const outputs = await seg.model({ input_image: pixel_values });

  // The alpha matte, [1,1,512,512]. This export names it `output_image`; the
  // browser build reads `logits`. Try both, then fall back to the first tensor.
  const rec = outputs as Record<string, unknown>;
  const out = rec.output_image ?? rec.logits ?? Object.values(rec)[0];
  if (!out) throw new Error('cutoutPng: model returned no output tensor');

  // sigmoid → 0..255 → back up to the source resolution.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matteTensor = (out as any)[0].sigmoid().mul(255).to('uint8');
  const matte = await RawImage.fromTensor(matteTensor).resize(image.width, image.height);

  // Subject bounds from the matte: the tightest rect containing pixels the model
  // considers foreground. ALPHA_MIN ignores the faint halo a soft matte leaves,
  // which would otherwise stretch the box back out to the full frame.
  const ALPHA_MIN = 16;
  const md = matte.data as Uint8Array | Uint8ClampedArray;
  const mw = matte.width, mh = matte.height;
  let minX = mw, minY = mh, maxX = -1, maxY = -1;
  for (let y = 0; y < mh; y++) {
    const row = y * mw;
    for (let x = 0; x < mw; x++) {
      if (md[row + x] > ALPHA_MIN) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  // Nothing detected → report the whole frame so the caller simply doesn't trim.
  const bbox: CutoutBBox = maxX < 0
    ? { x: 0, y: 0, w: mw, h: mh, sw: mw, sh: mh }
    : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, sw: mw, sh: mh };

  // Composite via sharp, reached through RawImage.toSharp() — sharp is only a
  // transitive dependency, so importing it directly would be fragile.
  // toBlob()/toCanvas() both throw in Node; putAlpha replaces the 13-line
  // getImageData/putImageData loop the browser version needs.
  const png = await image.clone().rgba().putAlpha(matte).toSharp().png().toBuffer();
  return { png, bbox };
}

/**
 * Soften and pull in the edge of a cut-out's alpha channel.
 *
 * A segmentation matte cuts along a hard boundary, so the outermost ring of kept
 * pixels still contains blended BACKGROUND colour. Composited onto a dark slide
 * that ring reads as a thin pale outline tracing the subject — the classic
 * "sticker halo". Blurring the alpha feathers the edge; then a linear ramp shifts
 * the 50% crossing inward, discarding the contaminated ring.
 *
 * `blurPx` is the feather radius; `erode` (0..0.9) is how far the edge is pulled
 * in, as a fraction of that feather. Returns a new RGBA PNG.
 */
export async function featherCutoutPng(
  png: Buffer,
  { featherPx = 1.5, erodePx = 2 }: { featherPx?: number; erodePx?: number } = {},
): Promise<Buffer> {
  // sharp is a transitive dep (via @huggingface/transformers), so it is imported
  // lazily and defensively rather than at module load.
  const mod = await import('sharp');
  const S = (mod as unknown as { default: typeof import('sharp') }).default ?? (mod as unknown as typeof import('sharp'));

  const src = S(png).ensureAlpha();
  const meta = await src.metadata();
  const width = meta.width ?? 0, height = meta.height ?? 0;
  if (!width || !height) throw new Error('featherCutoutPng: could not read image dimensions');

  let alpha = S(await S(png).ensureAlpha().extractChannel(3).raw().toBuffer(), {
    raw: { width, height, channels: 1 },
  });
  // Erosion and feathering are SEPARATE steps on purpose. Doing them together (one
  // big blur plus a ramp) leaves the subject semi-transparent for several pixels at
  // its edge, so a bright background shows THROUGH him and reads as a glow — which
  // looks like the halo it was meant to remove, only softer.
  if (erodePx > 0) {
    // Blur spreads the boundary, then a near-vertical ramp re-sharpens it at a high
    // cut, so the 50% crossing lands ~erodePx inside the original edge. The result
    // is a crisp edge that has moved in, not a soft one.
    alpha = alpha.blur(erodePx).linear(24, -24 * 255 * 0.72);
  }
  // Only now soften, and only slightly, so the cut does not look like a scissor line.
  if (featherPx > 0) alpha = alpha.blur(featherPx);
  // CRITICAL: sharp promotes a 1-channel raw buffer to sRGB the moment you blur it,
  // so `.blur()` silently returns THREE channels. Reading that back as single-channel
  // alpha builds the matte out of interleaved RGB and destroys the cut-out. Force it
  // back to greyscale before taking the buffer.
  const alphaRaw = await alpha.toColourspace('b-w').extractChannel(0).raw().toBuffer();
  if (alphaRaw.length !== width * height) {
    throw new Error(`featherCutoutPng: alpha channel is ${alphaRaw.length} bytes, expected ${width * height}`);
  }

  // Interleave RGB + the new alpha by hand. sharp's joinChannel() looks like the
  // obvious call here and it SILENTLY produces a 3-channel image: the cut-out comes
  // back fully opaque, so the "subject" becomes a rectangle that covers the blurred
  // background and anything tucked behind it. Verified: joinChannel → channels 3,
  // hasAlpha false; this loop → channels 4, hasAlpha true.
  const rgb = await S(png).removeAlpha().raw().toBuffer();
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = rgb[i * 3];
    rgba[i * 4 + 1] = rgb[i * 3 + 1];
    rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = alphaRaw[i];
  }
  return S(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/** Per-side feather distances in source pixels. 0 or omitted = that side is left hard. */
export interface EdgeFeather { top?: number; right?: number; bottom?: number; left?: number }

/**
 * Feather chosen BORDERS of an image into transparency.
 *
 * Two uses, both about not looking pasted on:
 *  - all four sides on a plain image, so a screenshot dissolves into the slide
 *    instead of stopping on a hard rectangle;
 *  - ONE side on a cut-out subject, typically `bottom`, so a torso melts into the
 *    fade rather than ending on a cut line where the matte ran out.
 *
 * Distinct from `featherCutoutPng`, which cleans the whole silhouette of its halo.
 */
export async function featherImageEdgesPng(
  png: Buffer,
  edges: EdgeFeather | { edgePx?: number } = {},
): Promise<Buffer> {
  const mod = await import('sharp');
  const S = (mod as unknown as { default: typeof import('sharp') }).default ?? (mod as unknown as typeof import('sharp'));

  const meta = await S(png).metadata();
  const width = meta.width ?? 0, height = meta.height ?? 0;
  if (!width || !height) throw new Error('featherImageEdgesPng: could not read image dimensions');

  const uniform = (edges as { edgePx?: number }).edgePx;
  const side = {
    top: Math.round((edges as EdgeFeather).top ?? uniform ?? 0),
    right: Math.round((edges as EdgeFeather).right ?? uniform ?? 0),
    bottom: Math.round((edges as EdgeFeather).bottom ?? uniform ?? 0),
    left: Math.round((edges as EdgeFeather).left ?? uniform ?? 0),
  };
  if (Object.values(side).every(v => v <= 0)) throw new Error('featherImageEdgesPng: no edge given');
  if (side.top + side.bottom >= height || side.left + side.right >= width) {
    throw new Error(`featherImageEdgesPng: feather distances exceed the ${width}x${height} image`);
  }

  // Read the alpha up front: it is both what we multiply into AND how we find the
  // subject.
  const existing0 = await S(png).ensureAlpha().extractChannel(3).raw().toBuffer();
  if (existing0.length !== width * height) {
    throw new Error(`featherImageEdgesPng: alpha channel is ${existing0.length} bytes, expected ${width * height}`);
  }

  // Anchor the ramp to the SUBJECT, not the frame. On a cut-out the subject rarely
  // reaches the image border — a torso can stop two thirds of the way down — so a
  // ramp measured from the frame spends nearly all its falloff on empty pixels and
  // changes nothing visible. Measured on the Ken Carson hero: alpha was 0 below
  // y=900 while the frame ran to y=1349, so a 620px "bottom" fade did essentially
  // nothing. Falling back to the frame when the image is fully opaque keeps plain
  // rectangles (screenshots) behaving as before.
  const ALPHA_MIN = 16;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (existing0[row + x] > ALPHA_MIN) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const hasContent = maxX >= 0;
  const b = {
    left: hasContent ? minX : 0,
    right: hasContent ? maxX : width - 1,
    top: hasContent ? minY : 0,
    bottom: hasContent ? maxY : height - 1,
  };

  // The ramp is computed arithmetically rather than as composite+blur. sharp does
  // NOT run a pipeline in call order — it reordered composite against blur here and
  // produced a mask that was transparent in the CENTRE, i.e. the exact inverse of
  // the intent, which is invisible until something disappears on a render.
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const ramp = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    const fy = Math.min(
      side.top > 0 ? (y - b.top) / side.top : 1,
      side.bottom > 0 ? (b.bottom - y) / side.bottom : 1,
    );
    for (let x = 0; x < width; x++) {
      const fx = Math.min(
        side.left > 0 ? (x - b.left) / side.left : 1,
        side.right > 0 ? (b.right - x) / side.right : 1,
      );
      ramp[y * width + x] = Math.round(255 * smooth(Math.max(0, Math.min(1, Math.min(fx, fy)))));
    }
  }

  // Multiply into any existing alpha rather than replacing it, so this composes
  // with a cut-out instead of undoing one.
  //
  // Do NOT chain .toColourspace('b-w') after extractChannel(3): sharp then re-derives
  // the channel from the SOURCE LUMINANCE instead of returning the extracted alpha
  // (measured: extractChannel(3) alone → mean 255 on an opaque JPEG; with the
  // colourspace call → mean 32.1, exactly the image's RGB mean). Multiplying by
  // brightness turns every dark region transparent, which on a black-backed
  // screenshot deletes the card and leaves its white text floating.
  const existing = existing0;
  const rgb = await S(png).removeAlpha().raw().toBuffer();
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = rgb[i * 3];
    rgba[i * 4 + 1] = rgb[i * 3 + 1];
    rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = Math.round((existing[i] * ramp[i]) / 255);
  }
  return S(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/**
 * Bake a border (and optionally rounded corners) into an image's pixels.
 *
 * A screenshot dropped on a near-black slide has no edge of its own, so it reads
 * as text floating on the background rather than as a captured artifact. A thin
 * stroke gives it back its frame.
 *
 * Rounding is baked here TOO, deliberately. The renderer's `cornerRadius` clips
 * the image, so a straight border drawn into the pixels gets sliced off at each
 * corner into four blunt stubs. Doing both in one pass, against one shape, is the
 * only way they agree — which is why the CLI zeroes the box's cornerRadius after
 * calling this.
 *
 * `radiusPx` and `widthPx` are SOURCE pixels; the CLI converts from canvas px.
 */
export async function borderImagePng(
  png: Buffer,
  { widthPx = 3, color = '#ffffff', radiusPx = 0, padPx = 0 }: { widthPx?: number; color?: string; radiusPx?: number; padPx?: number } = {},
): Promise<Buffer> {
  const mod = await import('sharp');
  const S = (mod as unknown as { default: typeof import('sharp') }).default ?? (mod as unknown as typeof import('sharp'));

  // Pad FIRST, with the image's own corner colour, so the stroke has somewhere to
  // sit. A border drawn hard against content that already runs to the edge reads as
  // cramped — the screenshot needs a margin the way a framed print does.
  let src = png;
  if (padPx > 0) {
    const pad = Math.round(padPx);
    const corner = await S(png).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    const bg = { r: corner[0], g: corner[1], b: corner[2], alpha: 1 };
    src = await S(png).extend({ top: pad, bottom: pad, left: pad, right: pad, background: bg }).png().toBuffer();
  }
  const meta = await S(src).metadata();
  const W = meta.width ?? 0, H = meta.height ?? 0;
  if (!W || !H) throw new Error('borderImagePng: could not read image dimensions');
  const sw = Math.max(1, Math.round(widthPx));
  const r = Math.max(0, Math.round(radiusPx));
  if (r * 2 > Math.min(W, H)) throw new Error(`borderImagePng: radius ${r}px is too large for a ${W}x${H} image`);

  // Two passes throughout: sharp reorders composites inside a single pipeline, so
  // masking and stroking together silently produces the wrong shape.
  let base = src;
  if (r > 0) {
    const mask = Buffer.from(
      `<svg width="${W}" height="${H}"><rect x="0" y="0" width="${W}" height="${H}" rx="${r}" ry="${r}" fill="#fff"/></svg>`);
    base = await S(src).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  }
  // Inset by half the stroke so the whole line lands inside the image instead of
  // being clipped in half by the edge.
  const stroke = Buffer.from(
    `<svg width="${W}" height="${H}"><rect x="${sw / 2}" y="${sw / 2}" width="${W - sw}" height="${H - sw}" rx="${r}" ry="${r}" fill="none" stroke="${color}" stroke-width="${sw}"/></svg>`);
  return S(base).ensureAlpha().composite([{ input: stroke, blend: 'over' }]).png().toBuffer();
}
