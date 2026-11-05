-- Two payments arriving together lose a period: the grant reads, computes, then writes.
--
-- ⚠️ **NOT APPLIED. PENDING QA REVIEW, THEN THE OWNER'S APPROVAL.** Writes to the shared database.
--
-- ── THE RACE ────────────────────────────────────────────────────────────────────────────────────
--
-- `grantToAccount` (lib/whopGrant.ts) does three things in sequence:
--
--   1. SELECT `current_period_end`
--   2. compute `extendedPeriodEnd(stored, now, add)` in JS
--   3. UPSERT the computed value
--
-- Two payments for the same account that interleave between 1 and 3 both read the SAME stored end,
-- both compute the SAME new end, and the second write overwrites the first with an identical value.
-- **The customer paid twice and got one period.** Nothing errors, nothing logs, and the row looks
-- correct afterwards - which is why this needs a database-side fix rather than a retry.
--
-- Whop can deliver a renewal and a plan change seconds apart, and its webhooks retry, so two
-- in-flight grants for one account is a normal event rather than a theoretical one.
--
-- ── WHY A FUNCTION AND NOT A SMARTER UPSERT IN THE CLIENT ───────────────────────────────────────
--
-- The extension has to read the row it is writing. `INSERT ... ON CONFLICT DO UPDATE` can do that -
-- `EXCLUDED` and the existing row are both in scope - so the whole operation becomes one statement
-- and Postgres's row lock serialises concurrent callers. That is the same mechanism
-- `increment_ai_usage` already uses for the usage counters, and for the same reason.
--
-- ── THE PART THAT IS EASY TO GET WRONG, AND IT WOULD HAVE UNDONE #2001 ─────────────────────────
--
-- **`base + interval '1 month'` CLAMPS in Postgres.** Jan 31 + 1 month is Feb 28. That is exactly
-- the behaviour #2001 removed from `addPeriod` hours ago, because the clamp was permanent and cost
-- a buyer on the 29th-31st one to two days of paid access every cycle.
--
-- So writing this the obvious way would have reintroduced the defect in SQL **and** split the two
-- code paths: the same payment would produce a different end date depending on whether the JS or
-- the SQL ran. Measured against the JS on prod, read-only, before this file was written:
--
--     base          months   JS (addPeriod)   `+ interval`     this function
--     2026-01-31         1   2026-03-03       2026-02-28  ✗    2026-03-03  ✓
--     2028-01-31         1   2028-03-02       2028-02-29  ✗    2028-03-02  ✓
--     2028-02-29        12   2029-03-01       2029-02-28  ✗    2029-03-01  ✓
--     2026-01-28         1   2026-02-28       2026-02-28  ✓    2026-02-28  ✓
--     2026-01-15         1   2026-02-15       2026-02-15  ✓    2026-02-15  ✓
--
-- `lhq_add_period` below reproduces the JS exactly: step back to the 1st of the month keeping the
-- time, add the months (the 1st exists in every month, so this never clamps), then add the original
-- day back, which overflows into the next month when the target is short. That is
-- `setUTCDate(1); setUTCMonth(+n); setUTCDate(day)`, which is what `addPeriod` does.
--
-- **UTC EXPLICITLY, NOT THE SESSION'S TimeZone - IN TWO PLACES.** `extract(day from ...)` on a
-- `timestamptz` depends on the session setting, and the JS uses `getUTCDate`. A session in
-- Asia/Manila would extract a different day for a late-evening UTC timestamp and the two paths
-- would disagree by a day for exactly the accounts this fix is about.
--
-- **AND THE INTERVAL ADDITION ITSELF, which is QA's catch on #2009 and is a second mechanism.**
-- `timestamptz + interval '1 month'` is resolved by converting to the session zone, adding to the
-- LOCAL date, and converting back - so a DST boundary inside the added month shifts the result by
-- an hour. Measured: adding one month to 2026-02-14T20:00Z gives 2026-03-14T20:00Z under UTC and
-- Asia/Manila, and **2026-03-14T19:00Z under America/New_York**, which crosses US DST.
--
-- Our sessions are UTC today, so this is not a live divergence - but it made the `IMMUTABLE`
-- marking on `lhq_add_period` a false claim, since the result depended on a session setting. Every
-- function here now carries `SET TimeZone TO 'UTC'` beside its `search_path`, which pins the
-- arithmetic and makes IMMUTABLE honest. A function with a `SET` clause is never inlined, which is
-- the small cost of saying what we mean.
--
-- ── THE ADMIN-GRANT GUARD IS KEPT, AND IT IS NOT THE RACE ──────────────────────────────────────
--
-- An admin grant is `role = 'pro'` with no end date and no processor, and a payment must not turn
-- it into a time-limited one. The JS checked that after its read; the check is now inside the
-- function, in the same statement's transaction, and the caller is told `admin_grant` so it can
-- route the event to review exactly as it does today.
--
-- This is deliberately a guard rather than part of the conflict target: the state it tests is
-- changed only by an admin, not by a concurrent payment, so it is not the race being fixed here.
--
-- ── `plan` IS STILL OPTIONAL ───────────────────────────────────────────────────────────────────
--
-- Migration 20261001h added it and the client carries a retry for a database that does not have it
-- yet - "paid and not Pro" being the failure to avoid. The column exists on both projects today
-- (checked), so this function writes it directly; `coalesce` keeps an existing plan when a caller
-- passes null rather than blanking it.
--
-- ── VERIFY, AFTER APPLYING ─────────────────────────────────────────────────────────────────────
--
--   -- matches the JS on all five cases above
--   SELECT lhq_add_period('2026-01-31T10:00:00Z'::timestamptz, 1, 0);   -- 2026-03-03
--   SELECT lhq_add_period('2028-02-29T10:00:00Z'::timestamptz, 12, 0);  -- 2029-03-01
--   SELECT lhq_add_period('2026-12-15T10:00:00Z'::timestamptz, 0, 14);  -- 2026-12-29
--
--   -- two grants in a row extend TWICE rather than landing on the same date
--   SELECT * FROM lhq_extend_subscription('<uuid>', 1, 0, 'monthly', 'whop', now());
--   SELECT * FROM lhq_extend_subscription('<uuid>', 1, 0, 'monthly', 'whop', now());
--   -- the second period_end must be one month later than the first, not equal to it

