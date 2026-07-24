-- Global-only xAI usage check, for call sites with no natural per-user
-- attribution. increment_ai_usage() (20260805a) needs a real per-user row in
-- lhq_grok_usage to do its atomic check-and-increment - that fits every
-- signed-in-user route, but not app/api/telegram/alert/route.ts's
-- checkEMASignal, which sends ONE shared commentary call per confirmed
-- signal, fanned out to however many recipients want it. There's no single
-- "user" to attribute that call to, so this adds a second, simpler function
-- that only touches lhq_global_ai_usage (already created in
-- 20260805a_global_ai_circuit_breaker.sql) - same atomic check-and-increment
-- shape, same -1-means-blocked sentinel, no per-user table involved at all.
--
-- Telegram alerts are prod-only right now (dev's webhook is unregistered -
-- see pendings/PENDING.md), so this only needs to exist in prod
-- (qdpwhnvmhqgzijuwopso). Run there.

create or replace function increment_global_ai_usage(
  p_date         date,
  p_global_limit int
) returns int
language plpgsql
as $$
declare
  v_global int;
begin
  insert into lhq_global_ai_usage (date, xai_call_count, updated_at)
  values (p_date, 0, now())
  on conflict (date) do nothing;

  update lhq_global_ai_usage
    set xai_call_count = xai_call_count + 1, updated_at = now()
    where date = p_date and xai_call_count < p_global_limit
    returning xai_call_count into v_global;

  if v_global is not null then
    return v_global;
  end if;

  return -1; -- cap hit, distinct from a real (never-negative) count
end;
$$;

-- Only ever called via the service-role admin client from the cron itself -
-- no anon/authenticated grant needed or wanted (see
-- feedback/project_lhq_definer_fn_revoke: revoke from PUBLIC, not just the
-- client-facing roles, or the advisor keeps flagging it).
revoke execute on function increment_global_ai_usage(date, int) from public;
