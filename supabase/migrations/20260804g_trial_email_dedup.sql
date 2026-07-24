-- Closes the unlimited-14-day-trial loophole: lhq_grant_signup_trial() (from
-- 20260722_signup_trial.sql) grants a fresh 14-day Pro-features trial to
-- EVERY new auth.users row with zero dedup. This app's only signup path is
-- magic-link or Google OAuth (no password signup exists - see app/login),
-- so email possession is already proven for any given address; the real gap
-- is that one person can generate unlimited DIFFERENT addresses that all
-- land in the same inbox via provider aliasing (name+1@gmail.com,
-- name+2@gmail.com, na.me@gmail.com are all name@gmail.com to Gmail, but
-- looked like distinct new users to this trigger) and claim a fresh trial
-- each time.
--
-- Fix: normalize the email (strip +tag aliasing generically, strip Gmail's
-- dot-insensitivity specifically) and track the first user_id that claimed
-- a trial for each normalized address in a permanent table. Every
-- subsequent signup sharing that normalized address still gets a free-tier
-- account (nothing breaks), it just gets trial_ends_at = null instead of a
-- fresh 14-day window.
--
-- Does NOT stop disposable/throwaway-domain abuse (mailinator etc.) or a
-- determined attacker using entirely unrelated real inboxes - those need
-- Supabase Auth Hooks (before-user-created, can inspect signup context and
-- reject) or CAPTCHA on the client, both of which require dashboard-level
-- Supabase Auth configuration outside what a SQL migration can do. Flagging
-- as a follow-up, not attempted here.
--
-- Run the PROD block in qdpwhnvmhqgzijuwopso, the DEV block (commented) in
-- wdtjhrilakoitfcezxpx.

-- ── PROD ─────────────────────────────────────────────────────────────────
create table if not exists lhq_trial_claims (
  normalized_email text primary key,
  first_user_id    uuid not null references auth.users(id) on delete cascade,
  claimed_at        timestamptz not null default now()
);

alter table lhq_trial_claims enable row level security;
-- No policies granted - this table is only ever touched by the SECURITY
-- DEFINER trigger function below, never directly by client code.

create or replace function lhq_normalize_trial_email(p_email text)
returns text
language plpgsql
immutable
as $$
declare
  local_part  text;
  domain_part text;
  at_pos      int;
  plus_pos    int;
  email       text := lower(trim(p_email));
begin
  at_pos := position('@' in email);
  if at_pos = 0 then return email; end if;

  local_part  := substring(email from 1 for at_pos - 1);
  domain_part := substring(email from at_pos + 1);

  -- +tag aliasing - supported by Gmail, Outlook, Yahoo, iCloud, ProtonMail, Fastmail
  plus_pos := position('+' in local_part);
  if plus_pos > 0 then
    local_part := substring(local_part from 1 for plus_pos - 1);
  end if;

  -- Gmail/Googlemail specifically ignore dots in the local part
  if domain_part in ('gmail.com', 'googlemail.com') then
    local_part  := replace(local_part, '.', '');
    domain_part := 'gmail.com';
  end if;

  return local_part || '@' || domain_part;
end;
$$;

revoke execute on function lhq_normalize_trial_email(text) from public;

create or replace function lhq_grant_signup_trial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  norm_email      text;
  already_claimed boolean := false;
begin
  if new.email is not null then
    norm_email := lhq_normalize_trial_email(new.email);

    insert into lhq_trial_claims (normalized_email, first_user_id)
    values (norm_email, new.id)
    on conflict (normalized_email) do nothing;

    select (first_user_id <> new.id) into already_claimed
      from lhq_trial_claims where normalized_email = norm_email;
  end if;

  insert into lhq_user_subscriptions (user_id, role, trial_ends_at, updated_at)
  values (
    new.id,
    'free',
    case when already_claimed then null else now() + interval '14 days' end,
    now()
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke execute on function lhq_grant_signup_trial() from public;

-- Trigger itself is unchanged (still fires on auth.users insert), just
-- re-asserting it here since create or replace function doesn't touch it.
drop trigger if exists lhq_signup_trial on auth.users;
create trigger lhq_signup_trial
  after insert on auth.users
  for each row
  execute function lhq_grant_signup_trial();

-- ── DEV (lhq_dev_ prefix) - run separately against the dev project ─────────
-- create table if not exists lhq_dev_trial_claims (
--   normalized_email text primary key,
--   first_user_id    uuid not null references auth.users(id) on delete cascade,
--   claimed_at        timestamptz not null default now()
-- );
-- alter table lhq_dev_trial_claims enable row level security;
--
-- create or replace function lhq_dev_normalize_trial_email(p_email text)
-- returns text language plpgsql immutable as $$
-- declare
--   local_part text; domain_part text; at_pos int; plus_pos int;
--   email text := lower(trim(p_email));
-- begin
--   at_pos := position('@' in email);
--   if at_pos = 0 then return email; end if;
--   local_part := substring(email from 1 for at_pos - 1);
--   domain_part := substring(email from at_pos + 1);
--   plus_pos := position('+' in local_part);
--   if plus_pos > 0 then local_part := substring(local_part from 1 for plus_pos - 1); end if;
--   if domain_part in ('gmail.com', 'googlemail.com') then
--     local_part := replace(local_part, '.', ''); domain_part := 'gmail.com';
--   end if;
--   return local_part || '@' || domain_part;
-- end; $$;
-- revoke execute on function lhq_dev_normalize_trial_email(text) from public;
--
-- create or replace function lhq_dev_grant_signup_trial()
-- returns trigger language plpgsql security definer set search_path = public as $$
-- declare norm_email text; already_claimed boolean := false;
-- begin
--   if new.email is not null then
--     norm_email := lhq_dev_normalize_trial_email(new.email);
--     insert into lhq_dev_trial_claims (normalized_email, first_user_id)
--       values (norm_email, new.id) on conflict (normalized_email) do nothing;
--     select (first_user_id <> new.id) into already_claimed
--       from lhq_dev_trial_claims where normalized_email = norm_email;
--   end if;
--   insert into lhq_dev_user_subscriptions (user_id, role, trial_ends_at, updated_at)
--   values (new.id, 'free', case when already_claimed then null else now() + interval '14 days' end, now())
--   on conflict (user_id) do nothing;
--   return new;
-- end; $$;
-- revoke execute on function lhq_dev_grant_signup_trial() from public;
-- drop trigger if exists lhq_dev_signup_trial on auth.users;
-- create trigger lhq_dev_signup_trial after insert on auth.users
--   for each row execute function lhq_dev_grant_signup_trial();
