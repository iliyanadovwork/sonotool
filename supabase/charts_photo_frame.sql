-- Chart Reels: store picked artist photos as our own assets + remember the circular-frame
-- crop per artist.
--   - 'chart-photos' storage bucket (public) holds downloaded copies of picked images, so
--     they load reliably (no hotlink/CORS issues) and survive the source URL dying.
--   - artist_photo_pref.frame holds the circular crop transform { zoom, panX, panY }.
--
-- Safe to run more than once (idempotent).
-- Run in: Supabase Dashboard -> SQL Editor (run once per environment; DEV = sonotooldev).

insert into storage.buckets (id, name, public)
values ('chart-photos', 'chart-photos', true)
on conflict (id) do nothing;

alter table public.artist_photo_pref
  add column if not exists frame jsonb;  -- { zoom, panX, panY } | null