-- ════════════════════════════════════════════════════════════════════════════
-- PROD  (qdpwhnvmhqgzijuwopso, lhq_)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

/* The JS `addPeriod`, in SQL. IMMUTABLE so it can be used in an index or a generated column later,
   and so the planner may fold it. */
CREATE OR REPLACE FUNCTION public.lhq_add_period(p_base timestamptz, p_months int, p_days int)
 RETURNS timestamptz
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
 SET TimeZone TO 'UTC'
AS $function$
  SELECT CASE
    WHEN coalesce(p_months, 0) = 0 THEN p_base
    ELSE
      /* to the 1st keeping the time -> add months (never clamps) -> add the day back (overflows) */
      p_base
      - ((extract(day from p_base AT TIME ZONE 'UTC')::int - 1) || ' days')::interval
      + (p_months || ' months')::interval
      + ((extract(day from p_base AT TIME ZONE 'UTC')::int - 1) || ' days')::interval
  END
  + (coalesce(p_days, 0) || ' days')::interval;
$function$;

revoke all on function public.lhq_add_period(timestamptz, int, int) from public;
revoke all on function public.lhq_add_period(timestamptz, int, int) from anon;
revoke all on function public.lhq_add_period(timestamptz, int, int) from authenticated;
grant execute on function public.lhq_add_period(timestamptz, int, int) to service_role;

