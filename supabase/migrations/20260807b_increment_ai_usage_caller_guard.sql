-- increment_ai_usage() trusted its p_user_id argument completely. It is
-- SECURITY DEFINER and `authenticated` holds EXECUTE, so any signed-in account
-- could call it over /rest/v1/rpc/ with somebody ELSE's user id and burn down
-- their daily AI quota. Proven live against prod before this fix: with
-- request.jwt.claims.sub set to an unrelated uuid, the call still incremented
-- the victim's row and returned 1.
--
-- Note this is NOT covered by 20260807a's grant revokes - being SECURITY
-- DEFINER, the function runs as postgres and sails straight past table grants.
-- That is the whole point of it, and also why it needs its own check.
--
-- Implemented as a rename + thin wrapper rather than a CREATE OR REPLACE of
-- the whole thing. The body is ~150 lines of per-column branching that is
-- correct and well-tested; retyping it to insert four lines at the top is pure
-- transcription risk for no benefit. The wrapper keeps the original body
-- byte-identical under a new name and adds only the guard.
--
-- auth.uid() is null for service_role (the ops/cron path) and the check is
-- skipped there deliberately - anon does not hold EXECUTE, so a null uid can
-- only mean a trusted server-side caller. Every app caller passes a user id it
-- derived server-side from a verified token (lib/aiUsage.ts, and all 14 routes
-- behind it), so no legitimate call is affected.
--
-- Same statements run against both projects: the function is named
-- increment_ai_usage on prod and dev alike (only the tables it writes differ).

alter function increment_ai_usage(uuid, date, text, integer, integer, integer)
  rename to increment_ai_usage_impl;

create function increment_ai_usage(
  p_user_id      uuid,
  p_date         date,
  p_column       text,
  p_limit        integer,
  p_global_limit integer default null,
  p_pool_limit   integer default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'increment_ai_usage: caller may only increment their own usage'
      using errcode = '42501';
  end if;

  return increment_ai_usage_impl(
    p_user_id, p_date, p_column, p_limit, p_global_limit, p_pool_limit
  );
end;
$$;

-- The implementation is reachable only through the guarded wrapper.
revoke execute on function
  increment_ai_usage_impl(uuid, date, text, integer, integer, integer)
  from anon, authenticated, public;

-- Restore the grants the original carried (a fresh function gets Supabase's
-- defaults, which include anon - not wanted here).
revoke execute on function
  increment_ai_usage(uuid, date, text, integer, integer, integer)
  from anon, public;

grant execute on function
  increment_ai_usage(uuid, date, text, integer, integer, integer)
  to authenticated, service_role;
