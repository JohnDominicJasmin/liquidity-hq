-- Follow-up hardening from the multi-pass adversarial audit (2026-08-04).
-- Three defense-in-depth fixes on the subscription/trial tables. All applied
-- live to both Supabase projects (prod qdpwhnvmhqgzijuwopso, dev wdtjhrilakoitfcezxpx).
--
-- 1. Revoke the default INSERT/UPDATE/DELETE/TRUNCATE grants that Supabase
--    hands to anon/authenticated on every public table. RLS is enabled and
--    default-denies writes on both tables today, but that made RLS the SOLE
--    barrier between an authenticated user and writing their own role='pro'.
--    TRUNCATE isn't even a row-level operation, so RLS never guarded it at all.
--    Every legitimate write goes through the service_role client (webhook, ops,
--    cron) or the SECURITY DEFINER signup trigger - none of which use these
--    grants - so revoking them changes no real behavior. SELECT is kept
--    (lib/entitlements.ts reads the caller's own subscription row via the
--    sub_select_own policy).
--
-- 2. lhq_trial_claims.first_user_id FK was ON DELETE CASCADE, so deleting the
--    first-claiming user cascade-deleted that email's dedup ledger row and
--    re-opened the normalized email for a fresh 14-day trial. Purging an
--    abuser's account (the natural admin response) therefore undid the very
--    dedup it should reinforce. Changed to ON DELETE SET NULL so the claim
--    row (and thus the "this email already had its trial" fact) survives
--    account deletion.
--
-- 3. lhq_grant_signup_trial() wrapped its whole dedup block in
--    `if new.email is not null`, so a NULL-email signup (possible only if
--    phone/anonymous auth is ever enabled) skipped dedup and always got a
--    fresh trial. Reworked to a grant_trial flag that defaults false: no
--    email => no trial, and the trial is granted only when this user is the
--    first claimant of its normalized email. Same dedup semantics for the
--    normal email path, closes the null-email path.

-- ── PROD ─────────────────────────────────────────────────────────────────
revoke insert, update, delete, truncate on lhq_user_subscriptions from anon, authenticated;
revoke insert, update, delete, truncate on lhq_trial_claims from anon, authenticated;

alter table lhq_trial_claims alter column first_user_id drop not null;
alter table lhq_trial_claims drop constraint lhq_trial_claims_first_user_id_fkey;
alter table lhq_trial_claims add constraint lhq_trial_claims_first_user_id_fkey
  foreign key (first_user_id) references auth.users(id) on delete set null;

create or replace function lhq_grant_signup_trial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  norm_email  text;
  grant_trial boolean := false;
begin
  if new.email is not null then
    norm_email := lhq_normalize_trial_email(new.email);
    insert into lhq_trial_claims (normalized_email, first_user_id)
    values (norm_email, new.id)
    on conflict (normalized_email) do nothing;
    select (first_user_id = new.id) into grant_trial
      from lhq_trial_claims where normalized_email = norm_email;
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
-- revoke insert, update, delete, truncate on lhq_dev_user_subscriptions from anon, authenticated;
-- revoke insert, update, delete, truncate on lhq_dev_trial_claims from anon, authenticated;
-- alter table lhq_dev_trial_claims alter column first_user_id drop not null;
-- alter table lhq_dev_trial_claims drop constraint lhq_dev_trial_claims_first_user_id_fkey;
-- alter table lhq_dev_trial_claims add constraint lhq_dev_trial_claims_first_user_id_fkey
--   foreign key (first_user_id) references auth.users(id) on delete set null;
-- create or replace function lhq_dev_grant_signup_trial()
-- returns trigger language plpgsql security definer set search_path = public as $$
-- declare norm_email text; grant_trial boolean := false;
-- begin
--   if new.email is not null then
--     norm_email := lhq_dev_normalize_trial_email(new.email);
--     insert into lhq_dev_trial_claims (normalized_email, first_user_id)
--       values (norm_email, new.id) on conflict (normalized_email) do nothing;
--     select (first_user_id = new.id) into grant_trial
--       from lhq_dev_trial_claims where normalized_email = norm_email;
--   end if;
--   insert into lhq_dev_user_subscriptions (user_id, role, trial_ends_at, updated_at)
--   values (new.id, 'free', case when grant_trial then now() + interval '14 days' else null end, now())
--   on conflict (user_id) do nothing;
--   return new;
-- end; $$;
-- revoke execute on function lhq_dev_grant_signup_trial() from public;
