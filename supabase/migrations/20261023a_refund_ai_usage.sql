-- #1631 / PM's finding, 2026-10-22: a Deep read that is REFUSED before the user sees anything still consumed the user's quota.
-- Two 502 BAD_ANSWER responses took deep_used from 1 to 2 and returned nothing. A paying customer gets an error and loses a read.
--
-- The increment is a reservation taken BEFORE the xAI call (closing a TOCTOU race between concurrent requests), so the fix is not to
-- bill later - it is to give the reservation back when the answer never reaches the user. This function is that refund.
--
-- SHAPE FOLLOWS increment_ai_usage for security definer and the fixed search_path - but NOT for its caller guard or its grants,
-- and that difference is the whole security of this function. increment_ai_usage may be called by `authenticated` because the worst
-- a user can do with it is spend quota they already have. A REFUND called by a user is free quota: loop it and the counter never
-- rises. So this one is service_role only, and refuses any call carrying an auth.uid() at all.
--
-- NEVER BELOW ZERO: greatest(col - 1, 0). A double-refund - a retry, or two code paths both refunding - must not mint quota.
-- Returns the new count, or null when there is no row for that day (nothing was spent, so nothing is owed).
-- Table is lhq_grok_usage keyed (user_id, date) - the same row increment_ai_usage_impl writes, checked rather than assumed.
--
-- NOT APPLIED. Production writes need the owner's word; the dev section is commented out (apply to dev only when QA says no test pass
-- is running). Run against BOTH the prod project (qdpwhnvmhqgzijuwopso) and the dev project (wdtjhrilakoitfcezxpx).
--
-- THE APP TOLERATES ITS ABSENCE ON PURPOSE: lib/aiUsage.ts calls this through rpc() and treats "function does not exist" (42883 /
-- PGRST202) as "no refund available", logging once rather than failing the request. So the code ships safely before this is applied,
-- and starts refunding the moment it is - which is the only ordering that does not make the fix itself an outage.

-- The counter the cap reads. Additive and nullable, so an existing row is unaffected until it refunds for the first time.
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
  v_new     integer;
  v_refunds integer;
begin
  if p_column not in ('deep_count', 'quick_count', 'chat_count', 'search_count', 'briefing_count') then
    raise exception 'refund_ai_usage: unknown column %', p_column using errcode = '22023';
  end if;

  -- CAPPED AT 3 A DAY, and the cap is the point. Without it the refund removes the only ceiling on OUR xAI spend: a user who can
  -- reliably produce an unparseable answer loops prompt -> refusal -> refund and calls xAI forever at our cost, while their own
  -- counter never moves. Flagged by the automated security review. Three covers the honest case - a genuinely broken day for one
  -- user - and stops the loop. Beyond it the refusal still costs them a read, which is the pre-existing behaviour, not a new harm.
  select coalesce(refund_count, 0) into v_refunds
    from lhq_grok_usage where user_id = p_user_id and date = p_date;
  if v_refunds >= 3 then
    raise notice 'refund_ai_usage: daily refund cap reached for %', p_user_id;
    return null;
  end if;

  execute format(
    'update lhq_grok_usage set %I = greatest(%I - 1, 0), refund_count = coalesce(refund_count, 0) + 1, updated_at = now() '
    'where user_id = $1 and date = $2 returning %I',
    p_column, p_column
  ) into v_new using p_user_id, p_date;

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
  -- can call this on their own row can hand themselves unlimited quota: call it in a loop and deep_count never leaves zero. The
  -- increment is safe to expose because the worst a user can do with it is spend what they already have.
  -- service_role carries no auth.uid(), so a non-null uid means the call came from a browser session and is refused outright.
  if auth.uid() is not null then
    raise exception 'refund_ai_usage: server-side only'
      using errcode = '42501';
  end if;

  return refund_ai_usage_impl(p_user_id, p_date, p_column);
end;
$$;

revoke execute on function refund_ai_usage_impl(uuid, date, text) from anon, authenticated, public;
-- NOT granted to `authenticated`, unlike increment_ai_usage. Flagged by the automated security review, and it was right: I had
-- copied the increment's grant set for symmetry, and symmetry is exactly wrong between a function that SPENDS quota and one that
-- RESTORES it. Only the server, which holds service_role, ever refunds.
revoke execute on function refund_ai_usage(uuid, date, text) from anon, authenticated, public;
grant  execute on function refund_ai_usage(uuid, date, text) to service_role;

-- DEV: the same, against the dev project.
--
-- (identical statements - run this file as-is against wdtjhrilakoitfcezxpx)