CREATE OR REPLACE FUNCTION public.lhq_extend_subscription(
  p_user_id uuid, p_months int, p_days int, p_plan text, p_provider text, p_now timestamptz
) RETURNS TABLE (outcome text, period_end timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET TimeZone TO 'UTC'
AS $function$
begin
  /* An admin grant is not time-limited and a payment must not make it so. Same condition the JS
     checked after its read; here it is inside the statement's transaction. */
  if exists (
    select 1 from lhq_user_subscriptions
    where user_id = p_user_id
      and role = 'pro'
      and current_period_end is null
      and billing_provider is null
  ) then
    return query select 'admin_grant'::text, null::timestamptz;
    return;
  end if;

  /* ONE STATEMENT. The conflict branch reads the row it is updating, so two concurrent callers
     serialise on its row lock and each one extends from the other's result instead of both
     extending from the same stale read. `greatest(stored, p_now)` keeps a renewal from losing days
     already paid for and counts a lapsed account from now - the rule `extendedPeriodEnd`
     documented, moved to where it can be applied atomically. */
  return query
  insert into lhq_user_subscriptions as s
    (user_id, role, current_period_end, billing_provider, plan, updated_at)
  values
    (p_user_id, 'pro', lhq_add_period(p_now, p_months, p_days), p_provider, p_plan, p_now)
  on conflict (user_id) do update set
    role = 'pro',
    current_period_end = lhq_add_period(
      greatest(coalesce(s.current_period_end, p_now), p_now), p_months, p_days
    ),
    billing_provider = p_provider,
    plan = coalesce(p_plan, s.plan),
    updated_at = p_now
  returning 'granted'::text, s.current_period_end;
end;
$function$;

revoke all on function public.lhq_extend_subscription(uuid, int, int, text, text, timestamptz) from public;
revoke all on function public.lhq_extend_subscription(uuid, int, int, text, text, timestamptz) from anon;
revoke all on function public.lhq_extend_subscription(uuid, int, int, text, text, timestamptz) from authenticated;
grant execute on function public.lhq_extend_subscription(uuid, int, int, text, text, timestamptz) to service_role;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- DEV  (wdtjhrilakoitfcezxpx, lhq_dev_)
-- Identical, against the dev table. `qa` and `staging` share this project.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.lhq_dev_add_period(p_base timestamptz, p_months int, p_days int)
 RETURNS timestamptz
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
 SET TimeZone TO 'UTC'
AS $function$
  SELECT CASE
    WHEN coalesce(p_months, 0) = 0 THEN p_base
    ELSE
      p_base
      - ((extract(day from p_base AT TIME ZONE 'UTC')::int - 1) || ' days')::interval
      + (p_months || ' months')::interval
      + ((extract(day from p_base AT TIME ZONE 'UTC')::int - 1) || ' days')::interval
  END
  + (coalesce(p_days, 0) || ' days')::interval;
$function$;

revoke all on function public.lhq_dev_add_period(timestamptz, int, int) from public;
revoke all on function public.lhq_dev_add_period(timestamptz, int, int) from anon;
revoke all on function public.lhq_dev_add_period(timestamptz, int, int) from authenticated;
grant execute on function public.lhq_dev_add_period(timestamptz, int, int) to service_role;

CREATE OR REPLACE FUNCTION public.lhq_dev_extend_subscription(
  p_user_id uuid, p_months int, p_days int, p_plan text, p_provider text, p_now timestamptz
) RETURNS TABLE (outcome text, period_end timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET TimeZone TO 'UTC'
AS $function$
begin
  if exists (
    select 1 from lhq_dev_user_subscriptions
    where user_id = p_user_id
      and role = 'pro'
      and current_period_end is null
      and billing_provider is null
  ) then
    return query select 'admin_grant'::text, null::timestamptz;
    return;
  end if;

  return query
  insert into lhq_dev_user_subscriptions as s
    (user_id, role, current_period_end, billing_provider, plan, updated_at)
  values
    (p_user_id, 'pro', lhq_dev_add_period(p_now, p_months, p_days), p_provider, p_plan, p_now)
  on conflict (user_id) do update set
    role = 'pro',
    current_period_end = lhq_dev_add_period(
      greatest(coalesce(s.current_period_end, p_now), p_now), p_months, p_days
    ),
    billing_provider = p_provider,
    plan = coalesce(p_plan, s.plan),
    updated_at = p_now
  returning 'granted'::text, s.current_period_end;
end;
$function$;

revoke all on function public.lhq_dev_extend_subscription(uuid, int, int, text, text, timestamptz) from public;
revoke all on function public.lhq_dev_extend_subscription(uuid, int, int, text, text, timestamptz) from anon;
revoke all on function public.lhq_dev_extend_subscription(uuid, int, int, text, text, timestamptz) from authenticated;
grant execute on function public.lhq_dev_extend_subscription(uuid, int, int, text, text, timestamptz) to service_role;

COMMIT;

-- ── THE CLIENT CHANGE IS NOT IN THIS FILE, DELIBERATELY ────────────────────────────────────────
--
-- `lib/whopGrant.ts` keeps its read-compute-write until this function exists on the environment it
-- runs against, because a route calling a function that is not there fails every grant - "paid and
-- not Pro", the failure the `plan` retry exists to avoid. The switch lands in its own PR once this
-- is applied, and that PR is where `grantToAccount` becomes a single `rpc('lhq_extend_subscription')`
-- call that maps `admin_grant` to the existing review path.
