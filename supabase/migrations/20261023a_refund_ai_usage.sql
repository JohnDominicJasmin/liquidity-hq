-- #1631 / PM's finding, 2026-10-22: a Deep read that is REFUSED before the user sees anything still consumed the user's quota.
-- Two 502 BAD_ANSWER responses took deep_used from 1 to 2 and returned nothing. A paying customer gets an error and loses a read.
--
-- The increment is a reservation taken BEFORE the xAI call (closing a TOCTOU race between concurrent requests), so the fix is not to
-- bill later - it is to give the reservation back when the answer never reaches the user. This function is that refund.
--
-- TWO SECTIONS, PROD AND DEV, WITH THE REAL TABLE NAMES. The first version of this file hardcoded `lhq_grok_usage` everywhere and
-- told the operator to "run this file as-is" against the dev project. **There is no `lhq_grok_usage` on dev.** `lib/tables.ts:3`
-- prefixes every table per environment - `lhq_dev_` on dev, `lhq_` on prod - so the dev table is `lhq_dev_grok_usage`. Run as
-- instructed, the first statement would have failed (`add column if not exists` guards a missing COLUMN, not a missing TABLE),
-- nothing after it would exist, and the app's PGRST202/42883 tolerance in lib/aiUsage.ts would have swallowed the absence silently:
-- a refund that looks applied and is inert. Caught by QA reading this SQL against the dev catalogue rather than against itself.
--
-- SHAPE FOLLOWS increment_ai_usage for security definer and the fixed search_path - but NOT for its caller guard or its grants,
-- and that difference is the whole security of this function. increment_ai_usage may be called by `authenticated` because the worst
-- a user can do with it is spend quota they already have. A REFUND called by a user is free quota: loop it and the counter never
-- rises. So this one is service_role only, and refuses any call carrying an auth.uid() at all.
--
-- NEVER BELOW ZERO: greatest(col - 1, 0). A double-refund - a retry, or two code paths both refunding - must not mint quota.
-- Returns the new count, or null when there is no row for that day, or when the daily refund cap is already reached.
--
-- CAPPED AT 3 A DAY, IN ONE STATEMENT. Without a cap the refund removes the only ceiling on OUR xAI spend: a user who can reliably
-- produce an unparseable answer loops prompt -> refusal -> refund and calls xAI forever at our cost. The predicate lives inside the
-- UPDATE so the statement that tests the row is the one that locks it - a select-then-update version lets two concurrent refusals
-- both read 2, both pass and both refund, which is the cap failing exactly when it is being attacked.
--
-- NOT APPLIED. Production writes need the owner's word. The dev section is commented out and applies only in QA's DDL window - this
-- is DDL on the Supabase project that dev, qa AND staging share, so a bad five minutes is three environments.
--
-- VERIFY AFTER APPLYING, per project, do not assume:
--   select routine_name from information_schema.routines where routine_name like 'refund_ai_usage%';   -- expect 2
--   select column_name  from information_schema.columns  where table_name = '<the project's grok_usage table>'
--                                                          and column_name = 'refund_count';            -- expect 1

-- ─────────────────────────────────────────────────────────────────────────────
-- PROD  (qdpwhnvmhqgzijuwopso)  - table lhq_grok_usage
-- ─────────────────────────────────────────────────────────────────────────────

alter table lhq_grok_usage add column if not exists refund_count integer not null default 0;

create or replace function refund_ai_usage_impl(
  p_user_id uuid,
  p_date    date,
  p_column  text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new integer;
begin
  if p_column not in ('deep_count', 'quick_count', 'chat_count', 'search_count', 'briefing_count') then
    raise exception 'refund_ai_usage: unknown column %', p_column using errcode = '22023';
  end if;

  execute format(
    'update lhq_grok_usage set %I = greatest(%I - 1, 0), refund_count = coalesce(refund_count, 0) + 1, updated_at = now() '
    'where user_id = $1 and date = $2 and coalesce(refund_count, 0) < 3 returning %I',
    p_column, p_column, p_column
  ) into v_new using p_user_id, p_date;

  if v_new is null then
    raise notice 'refund_ai_usage: no refund for % on % (no row, or the daily refund cap is reached)', p_user_id, p_date;
  end if;

  return v_new;
end;
$$;

create or replace function refund_ai_usage(
  p_user_id uuid,
  p_date    date,
  p_column  text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  -- SERVER ONLY. Not "may only refund their own row" - that guard is right for an increment and WRONG here. A signed-in user who
  -- can call this on their own row can hand themselves unlimited quota. service_role carries no auth.uid(), so a non-null uid
  -- means the call came from a browser session and is refused outright.
  if auth.uid() is not null then
    raise exception 'refund_ai_usage: server-side only'
      using errcode = '42501';
  end if;

  return refund_ai_usage_impl(p_user_id, p_date, p_column);
end;
$$;

revoke execute on function refund_ai_usage_impl(uuid, date, text) from anon, authenticated, public;
-- NOT granted to `authenticated`, unlike increment_ai_usage. Symmetry between a function that SPENDS quota and one that RESTORES
-- it is exactly wrong. Only the server, which holds service_role, ever refunds.
revoke execute on function refund_ai_usage(uuid, date, text) from anon, authenticated, public;
grant  execute on function refund_ai_usage(uuid, date, text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- DEV  (wdtjhrilakoitfcezxpx)  - table lhq_dev_grok_usage
--
-- The SAME definitions with the dev table name. Uncomment and run this half
-- against the dev project; do NOT run the prod half there, and do not hand-edit
-- the statements at the prompt - a statement edited at apply time is not the
-- statement that was reviewed.
-- ─────────────────────────────────────────────────────────────────────────────

-- alter table lhq_dev_grok_usage add column if not exists refund_count integer not null default 0;
--
-- create or replace function refund_ai_usage_impl(
--   p_user_id uuid,
--   p_date    date,
--   p_column  text
-- ) returns integer
-- language plpgsql
-- security definer
-- set search_path = public
-- as $$
-- declare
--   v_new integer;
-- begin
--   if p_column not in ('deep_count', 'quick_count', 'chat_count', 'search_count', 'briefing_count') then
--     raise exception 'refund_ai_usage: unknown column %', p_column using errcode = '22023';
--   end if;
--
--   execute format(
--     'update lhq_dev_grok_usage set %I = greatest(%I - 1, 0), refund_count = coalesce(refund_count, 0) + 1, updated_at = now() '
--     'where user_id = $1 and date = $2 and coalesce(refund_count, 0) < 3 returning %I',
--     p_column, p_column, p_column
--   ) into v_new using p_user_id, p_date;
--
--   if v_new is null then
--     raise notice 'refund_ai_usage: no refund for % on % (no row, or the daily refund cap is reached)', p_user_id, p_date;
--   end if;
--
--   return v_new;
-- end;
-- $$;
--
-- create or replace function refund_ai_usage(
--   p_user_id uuid,
--   p_date    date,
--   p_column  text
-- ) returns integer
-- language plpgsql
-- security definer
-- set search_path = public
-- as $$
-- begin
--   if auth.uid() is not null then
--     raise exception 'refund_ai_usage: server-side only'
--       using errcode = '42501';
--   end if;
--
--   return refund_ai_usage_impl(p_user_id, p_date, p_column);
-- end;
-- $$;
--
-- revoke execute on function refund_ai_usage_impl(uuid, date, text) from anon, authenticated, public;
-- revoke execute on function refund_ai_usage(uuid, date, text) from anon, authenticated, public;
-- grant  execute on function refund_ai_usage(uuid, date, text) to service_role;
