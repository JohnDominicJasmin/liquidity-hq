-- #1631 / PM's finding, 2026-10-22: a Deep read that is REFUSED before the user sees anything still consumed the user's quota.
-- Two 502 BAD_ANSWER responses took deep_used from 1 to 2 and returned nothing. A paying customer gets an error and loses a read.
--
-- The increment is a reservation taken BEFORE the xAI call (closing a TOCTOU race between concurrent requests), so the fix is not to
-- bill later - it is to give the reservation back when the answer never reaches the user. This function is that refund.
--
-- SHAPE COPIED FROM increment_ai_usage DELIBERATELY: same caller guard (a signed-in caller may only touch their own row), same
-- security definer + fixed search_path, same grant set. A refund that could be aimed at another user's row would be a way to hand
-- someone else free quota.
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
    'update lhq_grok_usage set %I = greatest(%I - 1, 0), updated_at = now() where user_id = $1 and date = $2 returning %I',
    p_column, p_column, p_column
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
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'refund_ai_usage: caller may only refund their own usage'
      using errcode = '42501';
  end if;

  return refund_ai_usage_impl(p_user_id, p_date, p_column);
end;
$$;

revoke execute on function refund_ai_usage_impl(uuid, date, text) from anon, authenticated, public;
revoke execute on function refund_ai_usage(uuid, date, text) from anon, public;
grant  execute on function refund_ai_usage(uuid, date, text) to authenticated, service_role;

-- DEV: the same, against the dev project.
--
-- (identical statements - run this file as-is against wdtjhrilakoitfcezxpx)
