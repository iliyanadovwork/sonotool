# Template-editor DB schema (snapshot)

Authoritative snapshot of the four `template_editor_*` tables in Supabase project
`dfjbrjxciybxathrqmoc`, captured for the headless CLI. The canonical row↔domain
mapping is **`slide-serde.ts`** in this folder — treat that as the source of truth
for column names/defaults, and regenerate this snapshot with
`supabase gen types typescript` (or the `list_tables` MCP) if the DB changes.

## Parents

**`template_editor_templates`** — `id uuid pk`, `user_id uuid NOT NULL (no default)`,
`name text ='Untitled template'`, `position int =0`, `created_at`, `updated_at`,
`deleted_at timestamptz NULL` (soft-delete).

**`template_editor_posts`** — the above plus `status text ='draft'` and
`source_template_id uuid NULL` (the template a post was created from). `name`
defaults to `'Untitled post'`.

## Child slides (identical shape in both tables)

**`template_editor_slides`** (FK `template_id`) and **`template_editor_post_slides`**
(FK `post_id`) hold the SAME ~94 columns — one row per slide:

- Identity/order: `id`, `<fk>`, `name ='main'`, `position =0`.
- Text: `headline`, `subheadline` (top-level strings), plus per-run `headline_spans`/
  `sub_spans` (jsonb) and full type styling (`font_size`, `l_spacing`, `font_label
  ='Inter'`, `font_weight =700`, `text_align`, `all_caps`, colors, `*_shadow` jsonb…),
  mirrored for the subheadline (`sub_*`).
- Fades: `show_fade`, `fade_floor/reach/intensity`, `show_top_fade`, `top_fade_*`,
  `fade_hidden`/`fade_locked` (nullable).
- Background: `bg_blur_enabled/amount`, `bg_darken_amount`, `canvas_color ='#000000'`.
  (There is **no base-image column** — the base photo is ephemeral; images persist
  only via `image_boxes`.)
- Free elements (jsonb arrays): `text_boxes ='[]'`, `image_boxes ='[]'`,
  `chart_boxes` (nullable); z-order via `layer_order_ids text[]` (nullable) +
  legacy `layer_order text[] ={background,subject}`.
- Slot content (jsonb): `tag_slots`/`tag_zone_slots`, `quote_slots`/`quote_zone_slots`,
  `zone_logo_slots`, `logo_row_slots`, `swipe_zone_slots`, `divider_slots`/
  `divider_sub_slots`/`divider_settings`, `default_tag_style`; logo geometry
  (`logo_opacity/scale/corner_radius/shadow/slot_aligns`), two circle-frame layers
  (`circle_*`, `circle2_*`), quote styling (`quote_*`).
- `created_at`, `updated_at`.

## Notes for the CLI

- `user_id` on the parents is `NOT NULL` with no default — the CLI **must** supply it
  (attributed to the requesting human). RLS is a single `is_team_member()` policy on
  all four tables; the service-role key bypasses it, so `auth.uid()` is null and the
  column is not auto-filled.
- Nearly every slide column has a DB default, so a minimal insert only needs the FK +
  the fields actually set — but `slideToRow()` writes them all explicitly.
- `divider_sub_slots` of type `image` are dropped on write (ephemeral blob URLs).
