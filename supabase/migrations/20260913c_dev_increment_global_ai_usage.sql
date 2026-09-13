-- #1157. `increment_global_ai_usage` exists on prod but not on dev - confirmed
-- via pg_proc on both projects, not assumed from the advisor list. This was
-- deliberate when 20260805f_global_only_ai_usage_check.sql added it:
-- "Telegram alerts are prod-only right now (dev's webhook is unregistered)...
-- this only needs to exist in prod."
--
-- That premise no longer holds cleanly: this session ran
-- app/api/telegram/alert/route.ts against dev directly, multiple times,
-- for unrelated work (#1278/#1279, #1266's binance:45 diagnostic).
-- lib/aiUsage.ts's incrementGlobalUsage() fails open on a missing function
-- (console.error, returns true, commentary proceeds anyway) - so nothing
-- broke, but every dev-environment checkEMASignal run that reached this
-- code path has been silently logging
-- "[aiUsage] increment_global_ai_usage failed: ..." unnoticed until now.
--
-- Byte-identical to prod's function body (20260805f), except the table name:
-- dev's circuit-breaker table is lhq_dev_global_ai_usage (confirmed present,
-- 0 rows), matching this project's own lhq_dev_ prefix convention - prod's
-- version reads lhq_global_ai_usage, unprefixed, per that project's own
-- naming.
--
-- Dev only. Not applied anywhere by this commit - additive (CREATE OR
-- REPLACE, no drop), no app-code change needed (lib/aiUsage.ts's call site
-- is already source-agnostic, same RPC name on both projects).

create or replace function increment_global_ai_usage(
  p_date         date,
  p_global_limit int
) returns int
language plpgsql
as $$
declare
  v_global int;
begin
  insert into lhq_dev_global_ai_usage (date, xai_call_count, updated_at)
  values (p_date, 0, now())
  on conflict (date) do nothing;

  update lhq_dev_global_ai_usage
    set xai_call_count = xai_call_count + 1, updated_at = now()
    where date = p_date and xai_call_count < p_global_limit
    returning xai_call_count into v_global;

  if v_global is not null then
    return v_global;
  end if;

  return -1; -- cap hit, distinct from a real (never-negative) count
end;
$$;

-- Same as prod's grant shape (20260805f) - service-role only, no anon/
-- authenticated access wanted or needed.
revoke execute on function increment_global_ai_usage(date, int) from public;
