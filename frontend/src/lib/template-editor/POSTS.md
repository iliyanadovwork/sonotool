# Post rules — how to build a good Sonotrade carousel

Guidelines for ANY agent (AI or human) building an Instagram carousel through the
canvas CLI. Read this BEFORE creating a post. Captions have their own contract:
[`CAPTIONS.md`](./CAPTIONS.md). Command reference: [`CLI.md`](./CLI.md).

## The job

Sonotrade posts turn a piece of music news into a carousel that (a) stops the
scroll, (b) tells someone something they didn't know, and (c) connects the story
to artist index data when there is a real connection. Post like a music-news
desk that happens to own market data — not like a brand doing marketing.

## Who this is for

**People who already follow this music.** They are on a feed about artist indices;
they know the artists by name, they know the big labels, they know roughly what
came out this year. Write for them.

So do NOT spend slide space on:
- who the artist is ("X is an Atlanta rapper"), their label, their age, their
  home city, or any biography the reader did not ask for;
- explaining an artist's significance. If someone needs telling why Ken Carson
  matters, a sentence will not fix it, and the sentence is read by everyone else
  as a signal the post is not for them.

Spend it instead on what even a fan does not know: the specific news, the exact
numbers, what was promised versus what happened, and the market read. Assume the
name, report the story.

*This corrects an over-correction. Rule 15 below says to write for a reader who
knows nothing, and that rule came from real feedback — but the feedback was about
DANGLING SENTENCES ("all three what", "make him drop it"), not about identifying
the artist. Comprehensibility means every sentence stands up on its own. It does
not mean introducing the subject.*

## Non-negotiables

- **Never invent a fact.** Every number, date, name, chart position and quote
  must come from a source you actually read this session. Research first, build
  second. If you can't verify it, leave it out.
- **Never claim something is confirmed when it is speculation.** "Fans think",
  "the theory is", "nothing official yet" — say which is which.
- **Attribute the trigger.** If the post comes from someone's reporting or a
  screenshot, the story is the artist's action, not the account that posted it.
- **Sources go in your summary to the user, never on the slides.**

## Slide structure

A carousel is a sequence with jobs, not a pile of images. The proven shape:

| Slide | Job |
|---|---|
| 1 — hero | One image + the headline. The whole story in one glance. |
| 2..n — supporting | One BEAT per slide, in order: the setup, then what happened, then where it stands. Image on top, justified text block below. |
| chart | The Sonotrade angle: an artist's index over a window that shows the story. Not fixed to a position, and not necessarily one — see below. |
| final | The stakes, what to watch next, or the open question. |

**A chart is a BEAT, not a footer.** It has landed near the end on the posts built
so far, which is a habit rather than a rule. Put it where the argument needs it: if
the market reaction IS the turn in the story, it belongs in the middle, with the
slides after it explaining what the line did. A chart parked at the end because
that is where charts go reads as an appendix.

**Use as many charts as there are artists worth charting.** When a post covers more
than one artist and each has a real move behind them, give them a slide each, or put
the second chart next to the artist it belongs to. One chart is the common case, not
the limit. Do not chart an artist the post barely mentions just for symmetry.

Three to six slides. Two is thin; past six people stop swiping.

### Tell the whole story, not just the opening

**The carousel has to FINISH.** The commonest failure is a post that sets something
up beautifully and then stops: slide 1 states the situation, slide 2 gives the best
artifact, and then it drifts into side material and ends without ever answering the
question it raised. A reader who swipes to the end should know how it turned out.

Before building, write the beats in order and check the last one resolves the
first. A working shape:

1. **The claim** — hero. What is happening.
2. **The setup** — what was promised, by whom, in their own words.
3. **What happened next** — the turn. The thing that makes it a story rather than
   an announcement.
4. **Where it stands NOW** — the current state, checked today. This is the beat
   that gets skipped, and it is the one the reader actually swiped for.
5. **The chart** — what the market makes of it.

That order is a default, not a template. The chart moves whenever the market
reaction is part of the story rather than the epilogue, and a post about two
artists may carry two charts at different points. What must not move is beat 4:
the post still has to say where things stand.

*Why: on the Ken Carson build, slides 1-2 landed the promise and the missed date,
then the post wandered into fan reactions and stopped. It never said whether the
album had arrived. The fix was not more slides, it was ordering them so the last
content beat answered the headline: still not on any streaming service, no new
date, and meanwhile he is still posting the merch.*

**Use as many slides as the story needs.** Do not compress three beats into one
paragraph to stay at four slides. Six is the ceiling because people stop swiping,
not because shorter is better.

**Verify the closing beat the day you build.** "Where it stands" is the one fact
with a shelf life of hours. Check the streaming catalogues and the artist's own
recent posts rather than trusting research from earlier in the session.

**Grow the carousel with `add-slide --from <slideId>`** — cloning a supporting
slide inherits the template's furniture (texture, locks, text frame geometry). A
blank slide has none of it and will look wrong. Remember to `remove-chart` if you
cloned a slide that had one.

## Text on slides

- **Headline** (slide 1): 3 short lines, `\n` between them. Wrap the ARTIST NAME
  and the SUBJECT in `**…**` for the heavy secondary weight (see rule 9) — that
  contrast IS the house style. Never bold a year, a filler word, or a whole line.
- **Subheading**: one line, ~50 chars, concrete. It is the caption of the image,
  not a slogan.
- **Supporting text**: 2–4 sentences, justified. One idea. Lead with the fact,
  not the setup.
- Slide text is ALL CAPS at render time — write it in sentence case and let the
  template do the work. Don't write in caps.
- No emojis, no hashtags, no @handles on slides.

## Images

You can and should source your own. `add-image --image <file|url>` mirrors a
remote image into our own storage first, so the post never breaks when the
source URL dies, and the render canvas stays CORS-clean.

- **The hero is always a FACE** — normally the artist the post is about. A face
  is recognisable at thumbnail size; that recognition is what stops the scroll.
- **The primary source is a SUPPORTING image**: the actual post, screenshot or
  artifact the story is about is your best evidence slide — just never slide 1.
  Objects and secondary artists stay secondary.
- **Reaction slides** work: a high-engagement reply, a meme, a quote-tweet
  screenshot. Use engagement numbers only if you verified them.
- **Place inside the SAFE ZONE.** `inspect` prints it per slide: 60px from the
  top and both sides, and 60px above that slide's fade floor (where the fade goes
  fully solid). It's derived from the slide, so it stays right as the fade is
  tuned — never eyeball the fade geometry. Elements that escape it are listed
  per element as `outsideSafeZone`, and `add-image` reports the same at
  placement time. A deliberate bleed is allowed; an accidental one is the bug
  this catches. Background textures and geometry-locked template furniture (the
  logo) are exempt — they sit where the template put them.
- Hero images go `--z bottom` so the fade and headline sit on top.
- Supporting images: `--width 900 --x 90` (90px inset) reads well above a text
  block at y≈997.
- Omit `--height` — fit-to-width preserves the natural aspect. Passing a height
  reintroduces a cover-crop.
- **Rights are the publisher's call.** Editorial screenshots of the news being
  reported are normal practice; wholesale reposting of a photographer's work is
  not. When unsure, ask rather than assume.

## Charts

`add-chart --artist "<name>"` snapshots the artist's index onto the slide.

- Include a chart only when the story has a market angle. A chart on an
  unrelated story is filler.
- **Pick the window that shows the story** (`--set period=1M|3M|1Y|ALL`). The
  default ALL usually flattens the very move you're writing about.
- **Geometry is enforced, not your decision.** Charts are 960 wide with 60px
  gutters and always centred; there is no `--x`. Pass `--y` and nothing else.
- **The layout auto-fits.** The CLI measures the clear space above whatever sits
  below the chart and picks `mobile` when it fits, `desktop` (~22% shorter at the
  same width) when it doesn't. If there isn't room for a readable chart it
  refuses and tells you what's in the way — move it with `--y` rather than
  forcing a size.
