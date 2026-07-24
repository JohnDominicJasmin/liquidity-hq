-- Disposable/throwaway-email blocklist for the signup trial. Pairs with
-- Turnstile CAPTCHA (already live): CAPTCHA stops SCRIPTED mass signups
-- regardless of email domain; this closes the narrower gap of a human
-- manually farming trials one at a time with real throwaway addresses,
-- which CAPTCHA alone doesn't catch. Does NOT block signup - a disposable
-- domain still gets a free-tier account (same non-destructive pattern as
-- the existing email-dedup logic from 20260804g/h), it just gets
-- trial_ends_at = null instead of a fresh 14-day window.
--
-- The domain list lives in a table, not hardcoded in the function, so it can
-- be extended later with a plain INSERT instead of a new migration. This is
-- a starter set of ~45 widely-recognized disposable-mail providers, not an
-- exhaustive list - there are open-source lists with thousands of entries;
-- add to this table over time as new ones surface.
--
-- Run the PROD block below in qdpwhnvmhqgzijuwopso, the DEV block
-- (commented) in wdtjhrilakoitfcezxpx.

-- ── PROD ─────────────────────────────────────────────────────────────────
create table if not exists lhq_disposable_email_domains (
  domain text primary key
);
alter table lhq_disposable_email_domains enable row level security;
-- No policies - only ever read by the SECURITY DEFINER trigger function
-- below; maintain the list by hand (INSERT ... ON CONFLICT DO NOTHING) via
-- the Supabase SQL editor or a future migration, not from client code.

insert into lhq_disposable_email_domains (domain) values
  ('mailinator.com'), ('guerrillamail.com'), ('guerrillamail.info'),
  ('guerrillamail.biz'), ('guerrillamail.net'), ('guerrillamail.org'),
  ('guerrillamail.de'), ('sharklasers.com'), ('10minutemail.com'),
  ('10minutemail.net'), ('temp-mail.org'), ('tempmail.com'), ('tempmail.net'),
  ('throwawaymail.com'), ('yopmail.com'), ('yopmail.net'), ('yopmail.fr'),
  ('trashmail.com'), ('trashmail.net'), ('trashmail.me'), ('dispostable.com'),
  ('fakeinbox.com'), ('maildrop.cc'), ('mintemail.com'), ('mohmal.com'),
  ('getnada.com'), ('mailnesia.com'), ('discard.email'), ('discardmail.com'),
  ('emailondeck.com'), ('spamgourmet.com'), ('moakt.com'), ('moakt.cc'),
  ('tempinbox.com'), ('mailcatch.com'), ('mytemp.email'), ('armyspy.com'),
  ('cuvox.de'), ('dayrep.com'), ('einrot.com'), ('fleckens.hu'), ('gustr.com'),
  ('jourrapide.com'), ('rhyta.com'), ('superrito.com'), ('teleworm.us')
on conflict (domain) do nothing;

create or replace function lhq_grant_signup_trial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  norm_email    text;
  domain_part   text;
  is_disposable boolean := false;
  grant_trial   boolean := false;
begin
  if new.email is not null then
    norm_email  := lhq_normalize_trial_email(new.email);
    domain_part := split_part(norm_email, '@', 2);

    select exists(
      select 1 from lhq_disposable_email_domains where domain = domain_part
    ) into is_disposable;

    if not is_disposable then
      insert into lhq_trial_claims (normalized_email, first_user_id)
      values (norm_email, new.id)
      on conflict (normalized_email) do nothing;
      select (first_user_id = new.id) into grant_trial
        from lhq_trial_claims where normalized_email = norm_email;
    end if;
  end if;

  insert into lhq_user_subscriptions (user_id, role, trial_ends_at, updated_at)
  values (
    new.id, 'free',
    case when grant_trial then now() + interval '14 days' else null end,
    now()
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;
revoke execute on function lhq_grant_signup_trial() from public;

-- ── DEV (lhq_dev_ prefix) - run separately against the dev project ─────────
-- create table if not exists lhq_dev_disposable_email_domains (domain text primary key);
-- alter table lhq_dev_disposable_email_domains enable row level security;
-- insert into lhq_dev_disposable_email_domains (domain) values
--   (... same 45 domains as PROD above ...)
-- on conflict (domain) do nothing;
--
-- create or replace function lhq_dev_grant_signup_trial()
-- returns trigger language plpgsql security definer set search_path = public as $$
-- declare
--   norm_email text; domain_part text;
--   is_disposable boolean := false; grant_trial boolean := false;
-- begin
--   if new.email is not null then
--     norm_email := lhq_dev_normalize_trial_email(new.email);
--     domain_part := split_part(norm_email, '@', 2);
--     select exists(select 1 from lhq_dev_disposable_email_domains where domain = domain_part) into is_disposable;
--     if not is_disposable then
--       insert into lhq_dev_trial_claims (normalized_email, first_user_id)
--         values (norm_email, new.id) on conflict (normalized_email) do nothing;
--       select (first_user_id = new.id) into grant_trial
--         from lhq_dev_trial_claims where normalized_email = norm_email;
--     end if;
--   end if;
--   insert into lhq_dev_user_subscriptions (user_id, role, trial_ends_at, updated_at)
--     values (new.id, 'free', case when grant_trial then now() + interval '14 days' else null end, now())
--     on conflict (user_id) do nothing;
--   return new;
-- end; $$;
-- revoke execute on function lhq_dev_grant_signup_trial() from public;
