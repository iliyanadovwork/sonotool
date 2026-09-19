# Canvas CLI

Headless creation, rendering, and publish-prep for the template editor — so an AI
agent (or a script) can build templates & posts, render them to pixel-identical
PNGs, and stage them for Instagram, with **no browser clicks**.

Everything runs from `frontend/`:

```bash
cd frontend
npx tsx scripts/canvas.ts <command> [flags]
```

## Setup

`scripts/load-env.ts` loads `frontend/.env.local`, which must contain:

```
NEXT_PUBLIC_SUPABASE_URL=…
SUPABASE_SECRET_KEY=…            # service-role key — bypasses RLS
```

The service-role client (`admin-client.ts`) bypasses RLS, so the CLI **must** set
`user_id` explicitly. It defaults to the owner account configured in
`scripts/canvas.ts`; override with `--user <uuid>`.

> **Building a post?** Read [`POSTS.md`](./POSTS.md) first (slide structure,
> image sourcing, charts, verification) and [`CAPTIONS.md`](./CAPTIONS.md) before
> writing any caption.

## Commands

| Command | What it does |
|---|---|
| `demo` | Build + create a built-in sample template (proves the create path). |
| `create --kind template\|post --spec spec.json [--name … --user …]` | Validate a spec and create a template/post + its slides. |
| `render --slide <id> --kind template\|post --out out.png [--app <url>]` | Render one saved slide to a 1080×1350 PNG (headless Chromium). |
| `render --spec spec.json [--slide-index N --out out.png]` | Render a spec **directly, without saving** — fast visual iteration before `create`. |
| `render … --preview` | Also draw unfilled placeholder **frames** (a slot preview) — normally they export blank. |
| `assets (--file <path> \| --url <url>) [--user …]` | Upload/mirror an image to the public `post-images` bucket → public URL. |
| `publish --id <id> --kind template\|post [--caption … --app …]` | **DRY RUN** — render + upload every slide and print the publish payload. Never posts. |
| `create --from-template <templateId> --name "…"` | New POST from a template: slides deep-cloned, locks inherited, `source_template_id` recorded, starts as draft. |
| `set-text --id <id> --box <textBoxId> --text "…"` | Rewrite a text box. `**word**` = secondary-weight run, `\n` = line break; plain text clears old runs. Never lock-gated (text is always editable); singleLine width is enforced at render. |
| `inspect --id <id> --kind template\|post` | Agent-readable summary: slides, elements in z-order, fonts/spans/locks, unfilled placeholders. |
| `lock --id <id> --box <textBoxId> --props vAlign,geometry,…\|none` | Template-defined style locks: listed props become read-only in POSTS mode (text stays editable). `geometry` = x,y,width,height. |
| `duplicate --id <id> --kind template\|post [--name …]` | Clone a design (parent + all slides), named "… copy". |
| `add-slide --id <id> [--from <slideId>] [--name …]` | Append a slide; `--from` deep-clones it. Every box in the clone gets a FRESH id (and `layerOrderIds` / `behindSubjectOf` are remapped to match), so `--box` stays unambiguous. Before this was fixed, a clone shared its source's box ids and edits silently landed on the wrong slide. |
| `fill --id <id> --kind template\|post --image <file\|url> [--slide N --slot N]` | Fill the Nth image **placeholder** on a slide with an image. |
| `render --id <designId> --all [--out-dir dir]` | Render **every** slide of a design in position order — one visual-review command. |
| `add-chart --id <id> --slide <slideId> (--artist "name" \| --spotify-id ID) [--x --y --width --height --z --set k=v,…]` | Add an artist index chart: resolves the artist through the running app (same routes as the editor's ChartSearchCard), snapshots series + releases onto the box. Default geometry = the editor's (960 wide, design aspect, centred). |
| `set-chart --id <id> --box <chartBoxId> [--set period=1Y,mode=candle,showGrid=false,…] [--x/--y/--width/--height] [--artist \| --spotify-id]` | Reconfigure a chart box: whitelisted display fields via `--set` (period, mode, layout, show* toggles, colours, opacity), geometry, and/or a fresh artist snapshot. |
| `set-image-style --id <id> --box <imageBoxId> [--opacity 0-100] [--corner-radius N] [--blend multiply\|…\|none] [--fade "top=40,color=#000000"\|none] [--shadow "blur=24,y=8,opacity=60,color=#RRGGBB"\|none]` | Per-box presentation. Fade edges are **percent of the box dimension** (0-100, the editor's slider units) and REPLACE the whole fade (editor-authored per-edge curves are dropped); colours must be 6-digit hex. `none` clears a facet. Honours template locks on posts. |
| `set-crop --id <id> --box <imageBoxId> --rect "top=0.1,left=0.2" \| --none` | Per-edge source crop — fractions (0-0.95) of the source image hidden per edge. Note: an all-zero `--rect` is a SET crop (disables cover-fit → may stretch); use `--none` to remove the crop and restore cover-fit. |
| `distort --id <id> --box <imageBoxId> [--tl dx,dy --tr dx,dy --br dx,dy --bl dx,dy] \| --none` | Freeform perspective warp (per-corner canvas-px offsets). `rotate` is the pure-rotation special case; both write the same stored quad. |
| `set-caption --id <id> [--slide <slideId>] [--text …\|--file …\|--clear]` | PER-SLIDE Instagram caption (max 2199 chars). `--slide` omitted → the position-0 slide, whose caption a carousel publish uses. **Before writing one, read and follow [`CAPTIONS.md`](./CAPTIONS.md)** — the output echoes measured facts to verify against its checklist. The old post-level column is a read-only legacy fallback. |

### Examples

```bash
# Create from a spec
npx tsx scripts/canvas.ts create --kind post --spec ./my-post.json

# Upload an image, then reference the returned URL in a spec's imageBoxes[].url
npx tsx scripts/canvas.ts assets --file ./bg.jpg

# Render a slide you created
npx tsx scripts/canvas.ts render --slide <slideId> --kind post --out ./out.png
```

## Spec format (`DesignSpec`)

Validated by `validate.ts` (Zod) before anything touches the DB — unknown top-level
keys and missing slides fail loudly.

```jsonc
{
  "name": "My design",
  "slides": [
    {
      "name": "main",                       // defaults: 'main', then 'supporting_1', …
      "headline": "", "subheadline": "",    // optional legacy header fields
      "settings": { "canvasColor": "#0b0b0f", "showFade": true, "fadeIntensity": 90 },
      "textBoxes":  [ { "text": "HELLO", "x": 90, "y": 980, "width": 900, "height": 260,
                        "fontSize": 92, "fontWeight": 700, "color": "#fff", "allCaps": true } ],
      "imageBoxes": [ { "url": "<public url>", "x": 0, "y": 0, "width": 1080, "height": 1350 } ],
      "chartBoxes": [ { "spotifyId": "…", "artistName": "…", "x": 80, "y": 300,
                        "width": 920, "height": 500,
                        "data": [ { "index": 41, "timestamp": "2026-01-01T00:00:00.000Z" } ] } ]
    }
  ]
}
```

- **Single-line constraint**: `singleLine: true` on a text box hard-limits it to one line at its
  fixed font size — the editor refuses overflowing edits, and `render`/`publish` FAIL with a
  precise error if persisted text violates it (nothing shrinks or truncates silently). Lockable
  via `lock … --props singleLine` so posts can't remove the constraint.
- **Mixed-weight / poster headlines**: a `textBox` accepts `spans: [{ text, weight }]` for per-word
  weights (e.g. bold key words, lighter connectors) and `fitToWidth: true` for poster mode, where
  each line (split on `\n`) scales to fill the box width. Both flow through untouched (spans are just
  fields on the text box). This is how the Sonotrade "DON TOLIVER DROPS…" headline is built.
- `settings` merges over `defaultCarouselSettings()`; every `CarouselSettings` field is allowed.
- Element style beyond the required keys (`text` / `url` / chart identity+geometry) is merged over the element defaults (`defaultTextBox`/`defaultImageBox`/`defaultChartBox`).
- **Image placeholders (slots)**: an `imageBox` may set `"placeholder": true` and omit `url` — a template
  can define *where* an image goes, filled later. An unfilled placeholder shows a dashed frame in the editor
  only and exports blank; fill it in the editor (select → **Upload image**, or drag an image onto it) or with
  `canvas.ts fill …`. `placeholderLabel` sets the frame's caption (e.g. `"artist photo"`).
- The canvas is **1080×1350**. Z-order is derived automatically (images → fade → charts → text) unless `settings.layerOrderIds` is set.
- Chart series: pass explicit `data`, or build it with `charts.ts` (`toChartData` / `fetchTrendData`).

## Modules (`src/lib/template-editor/`)

- `slide-serde.ts` — the CarouselSettings ↔ column serializers, shared with the editor hook (single source of truth).
- `templateEditorTypes.ts` (`../../app/components/`) — leaf types + builders (`defaultTextBox`/`defaultImageBox`/`defaultChartBox`). Imports nothing → portable.
- `build.ts` — `SlideSpec`/`DesignSpec` → valid `SlideRow[]`.
- `validate.ts` — Zod schema over `DesignSpec`.
- `admin-client.ts` — service-role Supabase client.
- `persist.ts` — insert parent + slides.
- `assets.ts` — image upload (local file or remote URL) with retry.
- `charts.ts` — chart-series helpers.
- `render.ts` — Playwright headless PNG (imported ONLY by the CLI — it pulls in `playwright`, a Node-only dep; never import it from app/browser code).
- `publish.ts` — publish-payload prep (render + upload + assemble); does **not** post.

Render is driven by `src/app/render/page.tsx` — a `staticMode` canvas mount that
Playwright injects a slide into (`window.__SLIDE__`) and reads the PNG back from
(`window.__PNG__`). It needs the app server running (default `http://localhost:3011`,
override with `--app`).

## Atomicity

`persist.ts` inserts the parent, then the slides; if the slide insert fails it
**compensates by deleting the parent** (no orphan parents). This covers the realistic
failure modes. PostgREST can't span statements in one transaction, so true atomicity
needs a Postgres function. Ready-to-apply (kept out of prod until reviewed):

```sql
-- Optional: fully atomic create via a single txn. Apply, then have persist.ts call it via rpc().
create or replace function create_design(
  p_parent_table text, p_parent jsonb, p_slide_table text, p_slide_fk text, p_slides jsonb[]
) returns jsonb language plpgsql as $$
declare v_id uuid; v_slide jsonb; v_ids uuid[] := '{}';
begin
  execute format('insert into %I select * from jsonb_populate_record(null::%I, $1) returning id', p_parent_table, p_parent_table)
    into v_id using p_parent;
  foreach v_slide in array p_slides loop
    execute format('insert into %I select * from jsonb_populate_record(null::%I, $1 || jsonb_build_object(%L, $2)) returning id',
                   p_slide_table, p_slide_table, p_slide_fk)
      into v_slide using v_slide, v_id;
    v_ids := v_ids || (v_slide)::uuid;
  end loop;
  return jsonb_build_object('id', v_id, 'slideIds', v_ids);
end $$;
```

## Publishing

The CLI does **not** post to Instagram. `publish` only prepares the payload the app's
`POST /api/posts/instagram/publish` route expects (`{ caption, items:[{kind:'image',url}] }`).
Live posting requires the team-password unlock and a connected IG token, both bound to
the browser session — neither of which the CLI holds.

## Safety notes (hardening)

The CLI runs with the service-role key, so it is deliberately conservative at the edges:

- **`assets --file` uploads images only.** The path's extension must be a known image type
  (`.jpg/.jpeg/.png/.webp/.gif/.avif`) — otherwise it's refused. This prevents an arbitrary
  local file (`.env.local`, an SSH key) from being published to the world-readable bucket.
- **`assets --url` blocks private/loopback hosts** (localhost, `127.*`, RFC1918, `169.254.*`
  incl. cloud metadata) before fetching, so it can't be steered into mirroring an internal
  resource into the public bucket.
- **Value-expecting flags never silently default.** `--user`/`--kind`/etc. accept `--k v` and
  `--k=v`; a bare `--user` errors, and an unknown `--kind` errors instead of picking a table.
  (This closes a bug where `--user=<uuid>` was dropped and ownership fell back to the default.)
- **`render` fails fast on video slides** (an image box with a `videoUrl`) — the headless
  still-renderer can't decode video — instead of hanging on the readiness gate.
- **Fonts**: the render page injects the Google-Fonts stylesheet + `document.fonts.load()` for
  every family a slide references, so non-Inter display faces (Anton, Bebas, …) render true,
  not a fallback.

## An open editor tab will delete what the CLI adds

The CLI writes ONE column of ONE slide per command (`set-text` updates
`text_boxes`, `add-chart` updates `chart_boxes`, and so on). The editor does not:
a save from an open tab rewrites WHOLE SLIDE ROWS, for every slide, from whatever
that tab loaded into memory.

So if a tab was opened before you ran `add-chart`, its in-memory copy of that
slide has no chart. Its next autosave writes `chart_boxes: []` back over yours and
the chart silently vanishes. This is not a merge conflict and nothing errors: the
tab simply wins, because it wrote last and it wrote everything.

The tell is in `updated_at`: several slides stamped within the same second or two,
including slides the CLI never touched.

```sql
select position, name,
       jsonb_array_length(coalesce(chart_boxes,'[]'::jsonb)) as charts,
       updated_at
from template_editor_post_slides
where post_id = '<postId>' order by position;
```

**Reading is not safe either, but it is not continuous.** Measured on the Ken
Carson post: THREE separate bursts rewrote every slide in under ten seconds each,
and all three stamped the End Slide, which no CLI command in any batch had
touched. Only a full-document save does that. The third burst destroyed two
finished captions. The tab's owner was reading, not editing, throughout.

Do not over-read this as "the tab writes constantly": a deliberate 78-second watch
with the tab open recorded ZERO writes and an unchanged `updated_at`. The saves
are event-driven (focus, visibility, navigation or a slow timer), so a quiet
sample proves nothing and absence of a burst is not safety. Only closing the tab
is reliable.

**Working rule: the CLI and an open editor tab must not be live at the same time.**
Either close the tab while the CLI runs, or reload it immediately after every CLI
write and before touching anything. A reload is what re-reads the CLI's changes
into the tab's memory; without it, the tab is still holding the old document and
will overwrite again on the next save.

*Recorded after the same chart was wiped twice in one session, the second time
while diagnosing the first.*

## Chart windows: arbitrary ranges with `--from` / `--to`

`--set period=1D|1W|1M|3M|6M|1Y|ALL` is a rolling window counted back from the end
of the data. When you need a window the enum cannot express, give dates instead:

```bash
# everything since a chosen day, up to the latest data
canvas.ts set-chart --id <id> --box <chartBox> --from 2026-08-03

# a closed range
canvas.ts add-chart --id <id> --slide <s> --artist "Ken Carson" --from 2026-08-03 --to 2026-08-24

# back to a rolling period
canvas.ts set-chart --id <id> --box <chartBox> --from none --set period=1M
```

`--from` sets `startDate`, which OUTRANKS both `period` and `sinceRelease`. `--to`
sets `endDate` and flips `endMode` to `custom` in the same write, because `endDate`
is only read when `endMode` is `custom` and passing `--to` alone would silently do
nothing. Both accept `none` to clear. Dates are ISO (`2026-08-03`).

**The case this exists for.** The index backend was off from **2026-06-13 to
2026-07-28**, and there is a second short hole to **2026-08-03**. The renderer
joins the surviving points with one straight segment, so any window reaching back
into that period shows a long flat line that looks like a market holding steady
and is really an absence of data. No fixed period could start after it, so a slide
either lied about the flat stretch or lost the story. `--from 2026-08-03` fixes it.

`add-chart` also prints `dataGaps` and a warning when the chosen window contains a
hole longer than three days. Treat that warning as a blocker: shorten the window or
pin `--from` past the gap. Never describe the flat segment on the slide.

## Edges on pasted images: `border` and `feather`

Two opposite treatments for the same problem — an image that reads as pasted on.

```bash
# give it a defined edge (screenshots, album covers on dark slides)
canvas.ts border --id <id> --box <box> --width 2 --radius 14 --color "#d8d8d8"

# dissolve its edge into the slide instead
canvas.ts feather --id <id> --box <box> --edges 70
```

`border` takes CANVAS pixels and converts to source pixels using the box width, so
a 2px stroke looks 2px whether the asset is 600px or 3000px wide. It bakes the
rounding in alongside the stroke and sets the box's `cornerRadius` to 0.

**Why it owns the rounding.** `cornerRadius` clips the rendered image. A straight
border baked into the pixels therefore gets cut off at each corner, leaving four
blunt stubs. Both have to come from the same rounded rect or they disagree.

**Both are destructive.** They rewrite the stored image (`border`, `feather
--edges` on a plain box) or the cut-out (`feather` on a split box). Re-running
compounds rather than replaces. To retune, `set-image` the original file and redo
the step.

Do not use both on one image without thinking: a feathered edge has no boundary
for a stroke to sit on, and a stroke on a feathered image floats away from it.

## `add-slide --from` clones the CAPTION too

A cloned slide inherits the source slide's caption verbatim. Nothing warns you,
and `render` does not show captions, so a new slide can carry 1,700 characters
describing completely different content — a Metro Boomin slide shipped holding
the caption written for a Variety screenshot, and two new chart slides both held
Dr. Dre's market read.

This matters more now that POSTS.md rule 20 defers caption writing until the user
signs off: the slides look uncaptioned in the render while the database says
otherwise. After any `add-slide --from`, either rewrite the caption or clear it:

```bash
npx tsx scripts/canvas.ts set-caption --id <postId> --slide <newSlideId> --clear
npx tsx scripts/canvas.ts inspect --id <postId> --kind post   # captionLength per slide
```

## When `--blur 40` still isn't soft enough

`set-effects --layer bg --blur N` caps at 40, and the top of that range is a
shallow curve — 34 to 40 is barely visible. For a genuinely soft background,
pre-blur the base image and let the renderer's blur compound on top of it:

```bash
# 1. blur the source, upload it
npx tsx -e "import sharp from 'sharp';(async()=>{await sharp('src.png').blur(20).png().toFile('bg-soft.png')})();"
npx tsx scripts/canvas.ts assets --file bg-soft.png
# 2. point the split box's base `url` at that upload, leaving fgUrl alone
```

A split box keeps the full photo in `url` (drawn blurred, behind) and the cut-out
subject in `fgUrl` (drawn sharp, in front), so swapping `url` softens only the
background. Do NOT use `set-image` for this — it clears the split. Trade-off:
`url` is also what renders if the split is ever turned off, so the box will look
blurry if someone unsplits it in the editor.

### `--edges` is in SOURCE pixels, not canvas pixels

The fade distance is measured on the FILE, so a large image rendered into a small
box gets a proportionally tiny fade. A 1280px logo in a 340px box scales by
340/1280 = 0.27, so `--edges 40` yields ~10px on the canvas — invisible. Work
backwards from the effect you want:

    edges = wanted_canvas_px * (source_width / box_width)

That 1280px logo needed `--edges 90` for a ~24px fade. On a full-canvas hero the
two are roughly equal and the distinction never comes up, which is exactly why it
bites on small boxes.

### `set-image` clears `effects`

Re-pointing a box at a new file keeps `opacity`, `shadow`, `cornerRadius` and
`behindSubjectOf`, but drops `effects` (the `set-effects` blur/noise/brightness).
`feather` and `border` re-upload the file too. So apply blur/noise LAST, after
any command that rewrites the image, or they will silently vanish.

## Debugging text layout: `scripts/text-probe.ts`

```
npx tsx scripts/text-probe.ts --slide <slideId> [--kind post|template]
```

Prints, per headline line, what the BROWSER actually measures with the real font
loaded: size, `fontBoundingBoxAscent`, `actualBoundingBoxAscent/Descent`, the
advance, and the derived `topPad` (the empty space a font leaves above its
capitals, which scales with size).

Use it before touching poster/`fitToWidth` layout. Those metrics only exist at
runtime in the browser, and reading gaps off a rendered PNG conflates all of them
— two attempts at fixing headline spacing failed on guessed constants before this
probe showed the real ones. It also surfaces per-box `lineHeight`, which can be
NEGATIVE (the house heading uses -13, i.e. a line factor of 0.844); assuming a
positive factor produces negative leading and overlapping lines.

## `set-image` does NOT repoint a video box

On a box holding a video, `set-image --image new.mp4` refreshes the poster still
but leaves `videoUrl` pointing at the OLD file. Renders look correct — they use
the poster — so the swap appears to have worked while the exported post still
ships the previous video. Verified: after swapping a de-letterboxed clip in, the
box rendered cropped and `videoUrl` still held the uncropped upload.

To replace a video, `remove-image` the box and `add-image` the new file, then
re-run `poster`. Check it landed:

```sql
select b->>'videoUrl' from template_editor_post_slides,
lateral jsonb_array_elements(to_jsonb(image_boxes)) b where id = '<slideId>';
```

## Finding memes (`scripts/research.ts memes`)

```
tsx scripts/research.ts memes "<topic>" [--min-faves 300] [--video] [--n 20] [--sheet cand.png]
tsx scripts/research.ts memes --replies <statusId> [--sheet cand.png]
```

Searches X for posts carrying media and returns text, engagement and direct
media URLs. Top-level search surfaces news graphics rather than jokes, so the
usual flow is two steps: search the topic to find the aggregator post everyone
replied to, then `--replies <its id>` to get the reactions. The root post is
dropped from its own reply results.

`--sheet` downloads every candidate and tiles them into one numbered PNG. Use it
every time: a meme reply's text is just "@handle", so the JSON cannot tell you
what the picture is, and the results are unvetted (slurs and profanity appear).
Feed the chosen URL straight to `add-image` or `set-image`.

Video results return a real `.mp4` (highest-bitrate `video/mp4` variant from
`video_info.variants`), with the poster frame kept separately in `poster[]` so
the contact sheet still renders. `allowDownload` mirrors the uploader's own
download setting where X provides it.

### Generic memes from Reddit

```
tsx scripts/research.ts memes "<mood>" --reddit [--subs memes,funny] [--fetch dir/]
```

Keyless, via the Arctic Shift mirror (Reddit's own `.json` endpoints 403 script
traffic, and Tenor stopped issuing API keys in January 2026 — Giphy's terms
forbid this use case outright, so this is the only open route to Reddit video).

Reddit memes are about a MOOD, never about your specific story — use `--replies`
for a joke about the actual news and this for a generic emotional beat.

`--fetch <dir>` is required for videos. A `v.redd.it` `fallback_url` is a SILENT
video track: the audio is a separate file whose name is not in the post JSON, so
the tool reads `DASHPlaylist.mpd` for the real track name and muxes with ffmpeg.
The post's own `has_audio` flag is unreliable in both directions — observed true
on a silent upload and false on one that had an AAC track — so the manifest is
the only trustworthy source. Legacy `DASH_audio.mp4` names 403 on current
uploads; current names are `CMAF_AUDIO_*`.

Needs `TWITTERAPI_IO_KEY` in `frontend/.env.local` (X path only; Reddit needs no
key). Meme slide format and the rules for using one: POSTS.md rule 19.