- `--width`/`--height` are escape hatches. Passing `--height` opts out of the
  auto-fit, so only do it when you have a reason.
- **Inherited an off-standard chart?** `set-chart --box <id> --standard`
  re-applies the house width, re-centres it, and re-fits the layout to that
  slide. Charts built before the rule existed (or by hand) do not fix themselves.
- Say what the chart shows in the supporting text. A chart with no reading is
  decoration.

## Locks

Posts inherit template locks. If a write is refused as "template-locked", that is
the template's design decision — **do not work around it**. Change the template,
or lay the slide out differently.

## Reference posts — look at these before you build

Prose cannot transfer taste. These posts are the standard; **inspect and render
them first** so you can see what "good" means here rather than inferring it:

```bash
npx tsx scripts/canvas.ts inspect --id <id> --kind post
npx tsx scripts/canvas.ts render  --id <id> --all --kind post --out-dir ref
```

| Post id | Why it's here |
|---|---|
| `05c1aa71-9e48-4561-8428-07abc8884123` | "Lil Durk Trial" — 6 slides. The full shape: split-subject hero, evidence slides, live chart, per-slide pacing. |
| `3491b17d-ace2-4585-9e0d-c1a3936f8ac3` | "Drake — FOMO 2026" — 3 slides built entirely from the CLI. Primary-source hero (the actual screenshot the story is about), chart windowed to show the move, reaction slide. |
| `24640864-e0f9-4a3c-80b8-14ace4960225` | "Ken Carson — Cartunez delays" — 8 slides. Longest story arc here: a hero with the full split/feather/edge-fade recipe, four evidence slides built from primary screenshots, a sourced meme slide at position 3 (rule 19), and a dead-zone-aware chart. |
| `8ca714b6-0658-4fdf-97ff-1b47a5acbdba` | "Dr. Dre — AI in music" — 8 slides. Built when the viral framing of a quote was WRONG: everyone ran "Dre uses AI", but the news was the next line, where Iovine said there are "a lot of closet AI producers" and Dre agreed. Shows how to source primary-text artifacts (article paragraphs re-captured at a narrow viewport so they wrap into a readable card) and how to write a chart slide when the market did NOT move. |

Keep this table current: when a post comes out well, add it; when one stops
representing the standard, remove it. It points at live data, so it never goes
stale the way a screenshot in a repo would.

## House rules — learned from feedback

Rules added as the team gives feedback on real posts. Each carries its reason —
a rule without its why gets misapplied by the next agent. **Newest last.**

1. **Source your own images; don't ship a post with an empty slot.** Pull from
   the story's own media (the X post, the IG screenshot) or the web via
   `add-image --image <url>`, which mirrors it into our storage.
   *Why: a first CLI build left the hero empty and shipped a half-finished slide.*
2. **Prefer the primary source — as a SUPPORTING image.** The actual screenshot
   of the thing being reported (a post, a CD case, a chart) is the strongest
   evidence slide. Superseded by rule 4 for the hero specifically.
   *Why: the artifact proves the story, but it doesn't stop a scroll.*
3. **Use high-engagement replies as a slide.** A reply with lots of likes that
   carries a photo or a gif makes a genuine reaction slide.
   *Why: it's how the Lil Durk post earned its middle slides. Note: X replies are
   not readable without API auth — ask the user for screenshots when you need them.*
4. **The hero is ALWAYS a face — normally the artist the post is about.** Objects
   (a CD case, a screenshot, a phone) and secondary artists never take slide 1;
   they belong on supporting slides.
   *Why: a face is instantly recognisable at thumbnail size and in a crowded feed
   — that recognition is what stops the scroll. An object makes the reader work
   out what they're looking at, and they don't. Overrides rule 2 for slide 1.*
5. **Compose the hero as face + secondary object, not one full-bleed face.** Size
   the face down and set it to one side (roughly 55-60% of the canvas width),
   leaving room beside it for a secondary image — usually the artifact from rule
   2. One image alone is fine when nothing else adds meaning, but when a
   meaningful object exists, prefer the pair.
   *Why: full-bleed crops the face badly and reads as a stock photo. Paired, the
   reader gets the "who" and the "what" in one glance without swiping — on the
   Drake post that's his face plus the actual FEAR OF MISSING OUT CD case.*
   *Gap treatment: see rule 6 — the negative space this leaves gets a backdrop.*
   **Keep the subject clear of the top margin.** His head and hair must sit fully
   inside the safe zone, never in the 60px strip above it and never cropped by the
   canvas edge. `inspect` prints the zone per slide; if the hair is in the margin,
   move the box DOWN (`move --y`) rather than shrinking him.
   *Why: a subject pressed into the top margin reads as a badly cropped photo
   rather than a composed frame, and it crowds the logo. Recorded after the Ken
   Carson hero shipped with his hair running off the top of the canvas.*
   **But do not move a full-canvas hero box with `--y`.** Once `expand-image` has
   filled the frame, sliding the BOX down uncovers the canvas behind it and leaves
   a hard horizontal seam across the top. Shift the CONTENT instead: pad the image
   by the same number of pixels with `extendWith: 'copy'`, crop the identical
   amount off the bottom, re-upload with `set-image --keep-size`, then re-run
   `split-image`, the shadow and `feather`. The box stays at 0,0 full-canvas.
   *(sharp reorders `.extract()` before `.extend()` inside one pipeline, so do the
   pad and the crop as two separate passes or the crop is silently skipped.)*
6. **Never leave black space behind imagery — expand the primary image, then
   blur its background.** ONE image box, not two. Three steps:
   1. `expand-image --id <id> --box <primaryBoxId>` — generative outpaint IN
      PLACE; the box's image is replaced by one filling the whole canvas.
   2. `split-image --id <id> --box <id> --blur 34` — cuts the subject out and
      applies the house split look in one step. Runs the SAME model the editor's
      background-detection button uses, so the matte is identical either way.
      ~70s on a cold model download, ~2.5s per image after.
   The house split look is applied by default, not chosen per post:
   **background = blur with FADED EDGES + grain 12; foreground = grain 6.**
   *Why faded edges: the blurred layer dissolves at the box edge instead of
   stopping on a hard line, so it reads as depth rather than a pasted rectangle.
   Why grain on BOTH: a clean cut-out over a grainy blur looks stuck on; matching
   texture welds the two layers back into one photograph — and the grain also
   breaks up the banding a heavy blur creates.*
   3. `feather --id <id> --box <id> --erode 3 --amount 1.2` — removes the pale
      outline the segmenter leaves. It cuts on a hard boundary, so the outer ring of
      kept pixels still holds blended BACKGROUND colour. Run it after every hero
      split. Both flags are in PIXELS: `--erode` is how far the edge is pulled in,
      `--amount` is how soft it is left.
      **Erode hard, feather lightly.** They are separate steps for a reason. A big
      feather leaves the subject semi-transparent for several pixels, so a bright
      background shows THROUGH the edge and reads as a glow — the same halo, only
      softer. Pulling the edge in 3px and keeping the feather near 1px removes the
      contaminated ring while the silhouette stays crisp.
      Raise `--erode` if an outline survives; lower it if the edge starts eating
      detail (hair and fingers go first). Judge it on a ZOOMED crop where the
      subject meets the BRIGHTEST part of the background, since that is the only
      place the artefact is visible — against dark background it hides completely.
   4. `feather --id <id> --box <id> --edges "bottom=260"` — dissolves the BOTTOM of
      the subject into the fade. Without it his torso stops on a cut line wherever
      the crop ran out, and the fade then covers a hard edge instead of a soft one.
      On a split box `--edges` targets the cut-out, so this fades the BODY and
      leaves the background layer alone.
      **The distance is measured from where the SUBJECT ends, not the image edge**,
      because a cut-out torso usually stops well above the frame. So the number is
      much smaller than the canvas suggests: ~250-350px, not 600+. If the fade looks
      like it did nothing, check the alpha down the column rather than raising the
      number, since a value larger than the subject's own height just flattens the
      whole ramp.
      Order matters: split, then the halo pass (step 3), then this. `feather`
      rewrites `fgUrl` in place, so re-running it compounds — to retune, re-split
      and redo the sequence rather than layering another pass on top.
      **Prefer the box's own edge fade over baking one.** An image box carries a
      per-edge `fade` that, on a SPLIT box, applies to the cut-out (with `bgFade`
      for the background layer), so the same dissolve is available without touching
      the pixels:
      ```
      set-image-style --id <id> --box <heroBox> --fade "bottom=32"
      ```
      Values are PERCENT of the box dimension, not source pixels, and the ramp runs
      fully faded at the edge to solid at that distance — so `bottom=32` on a 1350
      canvas starts the dissolve around y 918. Being a stored property it is
      re-tunable and reversible, where `feather --edges` compounds and needs a
      re-split to undo. Reach for `feather` only when the dissolve has to be baked
      into the asset itself.
      *Why it matters even when the slide's own fade already covers the crop: with
      no edge fade the garment stays solid right up to where the headline fade
      slams in, and that boundary reads as a cut. Judge it on a zoomed crop of the
      band around the fade floor, where a tile-sized contact sheet shows nothing.*
   Override with `--bg-noise` / `--fg-noise` / `--hard-blur` only for a reason.
   *Why: flat black behind a photo reads as a hole someone forgot to fill.
   Expanding the photo's own scene keeps the colour and light, and blurring only
   the background makes the subject pop instead of flattening the whole frame.*
   Step 1 needs the dev server running (the expand proxies BRIA server-side).

