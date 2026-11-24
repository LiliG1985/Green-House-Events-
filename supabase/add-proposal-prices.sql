-- Prices on proposal slides (only inside proposals; the slide library and website never show them).
alter table public.proposal_slides add column if not exists price text;

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
