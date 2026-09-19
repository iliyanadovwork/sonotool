-- =============================================================================
-- Sonotool — Supabase setup
-- =============================================================================
-- Run this once in the Supabase SQL editor on a fresh project.
-- It is idempotent where possible (CREATE TABLE IF NOT EXISTS, ADD COLUMN
-- IF NOT EXISTS) but the policies/triggers are NOT — drop the relevant
-- objects first if re-running.
--
-- Pre-requisites already done in the dashboard:
--   * Authentication → Email provider enabled
--   * Authentication → Site URL = http://localhost:3000
--   * Authentication → Redirect URLs include http://localhost:3000/**
--   * Storage → bucket "brand-kit-logos" created, public access ON
-- =============================================================================


-- =============================================================================
-- Shared trigger function: updated_at
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- =============================================================================
-- brand_kit + brand_kit_logos
-- -----------------------------------------------------------------------------
-- One brand_kit per signed-in user. Logos are 1-N children stored in the
-- "brand-kit-logos" storage bucket; brand_kit_logos.url is the full public URL.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.brand_kit (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL UNIQUE,
  display_name text        NOT NULL DEFAULT '',
  handle       text        NOT NULL DEFAULT '',   -- stored without leading '@'
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_kit_pkey         PRIMARY KEY (id),
  CONSTRAINT brand_kit_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.brand_kit_logos (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  brand_kit_id  uuid        NOT NULL,
  url           text        NOT NULL,
  label         text,
  position      integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_kit_logos_pkey              PRIMARY KEY (id),
  CONSTRAINT brand_kit_logos_brand_kit_id_fkey FOREIGN KEY (brand_kit_id)
    REFERENCES public.brand_kit(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS brand_kit_logos_brand_kit_id_idx
  ON public.brand_kit_logos(brand_kit_id, position);

CREATE TRIGGER set_brand_kit_updated_at
  BEFORE UPDATE ON public.brand_kit
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.brand_kit       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_kit_logos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner select" ON public.brand_kit
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "owner insert" ON public.brand_kit
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner update" ON public.brand_kit
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "owner delete" ON public.brand_kit
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "owner select" ON public.brand_kit_logos
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.brand_kit b WHERE b.id = brand_kit_id AND b.user_id = auth.uid())
  );
CREATE POLICY "owner insert" ON public.brand_kit_logos
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.brand_kit b WHERE b.id = brand_kit_id AND b.user_id = auth.uid())
  );
CREATE POLICY "owner update" ON public.brand_kit_logos
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.brand_kit b WHERE b.id = brand_kit_id AND b.user_id = auth.uid())
  );
CREATE POLICY "owner delete" ON public.brand_kit_logos
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.brand_kit b WHERE b.id = brand_kit_id AND b.user_id = auth.uid())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_kit       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_kit_logos TO authenticated;


-- =============================================================================
-- Storage policies for the brand-kit-logos bucket
-- -----------------------------------------------------------------------------
-- The app uploads to "<auth.uid()>/<timestamp>_<filename>" — the first folder
-- segment is the user's UID. These policies allow each user to manage only
-- their own folder. Reads are public because the bucket is public.
-- =============================================================================
CREATE POLICY "brand-kit-logos public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'brand-kit-logos');

CREATE POLICY "brand-kit-logos owner insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'brand-kit-logos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "brand-kit-logos owner update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'brand-kit-logos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "brand-kit-logos owner delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'brand-kit-logos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );


-- =============================================================================
-- carousel_templates + carousel_slides
-- -----------------------------------------------------------------------------
-- One carousel_templates row per user (container).
-- Three carousel_slides per template (main / supporting_1 / supporting_2).
--
-- JSONB column shapes
-- -------------------
-- shadow columns  (logo_shadow, headline_shadow, sub_shadow, quote_shadow):
--   { "enabled": bool, "color": "#000000", "blur": 16,
--     "offsetX": 0, "offsetY": 6, "opacity": 60, "lift": 0 }
--
-- tag_slots  (3 entries — index = slot position 0-2):
--   [ { "text": "BREAKING", "style": { ...TagStyle } } | null, ... ]
--
--   TagStyle keys: bgColor, bgOpacity, borderColor, borderWidth, borderOpacity,
--     cornerRadius, textColor, fontSize, fontWeight, italic, fontLabel,
--     paddingX, paddingY, letterSpacing, textCase, shadow (optional ShadowStyle)
--
-- tag_zone_slots  (9 entries — index = row*3 + zone):  same shape as tag_slots
--
-- quote_slots  (3 entries):
--   [ "curly-open" | null, ... ]   -- styleId strings from QUOTE_STYLES
-- quote_zone_slots  (9 entries):   same shape as quote_slots
--
-- zone_logo_slots  (9 entries):  [ "https://…/logo-a.png" | null, ... ]
-- logo_row_slots   (3 entries):  [ "https://…/logo-b.png" | null, ... ]
--
-- swipe_zone_slots  (9 entries):
--   [ { "text": "SWIPE", "allCaps": true, "fontLabel": "Inter",
--       "fontWeight": 700, "fontSize": 22, "textColor": "#ffffff",
--       "letterSpacing": 3, "arrowType": "line", "arrowLength": 55,
--       "arrowColor": "#ffffff", "arrowWeight": 2, "arrowHeadSize": 10,
--       "direction": "right", "layout": "text-arrow", "gap": 12,
--       "opacity": 100, "shadow": null | ShadowStyle } | null, ... ]
--
-- divider_slots  (3 entries):  [ "logo-left-fade" | null, ... ]
--
-- divider_sub_slots  (3 entries — content embedded inside a divider):
--   [ { "type": "tag",   "text": "ALERT", "style": { ...TagStyle } }
--   | { "type": "swipe", "style": { ...SwipeStyle } }
--   | null, ... ]
--   Note: "type": "image" entries are stripped to null on save (blob URLs ephemeral)
--
-- divider_settings  (3 entries — per-slot visual overrides):
--   [ { "lineColor": "#ffffff", "lineOpacity": 55, "lineWeight": 2,
--       "dashLen": 28, "dashGap": 20, "dotSize": 3, "dotSpacing": 18,
--       "doubleSpacing": 8, "tripleSpacing": 10, "centerWeight": 5,
--       "dotRadius": 8, "dotGap": 20, "taperHeight": 25, "shortLength": 33,
--       "waveAmplitude": 18, "bracketWidth": 24, "bracketMargin": 30,
--       "contentGap": 20, "fadeSpread": 30, "shadow": ShadowStyle | null } | null, ... ]
--
-- headline_spans / sub_spans:
--   [ { "text": "hello", "color": "#ff0000", "bold": true, "italic": false } ] | null
--
-- default_tag_style  (TagStyle — the starting style copied onto every new dragged tag)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.carousel_templates (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carousel_templates_pkey         PRIMARY KEY (id),
  CONSTRAINT carousel_templates_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.carousel_slides (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL,
  slide_type  text NOT NULL CHECK (slide_type IN ('main', 'supporting_1', 'supporting_2')),

  -- Text content (image is ephemeral client state — not stored)
  headline    text NOT NULL DEFAULT '',
  subheadline text NOT NULL DEFAULT '',

  -- ── Logo ──────────────────────────────────────────────────────────────────
  logo_opacity       integer NOT NULL DEFAULT 100 CHECK (logo_opacity       BETWEEN 0 AND 100),
  logo_scale         integer NOT NULL DEFAULT 100 CHECK (logo_scale         BETWEEN 10 AND 200),
  logo_corner_radius integer NOT NULL DEFAULT 0   CHECK (logo_corner_radius >= 0),
  logo_shadow        jsonb,
  logo_slot_aligns   text[]  NOT NULL DEFAULT ARRAY['center','center','center'],

  -- ── Layout ────────────────────────────────────────────────────────────────
  head_sub_gap    integer NOT NULL DEFAULT 20,
  above_logo_gap  integer NOT NULL DEFAULT 8,
  content_padding integer NOT NULL DEFAULT 50,

  -- ── Fade ──────────────────────────────────────────────────────────────────
  show_fade          boolean NOT NULL DEFAULT true,
  fade_floor         integer NOT NULL DEFAULT 20,
  fade_reach         integer NOT NULL DEFAULT 40,
  fade_intensity     integer NOT NULL DEFAULT 85,
  show_top_fade      boolean NOT NULL DEFAULT false,
  top_fade_floor     integer NOT NULL DEFAULT 20,
  top_fade_reach     integer NOT NULL DEFAULT 40,
  top_fade_intensity integer NOT NULL DEFAULT 85,

  -- ── Background ────────────────────────────────────────────────────────────
  bg_blur_enabled  boolean NOT NULL DEFAULT false,
  bg_blur_amount   integer NOT NULL DEFAULT 10,
  bg_darken_amount integer NOT NULL DEFAULT 0,

  -- ── Headline typography ───────────────────────────────────────────────────
  headline_color  text    NOT NULL DEFAULT '#ffffff',
  font_size       integer NOT NULL DEFAULT 68,
  l_spacing       integer NOT NULL DEFAULT 0,
  l_height        integer NOT NULL DEFAULT 15,
  font_label      text    NOT NULL DEFAULT 'Inter',
  font_weight     integer NOT NULL DEFAULT 700,
  italic          boolean NOT NULL DEFAULT false,
  text_align      text    NOT NULL DEFAULT 'left'
                  CHECK (text_align IN ('left','center','right','justify')),
  all_caps        boolean NOT NULL DEFAULT false,
  headline_shadow jsonb   DEFAULT NULL,
  headline_spans  jsonb   DEFAULT NULL,

  -- ── Sub-headline typography ───────────────────────────────────────────────
  subheadline_color text    NOT NULL DEFAULT '#ffffff',
  sub_font_size     integer NOT NULL DEFAULT 32,
  sub_l_spacing     integer NOT NULL DEFAULT 0,
  sub_l_height      integer NOT NULL DEFAULT 10,
  sub_font_label    text    NOT NULL DEFAULT 'Inter',
  sub_font_weight   integer NOT NULL DEFAULT 400,
  sub_italic        boolean NOT NULL DEFAULT false,
  sub_text_align    text    NOT NULL DEFAULT 'left'
                    CHECK (sub_text_align IN ('left','center','right','justify')),
  sub_all_caps      boolean NOT NULL DEFAULT false,
  sub_shadow        jsonb   DEFAULT NULL,
  sub_spans         jsonb   DEFAULT NULL,

  -- ── Circle 1 ──────────────────────────────────────────────────────────────
  circle_border_color    text    NOT NULL DEFAULT '#ffffff',
  circle_border_width    integer NOT NULL DEFAULT 10,
  circle_border_opacity  integer NOT NULL DEFAULT 100,
  circle_shadow_enabled  boolean NOT NULL DEFAULT false,
  circle_shadow_blur     integer NOT NULL DEFAULT 20,
  circle_shadow_offset_x integer NOT NULL DEFAULT 0,
  circle_shadow_offset_y integer NOT NULL DEFAULT 8,
  circle_shadow_color    text    NOT NULL DEFAULT '#000000',
  circle_shadow_opacity  integer NOT NULL DEFAULT 50,
  circle_lift            integer NOT NULL DEFAULT 0,

  -- ── Circle 2 ──────────────────────────────────────────────────────────────
  circle2_border_color    text    NOT NULL DEFAULT '#ffffff',
  circle2_border_width    integer NOT NULL DEFAULT 10,
  circle2_border_opacity  integer NOT NULL DEFAULT 100,
  circle2_shadow_enabled  boolean NOT NULL DEFAULT false,
  circle2_shadow_blur     integer NOT NULL DEFAULT 20,
  circle2_shadow_offset_x integer NOT NULL DEFAULT 0,
  circle2_shadow_offset_y integer NOT NULL DEFAULT 8,
  circle2_shadow_color    text    NOT NULL DEFAULT '#000000',
  circle2_shadow_opacity  integer NOT NULL DEFAULT 50,
  circle2_lift            integer NOT NULL DEFAULT 0,

  -- ── Layer order ───────────────────────────────────────────────────────────
  layer_order text[] NOT NULL DEFAULT ARRAY['background','circle','circle2','subject'],

  -- ── Quotes shared style ───────────────────────────────────────────────────
  quote_color   text    NOT NULL DEFAULT '#ffffff',
  quote_size    integer NOT NULL DEFAULT 120,
  quote_opacity integer NOT NULL DEFAULT 100,
  quote_gap     integer NOT NULL DEFAULT 8,
  quote_shadow  jsonb   DEFAULT NULL,

  -- ── Default tag style (seed applied to newly dragged tags) ────────────────
  default_tag_style jsonb DEFAULT NULL,

  -- ── Slot arrays (JSONB — see column shape notes above) ────────────────────
  tag_slots         jsonb NOT NULL DEFAULT '[null,null,null]'::jsonb,
  tag_slot_aligns   text[] NOT NULL DEFAULT ARRAY['center','center','center'],
  tag_zone_slots    jsonb NOT NULL DEFAULT '[null,null,null,null,null,null,null,null,null]'::jsonb,
  quote_slots       jsonb NOT NULL DEFAULT '[null,null,null]'::jsonb,
  quote_zone_slots  jsonb NOT NULL DEFAULT '[null,null,null,null,null,null,null,null,null]'::jsonb,
  zone_logo_slots   jsonb NOT NULL DEFAULT '[null,null,null,null,null,null,null,null,null]'::jsonb,
  logo_row_slots    jsonb NOT NULL DEFAULT '[null,null,null]'::jsonb,
  swipe_zone_slots  jsonb NOT NULL DEFAULT '[null,null,null,null,null,null,null,null,null]'::jsonb,
  divider_slots     jsonb NOT NULL DEFAULT '[null,null,null]'::jsonb,
  divider_sub_slots jsonb NOT NULL DEFAULT '[null,null,null]'::jsonb,
  divider_settings  jsonb NOT NULL DEFAULT '[null,null,null]'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT carousel_slides_pkey            PRIMARY KEY (id),
  CONSTRAINT carousel_slides_template_fkey   FOREIGN KEY (template_id)
    REFERENCES public.carousel_templates(id) ON DELETE CASCADE,
  CONSTRAINT carousel_slides_unique_per_type UNIQUE (template_id, slide_type)
);

CREATE TRIGGER set_carousel_templates_updated_at
  BEFORE UPDATE ON public.carousel_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_carousel_slides_updated_at
  BEFORE UPDATE ON public.carousel_slides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.carousel_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carousel_slides    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner select" ON public.carousel_templates
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "owner insert" ON public.carousel_templates
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner update" ON public.carousel_templates
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "owner delete" ON public.carousel_templates
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "owner select" ON public.carousel_slides
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.carousel_templates t WHERE t.id = template_id AND t.user_id = auth.uid())
  );