7. **Secondary objects are CUT OUT and floated — never placed as rectangles.**
   A screenshot dropped onto a slide reads as a sticker, and stickers are a hard
   no. `split-image --id <id> --box <id> --drop-bg` removes the background
   entirely (rather than blurring it, which is what a subject wants) so the
   object sits IN the scene, and trims the box onto the object so its bounds
   wrap the content instead of transparent padding.
   *Why: the hero gets expanded + split because it IS the scene; an object has
   no scene of its own, so anything behind it is somebody else's rectangle.*
   If the source carries UI chrome the segmenter counts as its own object (a
   handle chip, a button, a caption bar), `set-crop` it away FIRST — reducing the
   box height by the same fraction, since crop hides pixels at fixed scale. Trim
   intersects an existing crop rather than replacing it, so that survives.

   **A PERSON is never a card.** An album cover, a tweet, a court document or a
   platform screenshot is a rectangle by nature and stays one. A photograph of a
   HUMAN is a subject: cut the background off, drop-shadow it, and tuck it behind
   the hero subject with `set-image-style --behind-subject <heroBoxId>` so the two
   people share one scene. The Tupac post shipped Keffe D's booking photo as a
   rounded rectangle on the reasoning that a mugshot is an artifact like an album
   cover. The user rejected it on sight: *"it is a picture of a human, so why not
   just have him in the image rather than as a sticker."*
   *Why: two faces in one scene reads as a confrontation, which is the story. The
   same two faces with one in a frame reads as a person next to a document.*

   Watch the CUT EDGES on a portrait whose subject fills the source frame. A
   mugshot's shoulders run to the photo border, so `--drop-bg` still leaves a hard
   vertical seam where the shirt was clipped. Push that edge off-canvas and
   dissolve the bottom with `feather --edges "bottom=N"`, remembering N is in
   SOURCE pixels (`N = wanted_canvas_px x source_width / box_width`).

   **Ground the second person the way the hero is grounded, or they float.** A
   drop shadow is not enough on its own. The hero reads as standing in the scene
   because their torso keeps going down and dissolves into the bottom fade. A
   cut-out person scaled to head-and-shoulders stops in mid-air instead, and the
   user's reaction was exactly that: *"why is the second person not like the first
   person. He is floating!!!!!"*

   What actually fixes it is WHERE the dissolve starts, not how long it is. The
   hero's cut edge is never seen because it falls off-canvas entirely. A
   head-and-shoulders source cannot reach the frame bottom at a sane head size, so
   the edge WILL be on canvas and the job is to hide it inside the slide's own
   fade. A long feather starting high (~650 on a 1350 canvas) is the failure mode:
   it begins while the background is still lit, so the garment reads as a scooped
   arc. Push the figure DOWN and UP in scale until the bottom edge sits around
   1050, then use a SHORT feather (~150 canvas px) that only runs inside the
   already-darkening zone.

   Bright clothing is the hard case. A white t-shirt shows a feathered edge that
   dark denim hides completely, so judge the dissolve on a brightness-boosted crop
   of the lower third, never on the normal render where the black flatters it.

   **Head tops align, and a head-and-shoulders source cannot do both jobs at
   once.** Aligning the second person's crown with the hero's while ALSO burying
   their bottom edge in the fade needs more torso than a mugshot contains, so at a
   natural head size you get one or the other. Give the source a longer body
   first, then the geometry is free:
   ```
   extend the source canvas downward, continuing the plain fabric already there
   scale  = current_box_h / current_src_h            # keep apparent head size
   new_h  = extended_src_h * scale
   new_y  = hero_head_top_canvas - src_head_top * scale
   ```
   That put both crowns within 1px and dropped the bottom edge to 1316 on a 1350
   canvas, which is off-frame in practice. Measure the head top from the CUTOUT
   ALPHA (first row with a handful of opaque pixels, so stray feather does not
   count), never from the render by eye.

   Do NOT outpaint a person to get that torso. BRIA's expand invented a striped
   graphic across the flat of a booking-photo t-shirt, which is fabricated
   clothing on a real defendant. Continuing the existing plain fabric and fading
   it to black asserts nothing and is invisible once the fade lands on it.

