-- Lets the dashboard re-edit slides (photos, name, bio). Safe to run more than once.
alter table public.slides add column if not exists design jsonb;
