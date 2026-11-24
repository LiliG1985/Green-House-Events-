-- Adds a video link to each slide and shows it on client proposals.
-- Safe to run more than once.
alter table public.slides add column if not exists video_url text;

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
      select json_agg(json_build_object('url', s.url, 'video', s.video_url) order by ps.position)
      from public.proposal_slides ps join public.slides s on s.id = ps.slide_id
      where ps.proposal_id = p.id), '[]'::json))
  from public.proposals p
  where p.shared and p.share_token = token and length(token) >= 32;
$$;
grant execute on function public.shared_proposal(text) to anon, authenticated;
