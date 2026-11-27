-- Cyr Wheel: no performer name on the website or dashboard.
update public.artists set name = 'Cyr Wheel', role = 'Acrobatic Hoop Act' where slug = 'hicham' or name ilike 'hicham%';
update public.slides set title = 'Cyr Wheel' where title ilike 'hicham%';
-- Harps get their own group under Instrumentalists (the website also lists every harp act under Ramadan & Arabic > Harp).
update public.artists set subgroup = 'Cellists' where subgroup = 'Cellists & Harpists';
update public.artists set subgroup = 'Harpists' where slug in ('ulyana', 'harp-duo', 'canella-duo-trio');
-- First names only on the website.
update public.artists set bio = replace(replace(bio, 'Lidia Stankulova and Diana Pandova', 'Lidia and Diana'), 'led by Lidia Stankulova', 'led by Lidia') where bio ilike '%Stankulova%' or bio ilike '%Pandova%';
