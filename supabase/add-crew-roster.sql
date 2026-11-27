-- Private crew & staffing roster: potential freelancers and staff. Dashboard only, never on the website.
create table if not exists public.crew (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  full_name text not null check (length(full_name) between 1 and 200),
  kind text not null default 'freelancer' check (kind in ('freelancer', 'staff')),
  status text not null default 'potential' check (status in ('potential', 'active', 'inactive', 'do_not_use')),
  role text,
  experience_years text,
  availability text,
  visa_status text,
  email text,
  phone text,
  based_in text,
  languages text,
  skills text,
  day_rate text,
  linkedin text,
  social text,
  portfolio_link text,
  rating int check (rating between 1 and 5),
  notes text,
  photo_path text,
  cv_path text,
  application_id uuid references public.applications (id) on delete set null
);
alter table public.crew enable row level security;
drop policy if exists "admins manage crew" on public.crew;
create policy "admins manage crew" on public.crew for all
  using (public.is_admin()) with check (public.is_admin());
