-- Soft-delete for the template editor (templates + posts).
--
-- Before: deleteTemplate ran a hard DELETE by id — team-shared, one-click,
-- permanent, no audit. A single stray click (by anyone on the team) destroyed a
-- design forever, with no backup to fall back on.
--
-- After: deletions set deleted_at instead of removing the row. The app filters
-- `deleted_at IS NULL` on load and offers Undo + a "Recently deleted → Restore"
-- list. Slides are left untouched (they ride with their parent), so restoring a
-- template brings its full design back intact.
--
-- Applied to prod via supabase apply_migration (name: template_editor_soft_delete).

ALTER TABLE template_editor_templates ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE template_editor_posts     ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Keep the common "active rows, ordered by position" scan fast.
CREATE INDEX IF NOT EXISTS template_editor_templates_active_idx
  ON template_editor_templates (position) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS template_editor_posts_active_idx
  ON template_editor_posts (position) WHERE deleted_at IS NULL;
