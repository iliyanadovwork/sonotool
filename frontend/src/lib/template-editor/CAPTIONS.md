# Caption rules — the contract for `set-caption`

Rules for ANY agent (AI or human) writing post captions through the canvas CLI.
Read this BEFORE composing; after every `set-caption` the CLI echoes a checklist
reminder plus measured facts about what you just wrote — verify against this
document and rewrite if any rule is broken.

## Before you write anything: wait for the green light

**Do not write post captions until the user has approved the slides.** Build and
render the slides, show them, and stop. See POSTS.md rule 20.
*Why it lives here too: this is the document you open when you are about to
write a caption, which is exactly the moment the gate has to stop you.*

## Per-slide semantics

Captions live **per slide** (`SlideRow.caption`, max 2,199 chars, DB-enforced).

**Every slide's caption follows every rule in this document in full.** There is
no relaxed tier. A slide gets exported and posted on its own, and when it does it
is a whole post, so a thin caption on slide 4 is a thin post.

- **Slide 1 (position 0) is the caption that publishes** when the carousel goes
  out as one post, so it is the GENERAL one: it carries the whole story end to
  end and has the broadest keyword coverage.
- **Slides 2+ each go DEEP on their own slide's subject.** The slide showing the
  artifact gets the caption about the artifact; the chart slide gets the market
  read. Same length window, same hook rule, same keyword count. They are not
  summaries of the post, and they are not trimmed versions of slide 1.
  *Why: written as afterthoughts they were 200-400 characters of recap, which
  wastes the one thing a standalone slide has, namely a reader who is looking at
  exactly that image and nothing else.*
- `set-caption --id <postId> --slide <slideId>` targets a specific slide;
  omitting `--slide` targets slide 1 (the publish caption).

## Structure

1. **Hook inside the first 125 characters.** Instagram truncates the caption in
   the feed at ~125 chars; everything after is behind the "more" tap. The first
   sentence must land inside that window and must earn the tap: open with the
   single most surprising, concrete thing — a number, a tension, a consequence.
   Never open with a generic scene-setter ("In the world of…", "In recent
   years…", "It's no secret that…"), never with a question, and never by flatly
   naming the subject.
2. **Micro-blog body.** Short paragraphs of 2–4 sentences separated by blank
   lines — not two walls of text. Front-load: the most important sentence of
   each paragraph comes first.
3. **Earn the save.** The reader should finish knowing something they didn't —
   context, numbers, what changed, what happens next. If a paragraph could be
   deleted without losing information, delete it.

## Search keywords (the reach strategy)

Reach comes from the caption text, not hashtags: Instagram indexes the words and
serves the post to people searching them.

- Weave **15–20 specific search phrases** a real person would type into the
  Instagram search bar. Prefer precise multi-word phrases over generic nouns.
- Every phrase must sit inside a sentence where it reads naturally. Never list
  keywords, never repeat one more than twice, never bend a sentence around one.
  If a phrase won't fit naturally, drop it.

## Length

- **Every slide: aim 1,500–2,000 characters.** Hard cap 2,199 (one under
  Instagram's 2,200; the DB constraint rejects more).

## Banned — never in any caption

- **Emojis** (any).
- **Hashtags** — no `#tags`, and especially no trailing hashtag block; the
  keyword weaving above replaces them.
- **@handles.**
- **URLs or domain names** ("sonotrade.io", "link in bio" targets — nothing
  shaped like `word.tld`).
- **Citation markers** — `[1]`, `[wikipedia.org]`, "according to <domain>".
- **Promo CTAs** — "follow us", "link in bio", "like and share", "tag a
  friend", "turn on notifications", "swipe up".

**One exception, and only one: the END SLIDE.** That slide IS the closing card —
it already says "Follow Sonotrade" and shows the domain — so its caption may name
`sonotrade.io` and may invite the reader in. The CLI's checker still flags the
domain as `url/domain`; on the end slide that flag is expected, not a failure.
Keep it dignified: explain what the product actually is and let that do the
selling. No "link in bio", no hype, still no emojis or hashtags.
*Why the exception is narrow: the ban exists because a CTA in the PUBLISHING
caption (slide 1) reads as spam and costs reach. The end slide is the one place
where promotion is the slide's whole job.*
The template carries an end-slide caption as a STARTING POINT. It is copied into
every new post (autofill) and is NOT locked, so **paraphrase it for every post,
in the same pass as the other captions.** Keep what it promises identical (what
Sonotrade is, that trading is simulated, the domain) and change how it is said:
reorder the beats, vary the opening, and where it fits naturally, tie the pitch
to the artist this post is about.
*Why: an identical closing caption on every post reads as boilerplate to anyone
who follows the account, and verbatim text repeated across posts is exactly what
a feed ranks down. The promise is fixed; the wording is not.* This replaces the
old "filled = locked" contract, which shipped the same paragraph every time.
- **Recent absolute dates.** No "August 21", no "last Friday", no "this
  weekend". Posts go out days behind the event and a date tells the reader
  exactly how late we are. Use relative framing: "nine days earlier", "over the
  past week", "ever since". OLDER dates are context the reader needs and are
  fine: "back in May", "in July 2025". The test is whether the date reveals OUR
  lag. This mirrors POSTS.md rule 14, which governs the same thing on slide copy.
- **Fabricated specifics.** Every number, date, name, and quote must be real.
  A shorter honest caption beats a longer confident wrong one.

## Voice

Write like a person who knows the subject cold: plain sentences, concrete nouns,
no marketing vocabulary ("game-changer", "dive in", "elevate"), no throat-
clearing. Read it aloud in your head — if nobody would say a sentence out loud,
rewrite it.

## Run it through the humanizer before you write it

*Not only captions: POSTS.md house rule 11 applies the same requirement to every
line of visible slide copy — headline, subheading, supporting paragraph.*

**Required.** After drafting, rewrite the caption against the checklist below
and ship the rewrite, not the draft. It is drawn from the 35 patterns in
Wikipedia's "Signs of AI writing" — the ones that keep showing up here are:

- formulaic sayings ("the silence is the campaign", "X is the Y of Z")
- forced groups of three, especially when all three sentences open the same way
- dramatic one-line fragments used as punchlines
- "not X but Y" constructions
- announcing the next point ("what makes it strange is", "the detail people miss")
- inflated significance ("the most deliberate campaign since...")
- em and en dashes (use commas, colons or parentheses instead)

Tell the skill the hard constraints when you invoke it (facts fixed, hook under
125 chars, 1500-2000 total, no emojis or hashtags), because a rewrite that fixes
the prose and breaks the length or the hook is not usable.

*Why this is required and not advisory: a caption that reads as machine-written
undercuts the account whatever the reach strategy says. The first draft of the
Drake caption tripped at least eight of the 35 patterns, and none of them were
visible without checking against the list.*

## Self-check before you're done

After `set-caption`, the CLI prints measured facts (length, first-sentence
chars, detected emojis/hashtags/URLs/citations). Confirm:

- [ ] first sentence ≤ 125 chars and actually hooks
- [ ] length in 1,500–2,000, on EVERY slide
- [ ] no recent absolute date anywhere
- [ ] zero detected emojis / hashtags / handles / URLs / citation markers
- [ ] 15–20 search phrases woven in, all reading naturally
- [ ] paragraphs short, blank-line separated, front-loaded
- [ ] every fact checkable
- [ ] run through the `humanizer` skill, and the rewrite is what you wrote

If any box fails, rewrite and run `set-caption` again — it overwrites cleanly.
