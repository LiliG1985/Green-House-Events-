-- Freelance event crew (stage, project, account managers...) apply through the Join Our Roster form.
-- They stay private in the dashboard, like suppliers.
alter table public.applications add column if not exists cv_path text;
alter table public.applications add column if not exists linkedin text;
alter table public.applications add column if not exists experience_years text;
alter table public.applications add column if not exists availability text;
alter table public.applications add column if not exists visa_status text;
alter table public.applications drop constraint if exists applications_applicant_type_check;
alter table public.applications add constraint applications_applicant_type_check check (applicant_type in ('performer', 'supplier', 'crew'));
-- Let the private applications bucket take CVs (PDF and Word) as well as photos.
update storage.buckets set allowed_mime_types = array['image/jpeg', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
where id = 'applications';