8. **Err LARGE and HIGH with the secondary object, and ground it.** It should
   command roughly half the frame width and sit level with the subject's face,
   not below it. Overlapping the subject is good — it reads as depth. The only
   hard limits are the safe-zone gutter and never covering the face or hands.
   Ground it with a drop shadow: `set-image-style --shadow
   "blur=40,y=18,opacity=55,color=#000000"`.
   **For a BRAND LOGO, use the monochrome mark, not the coloured app tile.** The
   template speaks white-on-dark — logo, headline, subhead. A brand-colour tile
   is then the only foreign colour in the frame and reads as a sticker sitting on
   top of the photo. The same mark in flat white becomes part of the design.
   Two things follow from dropping the tile, and both are the opposite of the
   advice for a screenshot card:
   - **No edge feather.** There is no card edge to dissolve; grain, ~1px of blur
     and a light shadow do the integrating instead.
   - **Do not tuck it behind the subject.** Hiding the edge of a card is
     invisible, but clipping part of a logo's silhouette just looks broken. Let
     the mark sit clear.
   Wikimedia Commons carries most major AI/tech marks as public domain, and a
   black-on-transparent mark inverts to white cleanly (set RGB to 255, keep alpha).
   *Why: recorded after the object was undersized twice and placed too low once,
   all corrected in the same direction — the instinct is consistently too timid.
   And a cut-out with no shadow levitates, which is the second-order version of
   the sticker problem rule 7 fixes.*
   Keep hierarchy: the object must not out-size the SUBJECT (see rule 4) — if it
   does, grow the subject, don't shrink the object.
   **Then tuck it BEHIND the subject**, always:
   `set-image-style --box <objectBox> --behind-subject <heroSplitBoxId>`. It sits
   in front of the blurred background but behind the cut-out silhouette, so an arm
   or a shoulder crosses in front of it.
   *Why: an object floating flatly beside the subject reads as two stickers on one
   canvas. One overlapping edge is what makes the frame look like a single
   photograph instead of a layout.*
   **But do not bury the evidence.** The object is usually there because it PROVES
   something, so whatever must be read has to clear the silhouette. On the Ken
   Carson hero the first tuck cut the "c" off `cartunez 7.10`, which is the entire
   point of that screenshot; sliding the box right until the text cleared his arm
   kept both the overlap and the proof. Check this on the render, not in your head.
   **Pass width AND height when you resize it.** `move --width` alone keeps the old
   height, so the box silently changes aspect and the image is cropped. Compute the
   height from the source: `height = width / (srcW / srcH)`.
   **Blending it into the scene is a JUDGEMENT CALL, not a default.** When the
   object reads as a rectangle pasted on the slide, dissolve its border and give it
   the slide's grain:
   `feather --box <id> --edges 70` then `set-effects --box <id> --noise 8`.
   **Keep the drop-shadow.** A feathered object still needs grounding, and the
   renderer composites the box through its ALPHA, so the shadow follows the soft
   edge instead of boxing it: `set-image-style --shadow "blur=50,y=18,opacity=55"`.
   (An earlier version of this rule said to remove it, on the assumption that the
   shadow traces the box rect. Tested on the Ken Carson hero: it does not.)
   Corner radius becomes meaningless once the border is feathered, so leave it 0.
   Decide per post. A crisp bordered card is right when the object is evidence the
   reader must scrutinise; a dissolved one is right when it should sit in the scene.
   *Both were tried on the Ken Carson hero: the framed version read as a clean UI
   card, the feathered one as part of the photograph. The second was chosen there,
   and neither is the standing default.*
   **Give a screenshot an edge with `border`.** A screenshot on a near-black slide
   has no boundary of its own and reads as text floating on the background:
   `border --box <id> --width 2 --radius 14 --color "#d8d8d8"`.
   Width and radius are CANVAS pixels; the verb converts to source pixels itself,
   so the stroke looks the same whatever resolution the asset is. It bakes the
   rounding in with the stroke and zeroes the box's `cornerRadius`.
   *Why it must own the rounding: the renderer's `cornerRadius` CLIPS the image, so
   a straight border painted into the pixels gets sliced off at each corner into
   four blunt stubs. One shape, one radius, nothing to clip. The same trap catches
   anything else painted into the pixels — a caption bar, a watermark — because the
   radius does not know it is there.*
   **The recipe that works on a screenshot** (arrived at on the Ken Carson cards,
   then reused unchanged):
   1. **Trim to the real content first.** Screenshots carry bleed — a rounded card
      leaves the page behind it showing at the corners, a repost graphic leaves the
      photo underneath. MEASURE it, do not eyeball: scan inward from each edge for
      where the pixels stop matching the background and trim past that. On one card
      it was 17px of light photo down the right-hand side, invisible until a border
      framed it as though it were part of the artifact.
   2. `border --width 1.5 --radius 14 --pad 24 --color "#555555"`. The pad is what
      makes it look considered: a stroke hard against content that already runs to
      the edge reads as cramped.
   3. **Re-fit the box to the PADDED aspect.** Padding changes the ratio, so the
      old width/height now letterboxes or crops. Compute it:
      `height = width / ((srcW + 2·pad·scale) / (srcH + 2·pad·scale))`.
   4. Size it to fill the image band. A correctly-bordered card floating in 370px
      of dead space still looks wrong.
   `#555555` at 1.5px is the settled weight: it defines the edge without reading as
   a UI widget. Brighter or thicker was rejected twice as "harsh".
   And it is BAKED, so there is no undo — `set-image` the original file and border
   it again to change your mind.
   Feather in SOURCE pixels, not canvas pixels: a 1800px-wide screenshot shown at
   472px needs ~70 source px to read as ~18px of falloff on the slide.
   **The object does not have to go on the RIGHT.** Right of the face is only where
   it happened to land on the posts written so far; it is not the house layout.
   Put it wherever the photograph leaves room — left, low, tucked under the chin,
   overlapping a shoulder. Let the subject's pose and eyeline decide, and keep the
   only hard constraints: inside the safe zone, never covering the face or hands,
   and overlapping the subject somewhere so it sits IN the frame (see the tuck
   above).

9. **The heavy weight goes on the ARTIST and the SUBJECT. Nothing else.**
   In a headline, wrap exactly two things in `**…**`: the artist's name, and the
   thing that is happening ("new album", "sold out", "on trial"). Years, months,
   filler, prepositions and words like "why" or "this" stay plain.
   *Why: the highlight is a recognition device, the typographic twin of rule 4's
   face — a reader scanning a feed should get "who" and "what" from the bold
   alone. Highlighting a year or a generic word spends that signal on something
   nobody is scanning for, and highlighting everything highlights nothing.*
   Break the lines so a highlighted phrase owns its own line. Push orphan
   articles up to the previous line to make that happen: write
   `**Drake** is teasing a\n**new album**\nthis year`, not
   `**Drake** is teasing\na **new album**\nthis year`.

10. **The SUBJECT gets a shadow too, not just objects.** After `split-image`,
    give the hero box a soft silhouette shadow:
    `set-image-style --shadow "blur=60,y=24,opacity=100,color=#000000"`.
    Wider and softer than an object's (rule 8's blur 40 / y 18), but at FULL
    opacity: a large blur spreads the shadow so thin that a half-opacity one
    barely registers against a dark backdrop. The blur does the softening, not
    the opacity.
    *Why: splitting makes a sharp subject sit against its own heavily blurred
    background, and that hard edge reads as pasted even though both halves came
    from one photograph. The shadow re-attaches them.*
    This works because the renderer composites a split box into an offscreen
    buffer so the shadow follows the SILHOUETTE, not the box rectangle — which
    is why it is worth doing even on a full-canvas box whose rect is off-frame.

11. **Run slide text through the humanizer too, not just the caption.**
    Every word a reader sees is subject to it: headline, subheading and the
    supporting paragraph on each slide. Draft, then rewrite against the
    checklist in CAPTIONS.md and ship the rewrite. Mind the hard constraints:
    slide paragraphs render in ALL CAPS inside a fixed 960x200 frame, so keep
    them to roughly 200-250 characters or they overflow, and the facts are fixed.
    *Why: the rule was written for captions first, which left the slides
    unguarded — and the slides are the part people actually read. A paragraph
    that trips the AI-writing patterns undercuts the account whether it sits in
    the caption or on the artwork.*
    The patterns that keep surfacing in slide copy specifically: forced groups of
    three (usually a list of theories), dramatic closing fragments, and "not X
    but Y". Numbers are the antidote — a verified figure never reads as machine
    filler.

12. **Supporting slides: the background belongs to the template. Never touch it.**
    On every slide after the hero, the canvas colour and the faded grunge texture
    come from the template. You may change the TEXT and you may ADD images and
    charts. That is the whole list. Do not add a full-bleed backdrop, recolour
    the canvas, blur, replace or hide the texture, or dress the background in any
    other way.
    *Why: those two layers are what make the supporting slides of every post look
    like one publication. A per-post backdrop looks fine in isolation and obvious
    across a feed, and it quietly turns the template into a suggestion.*
    **This bounds rule 6.** Expand-and-blur is a HERO technique, for the slide
    whose subject IS the scene. It does not travel to supporting slides: the bare
    gutter beside a portrait-shaped image there is intended, not a defect to fill.
    When an image leaves too much gutter, crop the SOURCE tighter so its aspect
    ratio fills the band. Fix the image, never the background.

