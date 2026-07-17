-- Scope lhq_muted_alerts to per-user instead of a single global config table.
-- Previously any authenticated user muting a coin/rule silenced it for every
-- Pro user's Telegram feed - documented as intentional in the old comment,
-- but it's the wrong behavior: /alerts reads as "my preference", not
-- "everyone's preference".
--
-- Existing rows have no owner, so this wipes the table (config, not data -
-- users just re-set their own mutes). Run in: Supabase Dashboard -> SQL Editor,
-- once per project (prod uses lhq_, dev uses lhq_dev_).

alter table public.lhq_muted_alerts
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

delete from public.lhq_muted_alerts where user_id is null;

alter table public.lhq_muted_alerts
  alter column user_id set not null;

-- key was the primary key (global uniqueness) - drop it and repoint the PK
-- at (user_id, key), so two different users can each mute the same key.
alter table public.lhq_muted_alerts drop constraint lhq_muted_alerts_pkey;
alter table public.lhq_muted_alerts
  add constraint lhq_muted_alerts_pkey primary key (user_id, key);

create index if not exists lhq_muted_alerts_user_id_idx on public.lhq_muted_alerts(user_id);

-- Real per-user policy is now meaningful (previously there was no user_id to
-- write one against, so RLS had zero policies and the anon key saw nothing -
-- the API routes always used the service-role client to work around that).
drop policy if exists "users manage own muted alerts" on public.lhq_muted_alerts;
create policy "users manage own muted alerts"
  on public.lhq_muted_alerts
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Dev variant
alter table public.lhq_dev_muted_alerts
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

delete from public.lhq_dev_muted_alerts where user_id is null;

alter table public.lhq_dev_muted_alerts
  alter column user_id set not null;

alter table public.lhq_dev_muted_alerts drop constraint lhq_dev_muted_alerts_pkey;
alter table public.lhq_dev_muted_alerts
  add constraint lhq_dev_muted_alerts_pkey primary key (user_id, key);

create index if not exists lhq_dev_muted_alerts_user_id_idx on public.lhq_dev_muted_alerts(user_id);

drop policy if exists "users manage own muted alerts" on public.lhq_dev_muted_alerts;
create policy "users manage own muted alerts"
  on public.lhq_dev_muted_alerts
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
