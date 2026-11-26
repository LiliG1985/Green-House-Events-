-- Greenhouse Events: artist roster database.
-- Run once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Safe to run again; it only creates what is missing.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Who may use the dashboard. Add a row per admin email (see bottom of file).
-- ---------------------------------------------------------------------------
create table if not exists public.admins (
  email text primary key,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------------------------------------------------------------------------
-- Artists. Everything in this table may appear on the website once published.
-- Links are copied into the pub_* columns only when their "show" switch is on,
-- so links you keep private are never readable from the public website.
-- ---------------------------------------------------------------------------
create table if not exists public.artists (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category text not null default 'singers' check (category in (
    'djs', 'singers', 'bands', 'instrumental', 'specialist', 'dancers',
    'mcs', 'hostesses', 'magicians', 'kids', 'ramadan'
  )),
  subgroup text,
  role text,
  bio text,
  cover_url text,
  published boolean not null default false,
  sort_order int not null default 0,
  show_videos boolean not null default true,
  show_audio boolean not null default false,
  show_instagram boolean not null default false,
  show_website boolean not null default false,
  pub_videos text,
  pub_audio text,
  pub_instagram text,
  pub_website text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists artists_list_idx on public.artists (category, sort_order);

-- Admin only. Never readable by the public website.
create table if not exists public.artist_private (
  artist_id uuid primary key references public.artists (id) on delete cascade,
  legal_name text,
  email text,
  phone text,
  based_in text,
  languages text,
  video_links text,
  audio_link text,
  instagram text,
  website text,
  rates text,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.artist_photos (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists (id) on delete cascade,
  url text not null,
  path text,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists artist_photos_idx on public.artist_photos (artist_id, position);

-- Keep updated_at fresh and the public link columns in step with the switches.
create or replace function public.artists_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare p public.artist_private;
begin
  new.updated_at = now();
  select * into p from public.artist_private where artist_id = new.id;
  new.pub_videos    = case when new.show_videos    then nullif(trim(p.video_links), '') end;
  new.pub_audio     = case when new.show_audio     then nullif(trim(p.audio_link), '') end;
  new.pub_instagram = case when new.show_instagram then nullif(trim(p.instagram), '') end;
  new.pub_website   = case when new.show_website   then nullif(trim(p.website), '') end;
  return new;
end;
$$;
drop trigger if exists artists_before_write on public.artists;
create trigger artists_before_write before insert or update on public.artists
  for each row execute function public.artists_before_write();

create or replace function public.artist_private_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Re-run the artists trigger so the public link columns pick up the change.
  update public.artists set updated_at = now() where id = new.artist_id;
  return null;
end;
$$;
drop trigger if exists artist_private_after_write on public.artist_private;
create trigger artist_private_after_write after insert or update on public.artist_private
  for each row execute function public.artist_private_after_write();

create or replace function public.artist_private_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists artist_private_touch on public.artist_private;
create trigger artist_private_touch before update on public.artist_private
  for each row execute function public.artist_private_touch();

-- ---------------------------------------------------------------------------
-- Applications from the website's Join Our Roster page.
-- Anyone may send one; only admins can read, change or delete them.
-- ---------------------------------------------------------------------------
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new', 'shortlisted', 'approved', 'declined')),
  full_name text not null check (length(full_name) between 1 and 200),
  act_name text,
  email text not null check (length(email) between 3 and 320),
  phone text,
  category text,
  based_in text,
  skills text,
  languages text,
  bio text check (length(bio) <= 6000),
  video_links text check (length(video_links) <= 3000),
  social text,
  photos jsonb not null default '[]'::jsonb,
  consent boolean not null default false,
  admin_notes text,
  artist_id uuid references public.artists (id) on delete set null
);

-- Suppliers apply through the same form. They stay in the dashboard only and are never shown on the website.
alter table public.applications add column if not exists applicant_type text not null default 'performer';
alter table public.applications add column if not exists company text;
alter table public.applications add column if not exists service_type text;
alter table public.applications add column if not exists portfolio_link text;
alter table public.applications add column if not exists website text;
alter table public.artist_private add column if not exists portfolio_link text;
alter table public.applications drop constraint if exists applications_applicant_type_check;
alter table public.applications add constraint applications_applicant_type_check check (applicant_type in ('performer', 'supplier'));

-- ---------------------------------------------------------------------------
-- Row level security.
-- ---------------------------------------------------------------------------
alter table public.admins enable row level security;
alter table public.artists enable row level security;
alter table public.artist_private enable row level security;
alter table public.artist_photos enable row level security;
alter table public.applications enable row level security;

drop policy if exists "admins read admins" on public.admins;
create policy "admins read admins" on public.admins for select using (public.is_admin());

drop policy if exists "public reads published artists" on public.artists;
create policy "public reads published artists" on public.artists for select
  using (published or public.is_admin());
drop policy if exists "admins write artists" on public.artists;
create policy "admins write artists" on public.artists for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins only private" on public.artist_private;
create policy "admins only private" on public.artist_private for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "public reads published photos" on public.artist_photos;
create policy "public reads published photos" on public.artist_photos for select
  using (public.is_admin() or exists (
    select 1 from public.artists a where a.id = artist_id and a.published
  ));
drop policy if exists "admins write photos" on public.artist_photos;
create policy "admins write photos" on public.artist_photos for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "anyone applies" on public.applications;
create policy "anyone applies" on public.applications for insert
  with check (status = 'new' and consent and admin_notes is null and artist_id is null);
drop policy if exists "admins manage applications" on public.applications;
create policy "admins manage applications" on public.applications for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Photo storage.
--   artists:      public to view (website photos); only admins add or remove.
--   applications: private; anyone may upload a JPEG up to 10 MB, only admins view.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('artists', 'artists', true, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('applications', 'applications', false, 10485760, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "admins upload artist photos" on storage.objects;
create policy "admins upload artist photos" on storage.objects for insert
  with check (bucket_id = 'artists' and public.is_admin());
drop policy if exists "admins update artist photos" on storage.objects;
create policy "admins update artist photos" on storage.objects for update
  using (bucket_id = 'artists' and public.is_admin());
drop policy if exists "admins delete artist photos" on storage.objects;
create policy "admins delete artist photos" on storage.objects for delete
  using (bucket_id = 'artists' and public.is_admin());

drop policy if exists "anyone uploads application photos" on storage.objects;
create policy "anyone uploads application photos" on storage.objects for insert
  with check (bucket_id = 'applications');
drop policy if exists "admins read application photos" on storage.objects;
create policy "admins read application photos" on storage.objects for select
  using (bucket_id = 'applications' and public.is_admin());
drop policy if exists "admins delete application photos" on storage.objects;
create policy "admins delete application photos" on storage.objects for delete
  using (bucket_id = 'applications' and public.is_admin());

-- ---------------------------------------------------------------------------
-- Proposal builder: a library of slides, and proposals made from them.
-- Admin only. A proposal can be shared with a client through a private link.
-- ---------------------------------------------------------------------------
create table if not exists public.slides (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Slide',
  category text,
  artist_id uuid references public.artists (id) on delete set null,
  url text not null,
  path text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.slides add column if not exists video_url text;
alter table public.slides add column if not exists design jsonb;
create index if not exists slides_list_idx on public.slides (category, sort_order);

create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  client text,
  event_date date,
  notes text,
  share_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  shared boolean not null default false,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.proposal_slides (
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  slide_id uuid not null references public.slides (id) on delete cascade,
  position int not null default 0,
  price text,
  primary key (proposal_id, slide_id)
);

drop trigger if exists proposals_touch on public.proposals;
create trigger proposals_touch before update on public.proposals
  for each row execute function public.artist_private_touch();

alter table public.slides enable row level security;
alter table public.proposals enable row level security;
alter table public.proposal_slides enable row level security;
drop policy if exists "admins manage slides" on public.slides;
create policy "admins manage slides" on public.slides for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins manage proposals" on public.proposals;
create policy "admins manage proposals" on public.proposals for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins manage proposal slides" on public.proposal_slides;
create policy "admins manage proposal slides" on public.proposal_slides for all using (public.is_admin()) with check (public.is_admin());

-- What a client sees through a shared link: the title and the slide images, nothing else.
create or replace function public.shared_proposal(token text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'title', p.title,
    'client', p.client,
    'slides', coalesce((
      select json_agg(json_build_object('url', s.url, 'video', s.video_url, 'price', ps.price) order by ps.position)
      from public.proposal_slides ps join public.slides s on s.id = ps.slide_id
      where ps.proposal_id = p.id), '[]'::json))
  from public.proposals p
  where p.shared and p.share_token = token and length(token) >= 32;
$$;
grant execute on function public.shared_proposal(text) to anon, authenticated;

-- Slide images: viewable by link (file names are random), only admins add or remove.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('slides', 'slides', true, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists "admins upload slides" on storage.objects;
create policy "admins upload slides" on storage.objects for insert with check (bucket_id = 'slides' and public.is_admin());
drop policy if exists "admins update slides" on storage.objects;
create policy "admins update slides" on storage.objects for update using (bucket_id = 'slides' and public.is_admin());
drop policy if exists "admins delete slides" on storage.objects;
create policy "admins delete slides" on storage.objects for delete using (bucket_id = 'slides' and public.is_admin());

-- ---------------------------------------------------------------------------
-- Add the people who may sign in to the dashboard (edit the email, then run).
-- insert into public.admins (email) values ('info@greenhouseeventsuae.com') on conflict do nothing;
-- ---------------------------------------------------------------------------

alter table public.proposal_slides add column if not exists price text;
alter table public.proposals add column if not exists sent_at timestamptz;
