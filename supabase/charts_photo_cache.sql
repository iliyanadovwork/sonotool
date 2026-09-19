-- Chart Reels photo features:
--   photo_search_cache  — caches SerpAPI Google-Images results per (query, page) so we
--                         don't spend a metered SerpAPI search on repeat lookups.
--   artist_photo_pref   — the last photo chosen for an artist (by spotify_id), so the
--                         next reel that uses that artist reuses it instead of the
--                         default Spotify photo.
--
-- Both are written/read ONLY by server routes using the service key (which bypasses
-- RLS), so RLS is enabled with no policies (no anon/auth access) — same model as
-- public.trends_cache.
--
-- Safe to run more than once (idempotent).
-- Run in: Supabase Dashboard -> SQL Editor (run once per environment that needs it; DEV = sonotooldev).

create table if not exists public.photo_search_cache (
  cache_key  text primary key,            -- "<lowercased query>::<serpapi page index>"
  results    jsonb not null,              -- array of { url, thumbnail, title } for that page
  updated_at timestamptz not null default now()
);
alter table public.photo_search_cache enable row level security;

create table if not exists public.artist_photo_pref (
  spotify_id text primary key,
  photo_url  text not null,
  updated_at timestamptz not null default now()
);
alter table public.artist_photo_pref enable row level security;

-- The server routes use the service key (service_role). It bypasses RLS but still needs
-- table privileges. Supabase auto-grants these for dashboard-created tables, but NOT for
-- tables created via raw SQL — so grant explicitly (without this every read/write 403s).
grant select, insert, update on table public.photo_search_cache to service_role;
grant select, insert, update on table public.artist_photo_pref  to service_role;
