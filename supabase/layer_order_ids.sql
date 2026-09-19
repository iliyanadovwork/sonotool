-- Persist the unified free-element + fade draw order for the template editor.
-- The Layers panel reorders image boxes, text boxes and the settings fade
-- (stored as the sentinel id '__fade__') into a single bottom->top order; this
-- column is where that order lives. Without it, reordering — e.g. moving the
-- fade up the stack — is lost on refresh (it falls back to fade-at-bottom).
--
-- Nullable: existing rows stay NULL and use the legacy fallback ordering, so
-- nothing renders differently until the user reorders.
-- Safe to run more than once (idempotent).
-- Run in: Supabase Dashboard -> SQL Editor (run once per environment: dev + prod).

alter table public.template_editor_slides
  add column if not exists layer_order_ids text[];

alter table public.template_editor_post_slides
  add column if not exists layer_order_ids text[];