CREATE POLICY "owner insert" ON public.carousel_slides
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.carousel_templates t WHERE t.id = template_id AND t.user_id = auth.uid())
  );
CREATE POLICY "owner update" ON public.carousel_slides
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.carousel_templates t WHERE t.id = template_id AND t.user_id = auth.uid())
  );
CREATE POLICY "owner delete" ON public.carousel_slides
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.carousel_templates t WHERE t.id = template_id AND t.user_id = auth.uid())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.carousel_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carousel_slides    TO authenticated;


-- =============================================================================
-- profiles + markets
-- -----------------------------------------------------------------------------
-- These hold the "talents" (people with tickers) that the AI cards flow reads.
-- They are PRODUCT data, not per-user data — populate with whichever roster
-- you want to support. See the sample INSERT at the bottom of this file.
--
-- Read access is granted to anon because the AI route handlers query with the
-- anon key. Writes are restricted (no policy = denied by default).
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  ticker            text        NOT NULL UNIQUE,
  name              text        NOT NULL,
  bio               text,
  photo_url         text,
  industry          text,
  info_subcategory  text,
  info_location     text,
  social_instagram  text,
  social_x          text,
  social_youtube    text,
  social_website    text,
  claim_status      text,
  delisted_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS profiles_ticker_idx    ON public.profiles(ticker);
