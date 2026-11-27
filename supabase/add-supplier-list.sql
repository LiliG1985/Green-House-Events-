-- Private supplier list: dashboard only, never on the website.
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  company text not null check (length(company) between 1 and 200),
  contact_name text,
  status text not null default 'potential' check (status in ('potential', 'approved', 'preferred', 'inactive', 'do_not_use')),
  services text,
  other_services text,
  email text,
  phone text,
  based_in text,
  website text,
  social text,
  portfolio_link text,
  pricing_notes text,
  rating int check (rating between 1 and 5),
  notes text,
  photo_path text,
  application_id uuid references public.applications (id) on delete set null
);
alter table public.suppliers enable row level security;
drop policy if exists "admins manage suppliers" on public.suppliers;
create policy "admins manage suppliers" on public.suppliers for all
  using (public.is_admin()) with check (public.is_admin());
