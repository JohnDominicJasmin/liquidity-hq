-- Global daily circuit breaker for xAI spend. Per-user caps (increment_ai_usage)
-- stop one account from looping, but nothing stopped a FLEET of accounts each
-- staying under their own cap - e.g. 500 farmed accounts x 5 calls/day each is
-- still 2500 calls, and no single account looks abusive. This adds one
-- app-wide counter: once today's total xAI calls hit AI_GLOBAL_DAILY_MAX (env,
-- read in lib/aiUsage.ts), EVERY route blocks regardless of who's asking.
--
-- Design: increment_ai_usage() already does the per-user atomic
-- check-and-increment. This adds an optional p_global_limit param - when
-- passed, the SAME function call also atomically checks-and-increments a
-- global per-day counter, all in one transaction. If the global check fails,
-- the per-user increment just made is undone (compensating UPDATE) so a
-- request that never actually reaches xAI doesn't consume the user's own
-- quota. Returns -1 (a normal count is never negative) to signal
-- "blocked by the global cap" distinctly from NULL ("blocked by the
-- per-user cap") - lib/aiUsage.ts logs this distinctly server-side so a trip
-- is visible in logs even though the client just sees the same generic
-- rate-limit response.
--
-- Run the PROD block below in qdpwhnvmhqgzijuwopso, the DEV block (commented)
-- in wdtjhrilakoitfcezxpx.

-- ── PROD ─────────────────────────────────────────────────────────────────
create table if not exists lhq_global_ai_usage (
  date            date primary key,
  xai_call_count  int not null default 0,
  updated_at      timestamptz not null default now()
);

alter table lhq_global_ai_usage enable row level security;
-- No policies - only ever touched by increment_ai_usage() below (SECURITY
-- INVOKER, called via the same per-user-scoped client as everything else);
-- no direct client access needed or granted.
revoke insert, update, delete, truncate on lhq_global_ai_usage from anon, authenticated;

-- CREATE OR REPLACE with a different parameter list creates a SECOND
-- overloaded function rather than replacing the old one - drop the old
-- 4-param signature explicitly so there's no longer a callable path that
-- skips the global check.
drop function if exists increment_ai_usage(uuid, date, text, int);

create or replace function increment_ai_usage(
  p_user_id      uuid,
  p_date         date,
  p_column       text,
  p_limit        int,
  p_global_limit int default null
) returns int
language plpgsql
as $$
declare
  v_new    int;
  v_global int;
begin
  insert into lhq_grok_usage (user_id, date, updated_at)
  values (p_user_id, p_date, now())
  on conflict (user_id, date) do nothing;

  if p_column = 'deep_count' then
    update lhq_grok_usage set deep_count = deep_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and deep_count < p_limit
      returning deep_count into v_new;
  elsif p_column = 'quick_count' then
    update lhq_grok_usage set quick_count = quick_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and quick_count < p_limit
      returning quick_count into v_new;
  elsif p_column = 'chat_count' then
    update lhq_grok_usage set chat_count = chat_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and chat_count < p_limit
      returning chat_count into v_new;
  elsif p_column = 'chat_search_count' then
    update lhq_grok_usage set chat_search_count = chat_search_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and chat_search_count < p_limit
      returning chat_search_count into v_new;
  elsif p_column = 'briefing_count' then
    update lhq_grok_usage set briefing_count = briefing_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and briefing_count < p_limit
      returning briefing_count into v_new;
  elsif p_column = 'thesis_check_count' then
    update lhq_grok_usage set thesis_check_count = thesis_check_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and thesis_check_count < p_limit
      returning thesis_check_count into v_new;
  elsif p_column = 'strategy_research_count' then
    update lhq_grok_usage set strategy_research_count = strategy_research_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and strategy_research_count < p_limit
      returning strategy_research_count into v_new;
  elsif p_column = 'shadow_account_count' then
    update lhq_grok_usage set shadow_account_count = shadow_account_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and shadow_account_count < p_limit
      returning shadow_account_count into v_new;
  elsif p_column = 'behavioral_bias_count' then
    update lhq_grok_usage set behavioral_bias_count = behavioral_bias_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and behavioral_bias_count < p_limit
      returning behavioral_bias_count into v_new;
  elsif p_column = 'pine_script_count' then
    update lhq_grok_usage set pine_script_count = pine_script_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and pine_script_count < p_limit
      returning pine_script_count into v_new;
  elsif p_column = 'hypothesis_analyze_count' then
    update lhq_grok_usage set hypothesis_analyze_count = hypothesis_analyze_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and hypothesis_analyze_count < p_limit
      returning hypothesis_analyze_count into v_new;
  elsif p_column = 'token_unlock_count' then
    update lhq_grok_usage set token_unlock_count = token_unlock_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and token_unlock_count < p_limit
      returning token_unlock_count into v_new;
  elsif p_column = 'smc_snapshot_count' then
    update lhq_grok_usage set smc_snapshot_count = smc_snapshot_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and smc_snapshot_count < p_limit
      returning smc_snapshot_count into v_new;
  else
    raise exception 'increment_ai_usage: invalid column %', p_column;
  end if;

  if v_new is null then
    return null; -- per-user cap already hit, never touch the global counter
  end if;

  if p_global_limit is null then
    return v_new; -- global breaker disabled (no limit passed)
  end if;

  insert into lhq_global_ai_usage (date, xai_call_count, updated_at)
  values (p_date, 0, now())
  on conflict (date) do nothing;

  update lhq_global_ai_usage
    set xai_call_count = xai_call_count + 1, updated_at = now()
    where date = p_date and xai_call_count < p_global_limit
    returning xai_call_count into v_global;

  if v_global is not null then
    return v_new; -- both per-user and global checks passed
  end if;

  -- Global cap hit: undo the per-user increment we just made so this
  -- never-actually-made call doesn't consume the user's own daily quota.
  if p_column = 'deep_count' then
    update lhq_grok_usage set deep_count = deep_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'quick_count' then
    update lhq_grok_usage set quick_count = quick_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'chat_count' then
    update lhq_grok_usage set chat_count = chat_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'chat_search_count' then
    update lhq_grok_usage set chat_search_count = chat_search_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'briefing_count' then
    update lhq_grok_usage set briefing_count = briefing_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'thesis_check_count' then
    update lhq_grok_usage set thesis_check_count = thesis_check_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'strategy_research_count' then
    update lhq_grok_usage set strategy_research_count = strategy_research_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'shadow_account_count' then
    update lhq_grok_usage set shadow_account_count = shadow_account_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'behavioral_bias_count' then
    update lhq_grok_usage set behavioral_bias_count = behavioral_bias_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'pine_script_count' then
    update lhq_grok_usage set pine_script_count = pine_script_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'hypothesis_analyze_count' then
    update lhq_grok_usage set hypothesis_analyze_count = hypothesis_analyze_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'token_unlock_count' then
    update lhq_grok_usage set token_unlock_count = token_unlock_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'smc_snapshot_count' then
    update lhq_grok_usage set smc_snapshot_count = smc_snapshot_count - 1 where user_id = p_user_id and date = p_date;
  end if;

  return -1; -- distinct sentinel: blocked by the GLOBAL cap, not the user's own
end;
$$;

revoke execute on function increment_ai_usage(uuid, date, text, int, int) from public;
grant execute on function increment_ai_usage(uuid, date, text, int, int) to authenticated;

-- ── DEV (lhq_dev_ prefix) - run separately against the dev project ─────────
-- create table if not exists lhq_dev_global_ai_usage (
--   date date primary key, xai_call_count int not null default 0,
--   updated_at timestamptz not null default now()
-- );
-- alter table lhq_dev_global_ai_usage enable row level security;
-- revoke insert, update, delete, truncate on lhq_dev_global_ai_usage from anon, authenticated;
-- (then re-run the CREATE OR REPLACE FUNCTION body against lhq_dev_grok_usage /
--  lhq_dev_global_ai_usage, same substitution pattern as prior dev blocks)
