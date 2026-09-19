-- Layers-panel state for the settings fade, so it behaves like every other layer.
--   fade_hidden: the eye toggle (hide the fade without changing its on/reach values)
--   fade_locked: pin the fade's stack position (a locked fade can't be reordered)
-- Element hide/lock already persist (they live inside the text_boxes/image_boxes JSON);
-- the fade's live in their own settings, so they need their own columns.
--
-- Nullable: existing rows stay NULL -> treated as not hidden / not locked.
-- Safe to run more than once (idempotent).
-- Run in: Supabase Dashboard -> SQL Editor (run once per environment: dev + prod).

alter table public.template_editor_slides
  add column if not exists fade_hidden boolean,
  add column if not exists fade_locked boolean;

alter table public.template_editor_post_slides
  add column if not exists fade_hidden boolean,
  add column if not exists fade_locked boolean;
