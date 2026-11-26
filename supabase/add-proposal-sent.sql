-- Lets the team tick a proposal as sent to the client.
alter table public.proposals add column if not exists sent_at timestamptz;
