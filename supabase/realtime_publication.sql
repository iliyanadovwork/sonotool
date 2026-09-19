-- Live content sync for the template/post editor: publish slide + parent row changes
-- so open editors can adopt writes made elsewhere (CLI, teammates) without a refresh.
-- RLS still applies to what each subscriber receives.
-- Applied to prod 2026-08-21 (migration realtime_publication_editor_tables).
alter publication supabase_realtime add table template_editor_slides;
alter publication supabase_realtime add table template_editor_post_slides;
alter publication supabase_realtime add table template_editor_templates;
alter publication supabase_realtime add table template_editor_posts;
