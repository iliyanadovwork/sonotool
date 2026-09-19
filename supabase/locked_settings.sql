-- Slide-level template locks: names of slide-wide SETTINGS a POST may not change
-- (e.g. canvasColor, showFade, fadeIntensity). Element-level locks live inside the
-- text/image box JSONB as `lockedProps` and need no schema change.
-- Applied to prod 2026-08-21 (migration add_locked_settings_to_editor_slides).
alter table template_editor_slides      add column if not exists locked_settings text[];
alter table template_editor_post_slides add column if not exists locked_settings text[];

-- (2026-08-21, later) Per-post media tray + fade floor anchor:
alter table template_editor_posts add column if not exists tray_urls text[] not null default '{}';
alter table template_editor_slides      add column if not exists fade_floor_anchor text;
alter table template_editor_post_slides add column if not exists fade_floor_anchor text;

-- (2026-08-22) Designated Instagram caption per POST (CLI `set-caption`; the publish
-- dialog pre-fills from it). Hard cap 2199 chars — one under Instagram's 2200.
-- Applied to prod as migration add_caption_to_editor_posts.
alter table template_editor_posts
  add column if not exists caption text
  constraint posts_caption_max_2199 check (char_length(caption) <= 2199);

-- (2026-08-22, later) Captions moved PER SLIDE — slide 1 (position 0) is the one that
-- publishes; the rest are per-slide notes/alternates. Templates carry defaults that
-- clone into posts. The posts.caption column above is now a legacy read fallback.
-- Applied to prod as migration slide_level_captions.
alter table template_editor_slides      add column if not exists caption text;
alter table template_editor_post_slides add column if not exists caption text;
-- The length caps (the template-slides one landed later, as migration
-- add_template_slides_caption_length_check — slide_level_captions only capped posts):
alter table template_editor_post_slides
  add constraint post_slides_caption_max_2199 check (caption is null or char_length(caption) <= 2199);
alter table template_editor_slides
  add constraint slides_caption_max_2199      check (caption is null or char_length(caption) <= 2199);