13. **A supporting slide's text is about the artifact on that slide, and about
    the story the post is actually making.** Adjacent detail stays a clause, not
    the subject. If the text drifts onto a side character, either the text is
    wrong or you put the wrong image on the slide, so check which before you
    rewrite. **Name the artifact in the text.** A slide's paragraph has to read on
    its own: a pronoun whose antecedent lives only in the picture ("Drake posted
    it and has said nothing since") leaves the reader with no subject.
    *Why: recorded after slide 2 of the Drake post ended up showing, and talking
    about, a carousel of his mother, when the post's claim was about the CD case
    he photographed. Both were real Instagram posts of his, and the wrong one was
    picked because it was the better-looking screenshot. Evidence has to be
    evidence FOR the headline.*

14. **Never date-stamp the news itself.** Keep recent absolute dates out of slide
    copy and captions: no "August 21", no "last Friday", no "all weekend". Write
    it so it stays true whenever it is read, using relative framing instead:
    "nine days earlier", "since then", "still no release date".
    *Why: posts go out a few days behind the event, and a date on the news lets
    the reader work out exactly how late we are. Nothing else on the slide gives
    that away, so the date is the only thing that makes the post feel stale.*
    Older dates are fine and often necessary. A July 2025 precedent or a May
    album release is context the reader needs, not a timestamp on our reporting;
    the test is whether the date reveals OUR lag, not whether it is a date.
    Forward-looking recency ("worth watching this week") is fine for the same
    reason: it dates the read, not the report.

15. **Every slide must stand up on its own — but the reader already knows the
    artist.** They are scrolling a feed and did not read slide 1 carefully, so each
    slide has to make sense alone. That is about SENTENCES, not about the subject:
    see "Who this is for". Never introduce the artist, never explain the label.
    What must always be self-contained is the writing itself.
    - Name things in full the first time. "His label" beats "OVO or Republic".
      "Drake's Sonotrade index" beats "his index". An abbreviation the reader has
      to already know is a dead end, not a shortcut.
    - Say what the reader is looking at, even though the picture shows it. "Drake
      posted this photo on his Instagram" is not wasted space: it establishes
      that this is his post and that it is news, which the photo alone does not.
      Slides get screenshotted and shared one at a time.
    - Explain the stake in plain words. "So a fourth this year would be a lot"
      lands; "a fourth project would be unusual for anyone" needs the reader to
      already know how many there have been.
    - **Resolve every pronoun against the PREVIOUS SLIDE, not against your own
      draft.** A slide opening "That is him in 2000" reads perfectly while you are
      writing it, because you have the whole post in your head. The reader's most
      recent referent is whoever the slide BEFORE was about — and on the Dr. Dre
      post the slide before was a Metro Boomin chart, so "him" pointed at the
      wrong producer. Name the subject in full whenever the previous slide was
      about someone else. The same applies to a bare "It" or "This" opening a
      slide: after a chart about one artist, "It has already happened" attaches
      itself to that artist.
      Check it mechanically: read the first sentence of each slide with ONLY the
      previous slide in mind. A multi-artist post fails this constantly, because
      the subject changes every two or three slides.
    *Why: the copy kept getting written for someone already caught up, because
    the person writing it just finished the research and cannot un-know it. The
    reader who doesn't follow the story does not ask a question, they scroll.*
    **The first-sentence test, and it is mechanical.** The opening sentence of
    every slide must name its own subject as a full noun. Not "Drake posted it",
    not "All three arrived in May", not "His index fell" as the first words the
    reader meets. If sentence one leans on the image, the headline, or the
    previous slide to say what it is about, rewrite it before anything else.
    *Why this is a hard test and not a reminder: this rule was already written
    down and got broken twice in a row anyway, once with "it" and once with "all
    three". Being careful does not work, because the writer always knows what the
    subject is. Checking the first noun does work.*
    **Then cold-read, don't reread.** Render the slide and put it in front of a
    reader who KNOWS THE ARTIST BUT NOT THIS STORY, and ask them to explain it
    back. Get that persona right: an earlier cold read was briefed with "you may
    not know who Ken Carson is at all", so it reported not knowing who he was, and
    that fed straight back as pressure to add biography nobody wanted. A miscast
    reader manufactures the wrong defects and you will dutifully fix them.

16. **Don't spend the slide stating what is true by definition.** A teaser has no
    confirmed title, date or release plan. That is what makes it a teaser. Saying
    "his label has not confirmed a title, a date, or even that it is music" tells
    the reader nothing they could not have deduced from the word "teasing", and
    it reads as pedantic where it should read as informed.
    *Why: characters on a slide are scarce, and non-information crowds out the
    thing worth knowing. On the Drake CD-case slide the real content was that the
    photo says music and the caption emoji says film, so the guesses split. That
    only fit once the obvious non-confirmation came out.*
    The useful version of "nothing is confirmed" is always specific: name the
    competing readings, or say who checked and came back with nothing. Bare
    absence is not a fact worth printing.

17. **The chart slide has a job, and "here is a chart" is not it.**
    *(Placement and count are covered under "Slide structure": a chart can sit
    mid-carousel, and a post about two artists can carry two. Everything below
    applies to each chart slide you build.)* A Sonotrade
    chart is the reason the story is on our account rather than any music page,
    so its paragraph has to earn that. Cover three things, in this order:
    1. **Assume the chart itself is understood.** This audience already knows a
       Sonotrade chart, and knows the index tracks trader sentiment. Do not gloss
       it, do not explain what "points" are, do not spend a sentence on "moves
       like a share price". **This is the one exception to rule 15**, and it is
       narrow: it covers the Sonotrade product only. Everything else on the slide
       still gets written for a stranger, the artist and the news included.
    2. **Why it sits where it sits.** Give the shape of the line in numbers, with
       a reference point, so the figure on screen can be judged: what it rose
       from, what it bottomed at, where the window ends.
    **Always turn the chart's animation on**: `set-chart --set animate=true`. The
    slide then exports as a 20 second video with the site's draw-on, dot pulse and
    spark. This is a standing preference, not a per-post choice, so switch it on
    every time you add a chart and never ask.
    Call the people trading on Sonotrade **sonotraders**, never "traders",
    "investors" or "users". It is the house word for our own audience.
    3. **What COULD HAPPEN to the chart, given the news.** Describe possible
       outcomes for the line, not the mechanism that drives it. "A real album out
       of the tease could send it on another run like that" is right. "A
       confirmed release is the next thing that could move it" is wrong: it
       asserts what moves the market rather than what the chart might do. Hedge
       it ("could"). Give the upside only: a bearish branch was tried once ("a
       tease that goes quiet could hand the week back") and cut, because a slide
       that ends on the number going down is a bad note to leave a reader on.
    4. **Close on a question to the reader.** The last slide ends by handing the
       argument over: "When do you think he will drop this album?". Ask about the
       story, not about the chart, and keep it to one short line.
    **Keep the sentences short, one idea each.** This paragraph is dense by
    nature, so long compound sentences make it unreadable: "Sonotraders have moved
    Drake's index from 46.48 to 47.10 points over the past week, with the CD case
    landing at the end of that run" was rejected for exactly that, and split into
    two plain sentences. Rule 15 is about jargon; this is about sentence length,
    and a chart slide can fail on either.
    All three must connect to THIS post's news. A chart paragraph that would work
    unchanged on any other artist's slide has not done its job.
    **Two charts need two readings.** If a post carries a chart for each of two
    artists, each slide gets its own numbers and its own "what could happen" —
    naming the second artist and reusing the first one's argument is the fastest
    way to prove nobody looked at the second line.
    *Why: the chart is the only slide that is ours rather than the story's, and it
    kept getting written as a caption for a picture of a line. A reader who has
    just been told a rumour wants to know what the rumour is worth, and that is
    exactly what this slide can answer and nothing else in the carousel can.*
    **Never let the window reach into the dead zone.** The index backend was OFF
    from **2026-06-13 to 2026-07-28**. No points exist for those 45 days, and the
    renderer joins the two surviving points with a single straight segment. It
    looks exactly like an artist whose sentiment held perfectly steady, and it is
    not: it is missing data. Describe it and you have published a false claim
    about the market, which is how a slide came to say an index "sat flat through
    the Cartunez wait" when in truth nobody was measuring.
    There is a SECOND, shorter hole running to **2026-08-03**, so the first fully
    clean day is 08-03, not 07-28. Start there:
    `set-chart --box <id> --from 2026-08-03`. `--from`/`--to` take any ISO date and
    outrank `period`, which is why they exist: no fixed period can begin after an
    outage. See CLI.md, "Chart windows".
    `add-chart` prints `dataGaps` and a warning whenever the chosen window contains
    a hole longer than three days. Treat it as a blocker: move `--from` past the
    gap. Do not write around the flat stretch and do not explain it on the slide.
    The rolling periods heal as the outage recedes, but check the warning rather
    than the calendar, since the gap is measured from the data.
    *Related renderer fix (2026-08-25): a window pinned just after a gap used to
    draw a phantom vertical rise at its left edge, because the line was seeded with
    the last price BEFORE the cutoff. That also poisoned the header percentage,
    turning a 10.8% weekly decline into a green 6.9% gain. Fixed in chart.ts. If
    you meet an older post with a cliff at the very start of the window, that is
    the cause, and its slide text is probably wrong too.*
    **Re-read the numbers off the header after every re-snapshot.** `add-chart`
    and `set-chart --artist` pull live data, so the figure you wrote yesterday
    can disagree with the header rendered above it today. Query the box's own
    `data` for the low and the latest value rather than trusting your draft: this
    slide shipped once saying 47.08 under a header reading 47.10.
    Do not invent causation. "Climbed while the CD case spread online" is honest;
    "climbed because of the tease" is a claim about a market you cannot source.
    And do not generalise from one line: "hype usually moves the number" was cut
    from an earlier build because a single artist over three months cannot show a
    pattern, and a reader noticed unprompted.

18. **Tune the hero's fade reach to the image; never ship the default.** The
    bottom fade's `reach` controls how far up the darkness climbs before the
    headline. Left at the template default it swallows the lower half of the
    subject and the picture stops earning its place.
    There is NO correct number. On the Ken Carson hero the default 28 was far too
    much and 8 was right; a different photo will want something else entirely.
    Set it, render, and look at how much of the subject survives.
    *Why: the fade exists to make the headline legible, not to hide the image. If
    the fade reaches so far that the reader cannot see what the photo shows, the
    slide is carrying a headline over a dark rectangle.*
    Note that `reach` moves the safe zone: `inspect` recomputes `fadeFloor` and the
    zone bottom from it, so re-read the zone after changing it rather than reusing
    the numbers from before.

19. **Meme slides: use the fanbase's own joke, and make it carry a fact.**
    A meme slide is one image centred in the image band with a SHORT line under
    it, and nothing else. No chart, no second image, no analytical paragraph.
    Look at the references before building one: the Drake post's "how Drake gonna
    be feeling after dropping 4 albums in one year", and the Lil Durk post at
    positions 2 and 4 ("this is starting to hit harder now" over an Apple Music
    lyric screenshot, "it's time to make a call" over a courtroom photo).

    **Source it from the replies, not from a meme site.** The jokes that belong
    in a post are the ones the fanbase actually made about THIS story. They live
    in the replies to the big aggregator post everyone reacted to:

        research.ts memes "<topic>" --min-faves 300 --sheet cand.png   → find the news posts
        research.ts memes --replies <statusId> --sheet cand.png        → mine the reactions

    Top-level search returns news graphics, so it is only useful for finding the
    post whose replies you actually want. `--replies` returns the reaction images
    themselves. Add `--video` for clips: it returns a real mp4, which slides
    already accept.

    For a GENERIC emotional beat rather than a joke about the news, there is a
    keyless Reddit path: `--reddit "<mood>" [--fetch dir/]`. Use it only when the
    slide wants a mood, because Reddit cannot know about a story from last week.
    There is no third option worth chasing: Tenor stopped issuing API keys in
    January 2026, and Giphy's terms prohibit downloading its media and reposting
    it commercially (it also requires per-item attribution an Instagram slide
    cannot carry). Do not spend a session rediscovering this.

    **You MUST look at the contact sheet.** A meme reply's text is just "@handle"
    — the image is the whole post, so the JSON tells you nothing about what you
    are about to publish. `--sheet` tiles the candidates into one numbered PNG for
    exactly this. Reply memes are unvetted: the first real run returned a racial
    slur at [2] and profanity at [6] out of ten candidates. Rejecting those is
    the job, not an edge case.

    **The line under it must be true and specific**, which is what separates this
    from filler. On the Ken Carson meme the joke was "thanks Ken for another
    Friday without CARTUNEZ", and it turned out every date he had set (July 10,
    July 31, August 21) was in fact a Friday, so the line reads "All three dates
    he set were Fridays. His fanbase has started counting them." The meme stops
    being a gag and becomes evidence of how the fanbase is reading the delays.
    If you cannot find a true line, the meme does not belong in the post.

    **Interleave, do not cluster.** Both reference posts place memes BETWEEN
    evidence slides, never in a block at the end. The meme is a tonal break that
    also happens to be bright, which gives the reader contrast in the middle of a
    run of dark screenshot cards.

    A white-background meme is a screenshot card like any other, so it gets the
    same treatment (rule 8): `border --width 2 --color "#d0d0d0" --radius 18
    --pad 20`, then refit the box to the PADDED aspect or it letterboxes.

    The caption still follows CAPTIONS.md in full — 1,500-2,000 characters going
    deep on the reaction itself. The short line is the SLIDE text; it is not the
    caption.
    *Why source from replies: a meme pulled from a generator is about the topic;
    a meme pulled from the replies IS the story, because "how the fanbase is
    taking it" is the thing the slide is reporting.*


20. **Do NOT write captions until the user gives the green light.**
    Build the slides, render them, show them, and STOP. Captions come after the
    user has signed off on the slides, not before, and not in the same pass.
    *Why: the user reads the rendered slides and often has changes — a beat gets
    cut, two slides get merged, an image gets swapped, the text on a slide gets
    rewritten. Every one of those edits invalidates the caption written against
    the old slide, because each caption goes DEEP on its own slide's subject
    (CAPTIONS.md). Writing them early means writing them twice, and the wasted
    pass is not cheap: a full set is seven or eight captions at 1,500-2,000
    characters each.*
    This does not lower the caption bar. When the green light comes, every slide
    still gets the full CAPTIONS.md contract. It only changes WHEN.


21. **Balance the PAIR, not the subject alone.** When a hero carries a secondary
    element, the combined centre of the primary subject and the secondary element
    should land near the middle of the canvas (x≈540 on the 1080 grid).
    **Measure the primary from the FACE, not the whole body.** The subject's
    anchor is the vertical centre line of his face — not the centre of his torso,
    his silhouette, or the bounding box of the cut-out. A seated or angled subject
    can have a body mass centred 100px away from where the face sits, and the face
    is what the eye actually weighs, so balancing to the body puts the composition
    off even when the arithmetic says it is centred.
    Judge it by eye on the render, not from the box numbers: a face centred at
    450 with a logo centred at 755 has a combined centre around 600, which reads
    as visibly lopsided even though each element on its own looks fine.
    The fix is usually to move BOTH — shift the subject off-centre one way and the
    secondary the other, rather than nudging only the thing you just added.
    *Why: a hero is one composition, not a portrait with a sticker on it. Placing
    the secondary in whatever empty space the photo happens to leave is what
    pushes the weight to one side, and the reader feels the imbalance before they
    read anything.*

    **Tuck the EDGE, not the element.** Only a sliver of the secondary should sit
    behind the subject — enough that the two overlap and read as one composition.
    Once the subject is covering a third of it, the tuck stops looking like depth
    and starts looking like the element is hiding. This pulls against the balance
    rule above (moving the secondary outward to show more of it pushes the pair's
    centre outward too), so expect to trade: shift the subject to recover the
    balance rather than burying the secondary to get it.

    **If the photo's own furniture fights the secondary element, change the
    photo.** A mic stand, a hand or a prop cutting through the space where the
    secondary needs to sit is not something to work around — there is no inpaint
    tool here, and cropping it out moves the subject. Source a different frame of
    the same artist with clean space on one side. Choosing the hero image is part
    of designing the layout, not a step that happens before it.


22. **Screenshot the ORIGINAL source, never the aggregator that reposted it.**
    Rank what you capture, and go as high up this list as you can reach:
    1. The artist's own post, filing, or the publication that ran the interview.
    2. The outlet that reported it first, with its masthead visible.
    3. A real outlet's write-up of that reporting.
    4. An aggregator repost (Kurrco, NFR, big_business_ and the like) — LAST
       RESORT, and only when nothing above is obtainable.
    Aggregator accounts are how you FIND a story and how you measure its reach.
    They are not evidence of it. The Dr. Dre post shipped a Kurrco screenshot
    whose own text read "(via Variety)", which made the slide a screenshot of a
    repost of a report of an interview — three steps from the source, and it
    looked it.
    *Why: the artifact slide is the post's proof. An aggregator screenshot proves
    only that an aggregator posted something, and it borrows that account's
    credibility instead of the source's. A masthead does the opposite.*

    Paywalls and bot-walls will block the top of the list (NYT 403s the headless
    browser and had no usable Wayback snapshot), so expect to settle for tier 2.
    Settle DOWNWARD deliberately, and say in your summary which tier you landed on.

    Cookie/consent walls grey out or cover the article on most news sites and
    silently ruin the capture. `capture.ts --click 'button:has-text("I Accept")'`
    dismisses them first; pass several selectors separated by `|` and the first
    one present is clicked.


23. **If the artifact IS a video, use the video — never a screenshot of it.**
    Video slides hold attention better than stills, so a still of a video player
    throws away the whole advantage and keeps none of the evidence. The Napster
    slide shipped a screenshot of a post whose embedded video was the actual
    proof; fetching the file turned a fan's screenshot into archival footage of
    Dre making the argument himself.

    The path, end to end:
    ```bash
    research.ts memes "<topic>" --video          # mp4 URL, highest-bitrate variant
    ffmpeg -i in.mp4 -vf cropdetect -frames:v 200 -f null -   # find baked-in letterbox
    ffmpeg -i in.mp4 -vf "crop=W:H:X:Y" -c:v libx264 -crf 20 -c:a copy out.mp4
    canvas.ts add-image --image out.mp4          # slides accept mp4 directly
    canvas.ts poster --id <id> --box <box> --at 0.35   # still frame so PNG renders work
    ```

    **Transcribe before you write the slide text.** `whisper-ctranslate2` is
    installed. Never describe what someone says in a clip you have not
    transcribed — the Napster footage turned out to contain a far better line
    than the one that was going to be paraphrased onto the slide.

    **Crop the letterbox.** Reposted clips usually carry baked-in black bars;
    `cropdetect` finds them in one pass. Then refit the box to the CROPPED
    aspect, or it letterboxes a second time.

    X marks whether the uploader permits downloads (`allowDownload` in the memes
    output). It is not a licence, but it is the only signal of their intent in
    the payload, so check it and prefer clips where it is true.


24. **One idea per slide, in short sentences. Split rather than compress.**
    The failure is not slide count, it is a paragraph carrying two beats at once
    with a long subordinate clause welding them together. A reader on a feed
    parses one thought per swipe. Tests that catch it:
    - Can you name the slide's single claim in five words? If it takes "and",
      it is two slides.
    - Is any sentence over ~140 characters? Break it.
    - Read it cold, as someone who does not follow this story. Anything needing a
      re-read is too packed.

    Real examples from this post, both split in two:
    - Timbaland's slide carried *what he built* AND *how his peers reacted*.
    - The Metro slide carried *the beat was AI* AND *nobody knew, then the labels
      sued*.
    Each half became a slide with its own artifact and got clearer, not longer.
    A slide that gets split needs its OWN image — if you cannot source a second
    artifact, simplify the language instead of splitting.
    *Why: dense justified blocks read as competent to the person who wrote them,
    because that person already knows the story. To everyone else they are a wall
    that has to be decoded, and the swipe is cheaper than the decoding.*

    **No writerly connectives.** "The name was Timbaland", "Enter the machines",
    "And then it happened" — openers that perform a reveal instead of stating the
    fact. Lead with the fact: "Timbaland started an AI record label last year."
    The story is doing the work; the sentence does not need to help it along.

    **The subheadline is a plain sentence, not a clipped fragment.** Parallel
    two-part constructions read as trying too hard: "His album, Don Toliver's
    stage", "Three songs, at somebody else's show", "His city, his album,
    somebody else's stage". The user's verdict on a whole set of them was that
    the short ones "sound really wierd and verbose", and picked the longest
    option on the list instead: "Don Toliver brought him out at his own sold-out
    show."
    *Why: a clipped fragment makes the reader assemble the meaning themselves, so
    it FEELS longer than a plain sentence carrying more words. Brevity in
    characters is not brevity in effort.* State who did what. Around 50 characters
    fits the subhead box on one line, so there is room for a real sentence.


25. **Trace a claim to its origin before a slide states it. Repetition is not
    corroboration.**
    When "everybody is saying" something, find the FIRST post that said it and
    read what it actually cites. Count the hops. If every citation loops back to
    one account that cited nobody, the claim has one source, not a hundred, and
    the post cannot state it as fact.

    The Yeat/"Eaters" post is the worked example. The story everywhere was that a
    featured artist gave Young Thug an ultimatum, and that the artist was Travis
    Scott. Tracing it:
    - Two fan accounts reported the bare removal first, with NO motive attached.
    - 70 minutes later an aggregator posted the ultimatum. Not a reply, not a
      quote-tweet, no link, no "sources tell me", no artist named. Its two
      attached images showed the current credits and an unrelated portrait, so
      they documented the outcome and not the claim. A reply asking "Source?"
      went unanswered.
    - 13 minutes 47 seconds after that, a 20k-follower fan account was the first
      to name Travis Scott, hedged "allegedly", attaching a screenshot of the
      aggregator's own unnamed-artist post as its only backing.
    So the ultimatum had one unsourced origin, and the NAME everyone repeated was
    invented one hop downstream of it.

    **Tracing it does not mean dropping it.** The user's call, and it was the right
    one: a claim this widely circulated IS the story, and omitting it leaves the
    post unable to answer the question every reader has. Do not over-correct into
    silence. The rule is about HOW it goes on the slide:
    - State the claim as a claim. "One explanation is going around", not "Yeat was
      cut because...".
    - Never assert the fabricated detail. "Fans think it was Travis Scott" is
      reporting on the discourse and is true. "Travis Scott gave the ultimatum"
      is repeating an invention.
    - **Keep the provenance OFF the slide.** The research decides what you may
      SAY. It is not itself content. A draft here read "It came from a single
      post that named nobody and cited nobody" and the user cut it: *"I don't
      care where it came from."* They are right. The audience came for the story,
      not for a media-literacy lesson about it, and an audit trail on the slide
      makes the post sound like it is arguing with the internet instead of
      telling them what happened.
      The hedge alone carries the honesty, in three words at the front: "One
      explanation is going around", "Fans think it was". That attributes the
      claim without spending a sentence on sourcing.
    - Do NOT put the aggregator on the slide, even when it IS the origin. Rule 22
      holds here too, and "show the original source" has no answer when the
      original source IS the aggregator, so show the claim's CIRCULATION instead.
      A large forum thread is usually the best artifact available: it proves the
      claim is everywhere, and the crowd normally hedges it themselves. For this
      story the r/hiphopheads thread was titled with the claim, flaired
      "Allegedly", and its top comment was fans reasoning their way to Travis
      Scott off the JACKBOYS 2 precedent. The hedge is IN the picture, which is
      why the copy no longer has to spend a line on it.
      *Why: a slide endorses whatever is on it. Reproducing an aggregator's
      branded card hands them the credibility the slide is questioning, and
      advertises them while doing it.*
    Apply the same hedge consistently. Carrying one unconfirmed theory with a
    hedge while refusing another is not rigour, it is inconsistency.

    Alongside it, say what the platforms themselves showed.
    Checks that are cheap and worth running every time:
    - Sort the claim's mentions oldest-first and read the earliest one.
    - Ask what the attached images actually prove. Usually it is the outcome,
      which is not the claim.
    - Check whether any outlet did its OWN reporting or just wrote up the post.
    - Diff the primary sources yourself. Spotify vs Apple Music vs Genius vs the
      Wikipedia revision history disagree constantly, and the disagreement is
      often the real story.
    *Why: the user's note was "false negatives and false positives are dangerous
    like that". A fabricated detail repeated by a thousand accounts still reads
    as consensus, and a post that repeats it inherits the fabrication while
    looking well sourced. Volume is a measure of reach, never of truth.*

    A corollary, learned the same turn: **derive dates, do not inherit them.**
    The headline said "four days after it dropped" because an early note carried
    the wrong release Friday. Spotify's own `releaseDate` field settled it at
    2026-08-28, and Friday to Monday is three days. Any interval in a headline
    should be recomputed from a primary date field before the post ships.

26. **Measure the hero source's sharpness before you build on it, and restore it
    if it is soft.**
    A big pixel count is not resolution. The Tupac hero came off a news CDN at
    3072x2022 and still shipped soft enough that the user's first note was "the
    hero image is low quality". The check takes seconds: crop the FACE at 1:1 from
    the source and compute laplacian variance, then compare it against another
    image on the same slide. Tupac's face scored 18.5 against the booking photo's
    168.4 on the same 500x500 crop, so the softness was in the file, not the crop.

    When no sharper original exists (Wikimedia had only passport photos and
    impersonators), restore rather than settle:
    ```bash
    # BRIA super-resolution — field is "image", NOT "file"
    curl -s -X POST https://engine.prod.bria-api.com/v2/image/edit/increase_resolution \
      -H "api_token: $BRIA_API_TOKEN" -H "Content-Type: application/json" \
      -d "{\"image\":\"<base64>\",\"desired_increase\":2,\"sync\":true}"
    ```
    That took the same face from 18.5 to 228.7. Two things to do after:
    - LOOK at it against the original before shipping. Super-resolution
      reconstructs detail, and on a real person that has to preserve the likeness.
      Check the eyes, the expression and any patterned fabric.
    - It invents streaks in large low-detail areas (a plain vest, a flat wall).
      Blend on a vertical gradient: fully restored across the face, fully original
      by the body, which the fade is swallowing anyway.
    *Why: the sharpening is only wanted where the eye actually rests. Applying it
    to the whole frame trades a soft photo for a streaky one.*


27. **Faces must be BIG. The hero's primary head is 26-32% of canvas height.**
    On a 1350-tall canvas that is 350-430px from crown to chin. Anything near 20%
    reads as a wide shot of a stage rather than a portrait, and the post loses the
    thing a face is there to do.

    The band was bracketed against real feedback, in both directions. The
    Drake/Don Toliver hero first shipped at 21% and the note was "I want the faces
    to be bigger aka zoom in more". Rebuilt at 37% the note was "now its too big".
    27% was the one that landed. Render the candidates side by side and let the
    user pick the number rather than arguing it in the abstract.

    - PRIMARY face: 26-32% of canvas height. Target 27%.
    - SECOND person: at least 75% of the primary's head height, so they read as
      standing at the same distance. Below that they look like they are in a
      different room.
    - The UPPER end depends on how much body the source carries. Two tight
      head-and-shoulders crops with no body clutter (the Tupac hero, both figures
      ~39%) hold together far past this band, because scaling those adds face and
      nothing else. A full-length stage photo does not: scaling it up drags
      torsos, arms and a mic into frame with the face, and the slide reads
      crowded long before the head is large. Judge the crowding, not just the
      percentage.
    - The source photo almost never needs replacing. Scale the BOX up past the
      canvas and let the body run off frame; that is what "zoom in" means here.

    **How to measure it, since automation fails.** Detecting the neck from the
    cut-out's width profile does not survive hoods, braids, glasses, a raised mic
    arm or a puffer jacket, and it silently returns numbers that are 2x wrong.
    Render the slide, composite a horizontal pixel grid over it, and read the
    crown and chin off the image:
    ```
    every 50px, labelled every 200px, over the 1080x1350 render
    headHeightPct = (chinY - crownY) / 1350 * 100
    ```

    Zooming breaks the other hero constraints, so re-derive them in this order:
    scale first, then head-top, then pair centre. Work in FRACTIONS of the source
    so the box can grow past the canvas:
    ```
    x = targetFaceCentreX - faceCentreFrac * newWidth
    y = targetHeadTopY    - headTopFrac    * newHeight
    ```
    Then re-check that the box still covers the canvas horizontally (rule 6) and
    that both crowns still line up (rule 7).

28. **If the post is about live shows, the hero is a PERFORMANCE photo.**
    Rule 4 says the hero is a face. This narrows it: when the story is a tour, a
    date announcement or a concert, the face has to be on a stage. A red-carpet
    or press-line portrait can be sharper, larger and better lit and still be the
    wrong picture, because it does not show the thing the post is about.
    *Why: the first hero on the Ye tour-dates post was a press shot of him in a
    black tee, chosen because it was the only recent image with a big sharp face.
    The user's note was "maybe one of him performing as that will be more relevant
    to the post". Relevance beat resolution.*

    Two things this costs you, both worth paying:
    - **Tour photography is wide.** Most published shots of a stadium show are the
      STAGE, with the artist a 30px silhouette on it — beautiful, and useless as a
      hero. Judge candidates on the FACE, not the spectacle: mock the crops into
      the 1080x1350 frame with the headline and the secondary element in place and
      pick from that, because a photo that looks great full-bleed can put the face
      at 100px once it is cropped to the canvas.
    - **Do not blur the performance out of the photo.** Rule 6's `--blur 34` turns
      pyro, lights and crowd into brown mud, which deletes exactly what made it a
      concert picture. On a live hero drop to ~20: the subject still separates and
      the fire still reads as fire. Check the render, not the number.

    **Measure the SOURCE FACE in pixels before you build anything on it, and do
    not try to rescue a soft one.** This is the expensive lesson of the build: two
    heroes were made, shown and rejected as "his face looks weird" and "not crisp"
    before the real constraint was named. A hero face wants ~250-350px on the 1080
    canvas, so the source face must be at least that WIDE ALREADY. Restoration
    adds acuity to detail that is present; it cannot invent a face that was never
    resolved, and pushed hard enough it invents skin instead, which is what "looks
    weird" meant. Crop the face 1:1 and take its laplacian variance (rule 26)
    BEFORE composing. On this build: New Orleans 33, red-suit-on-the-globe 273,
    and the frame that finally worked 1108. Below ~200 the answer is a different
    photograph, not a bigger upscale.

    That number, not the megapixel count, is what to search on. A 5712px stadium
    shot whose subject is a 30px silhouette is worthless here; a 3500px frame with
    a 300px face is the win. Concert photography splits cleanly: dark-venue shots
    are soft at any resolution (long lens, high ISO), while a WELL-LIT stage —
    daytime, a bright LED wall behind him, a festival — gives a face sharp enough
    to crop to. Search for the lighting, not just the event.

    When the source is genuinely sharp, prefer a crop WIDER than the canvas and
    downscale into it. A 1600px crop landing in 1080 is crisp for free; anything
    upscaled past ~1.3x is where the trouble starts. Restore only a source that is
    already sharp, judged at canvas scale rather than zoomed.


## Stability — read this before adding anything below

**The absence of a rule is not a gap. Do not invent rules to seem thorough. Do
not refactor templates, docs, or working posts unprompted. House style changes
only when the user says it changes.**

This section outranks the one below it. Record what you were actually told; never
generate rules by inference. A short list people read beats a long list they
skip.

## Recording new feedback (do this immediately, not at the end)

When the user gives guidance on a post — a correction, a preference, a "do it
like this next time" — append it here as a numbered rule WITH its reason, in the
same turn, then commit. Deferring loses it: the next agent starts with no
context and only this file to go on. If the rule is mechanically checkable
(lengths, bans, geometry), also say so, so it can graduate into a CLI check the
way the caption rules did.

## Before you call it done

1. `render --id <postId> --all` and **actually look at every slide**.
2. Check: nothing overlapping, no empty dead space, text inside its frame, image
   not stretched, chart legible.
2b. Cold-read every slide (rule 15): would a stranger who has read nothing else
   understand this one on its own? Names spelled out, no unexplained jargon.
3. `inspect --id <postId> --kind post` — confirm every slide has the elements you
   think it has. Captions are NOT part of this pass: rule 20 holds them until the
   user has approved the slides.
4. Report to the user: what you built, the sources you used, and anything you
   could not verify.
