-- ── 14-day signup Pro trial ───────────────────────────────────────────────
-- Every NEW signup gets 14 days of Pro FEATURES (fast timeframes, backtest,
-- absorption, confluence, on-chain/macro). Role stays 'free' during the trial,
-- so the daily AI usage caps (which key on role) stay Free-tier - Pro tools,
-- Free AI spend. Feature gates read the trial via lib/entitlements.ts
-- (getEntitlement / hasProFeatures) and AuthProvider (isTrial / entitled).
--
-- Tables are environment-prefixed (see lib/tables.ts): lhq_dev_ on dev,
-- lhq_ on prod. The DEV version below is ALREADY APPLIED to the dev Supabase
-- project (wdtjhrilakoitfcezxpx) via migration `add_signup_trial_dev`.
-- Apply the PROD version to the prod project (qdpwhnvmhqgzijuwopso) when the
-- trial ships to prod. Run in: Supabase Dashboard → SQL Editor.

-- ══ DEV (already applied) ══════════════════════════════════════════════════
-- alter table lhq_dev_user_subscriptions
--   add column if not exists trial_ends_at timestamptz;
--
-- create or replace function lhq_dev_grant_signup_trial()
-- returns trigger language plpgsql security definer set search_path = public as $$
-- begin
--   insert into lhq_dev_user_subscriptions (user_id, role, trial_ends_at, updated_at)
--   values (new.id, 'free', now() + interval '14 days', now())
--   on conflict (user_id) do nothing;
--   return new;
-- end; $$;
-- revoke execute on function lhq_dev_grant_signup_trial() from anon, authenticated;
-- drop trigger if exists lhq_dev_signup_trial on auth.users;
-- create trigger lhq_dev_signup_trial after insert on auth.users
--   for each row execute function lhq_dev_grant_signup_trial();

-- ══ PROD (apply on prod launch) ════════════════════════════════════════════
alter table lhq_user_subscriptions
  add column if not exists trial_ends_at timestamptz;

-- SECURITY DEFINER + execute revoked from anon/authenticated so it can't be
-- reached as a PostgREST RPC (same hardening as the ban-sync function).
create or replace function lhq_grant_signup_trial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into lhq_user_subscriptions (user_id, role, trial_ends_at, updated_at)
  values (new.id, 'free', now() + interval '14 days', now())
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Revoke from PUBLIC, not just anon/authenticated: Postgres grants EXECUTE to
-- PUBLIC by default, so revoking only anon/authenticated still leaves the
-- function reachable as a PostgREST RPC (Supabase advisor 0028/0029). It's only
-- ever invoked by its trigger, never by RPC, so drop the PUBLIC grant entirely.
revoke execute on function lhq_grant_signup_trial() from public;

drop trigger if exists lhq_signup_trial on auth.users;
create trigger lhq_signup_trial
  after insert on auth.users
  for each row
  execute function lhq_grant_signup_trial();