CREATE INDEX IF NOT EXISTS profiles_industry_idx  ON public.profiles(industry) WHERE delisted_at IS NULL;
CREATE INDEX IF NOT EXISTS profiles_subcategory_idx ON public.profiles(info_subcategory) WHERE delisted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.markets (
  profile_id                    uuid        NOT NULL,
  latest_price_cents            bigint,
  p0                            bigint,
  holders_count                 integer     NOT NULL DEFAULT 0,
  total_volume_lifetime_cents   bigint      NOT NULL DEFAULT 0,
  latest_tick_at                timestamptz,
  frozen                        boolean     NOT NULL DEFAULT false,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT markets_pkey            PRIMARY KEY (profile_id),
  CONSTRAINT markets_profile_id_fkey FOREIGN KEY (profile_id)
    REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_markets_updated_at
  BEFORE UPDATE ON public.markets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.markets  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "public read" ON public.markets  FOR SELECT USING (true);

GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT SELECT ON public.markets  TO anon, authenticated;


-- =============================================================================
-- news_sources
-- -----------------------------------------------------------------------------
-- Maps industry → curator twitter handles. Used by the news-lookup AI route
-- to build "from:handleA OR from:handleB" queries for the X search API.
-- Populate with whichever curators you care about. See the sample INSERT below.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.news_sources (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  industry   text        NOT NULL,
  handle     text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT news_sources_pkey   PRIMARY KEY (id),
  CONSTRAINT news_sources_unique UNIQUE (industry, handle)
);

CREATE INDEX IF NOT EXISTS news_sources_industry_idx
  ON public.news_sources(lower(industry));

ALTER TABLE public.news_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON public.news_sources FOR SELECT USING (true);
GRANT SELECT ON public.news_sources TO anon, authenticated;


-- =============================================================================
-- Sample seed data (delete or replace once you have your own roster)
-- -----------------------------------------------------------------------------
-- One sample profile + market so the AI flow has something to work with.
-- Pick someone with public news coverage so the news-lookup actually returns
-- results. Replace with your own roster when ready.
-- =============================================================================
INSERT INTO public.profiles (ticker, name, industry, info_subcategory, bio, photo_url)
VALUES (
  'MUSK',
  'Elon Musk',
  'Tech',
  'CEO',
  'CEO of Tesla, SpaceX, X.',
  NULL
)
ON CONFLICT (ticker) DO NOTHING;

INSERT INTO public.markets (profile_id, latest_price_cents, p0, holders_count, total_volume_lifetime_cents)
SELECT id, 10000, 5000, 100, 1000000 FROM public.profiles WHERE ticker = 'MUSK'
ON CONFLICT (profile_id) DO NOTHING;

INSERT INTO public.news_sources (industry, handle) VALUES
  ('Tech', 'elonmusk'),
  ('Tech', 'TechCrunch'),
  ('Tech', 'verge')
ON CONFLICT (industry, handle) DO NOTHING;
