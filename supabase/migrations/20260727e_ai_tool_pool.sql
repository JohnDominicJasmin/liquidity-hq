-- Shared daily budget across all 11 one-shot AI tool routes (thesis-check,
-- strategy-research, shadow-account, behavioral-bias, pine-script,
-- hypothesis-analyze, token-unlock, smc-snapshot, dry-powder, macro-context,
-- onchain), on top of each tool's own per-tool cap.
--
-- Why: 11 independent per-tool caps MULTIPLY. At the old 18-each they gave one
-- Pro user a 198-call/day ceiling from the one-shot tools alone - about 43% of
-- the entire worst-case xAI bill - for tools nobody runs 18 times a day. A
-- shared pool collapses that ceiling while making each individual tool MORE
-- generous than trimming the per-tool numbers would: a Pro user who only ever
-- runs SMC snapshots gets the full 25, instead of being cut to 6 apiece.
--
-- Free tier passes p_pool_limit = null (no pool, per-tool caps only) so a free
-- user can still sample every tool rather than burning one shared budget on
-- whichever tool they happen to click first. See lib/limits.ts AI_LIMITS.
--
-- Return sentinels (lib/aiUsage.ts maps these to UsageIncrementResult.reason):
--   >= 1   the new per-tool count - allowed
--   null   blocked by this user's own per-tool cap
--   -1     blocked by the app-wide circuit breaker (AI_GLOBAL_DAILY_MAX)
--   -2     blocked by the shared tool pool  <-- new
-- -2 is distinct from null on purpose: "you've used all 25 tool runs today"
-- and "you've used all 25 thesis checks today" need different wording, and
-- previously every block said the latter.
--
-- Ordering inside the function: per-tool check first, then pool, then global.
-- Anything that blocks after an increment already landed rolls that increment
-- back in the same transaction, so a call that never reaches xAI never
-- consumes quota - same compensating-write pattern as the global breaker in
-- 20260805a_global_ai_circuit_breaker.sql.
--
-- Run against BOTH projects - prod (liquidity-hq-prod, qdpwhnvmhqgzijuwopso,
-- table lhq_grok_usage / lhq_global_ai_usage) and dev (liquidity-hq-dev,
-- wdtjhrilakoitfcezxpx, lhq_dev_grok_usage / lhq_dev_global_ai_usage) -
-- substituting the table names throughout.

alter table lhq_grok_usage
  add column if not exists tool_pool_count int not null default 0;

-- CREATE OR REPLACE with a different parameter list creates a SECOND
-- overloaded function rather than replacing the old one (this bit us before -
-- see 20260805a). Drop the 5-param signature explicitly so there is no
-- remaining callable path that skips the pool check.
drop function if exists increment_ai_usage(uuid, date, text, int, int);

create or replace function increment_ai_usage(
  p_user_id      uuid,
  p_date         date,
  p_column       text,
  p_limit        int,
  p_global_limit int default null,
  p_pool_limit   int default null
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new    int;
  v_global int;
  v_pool   int;
  v_result int;
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
  elsif p_column = 'dry_powder_count' then
    update lhq_grok_usage set dry_powder_count = dry_powder_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and dry_powder_count < p_limit
      returning dry_powder_count into v_new;
  elsif p_column = 'macro_context_count' then
    update lhq_grok_usage set macro_context_count = macro_context_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and macro_context_count < p_limit
      returning macro_context_count into v_new;
  elsif p_column = 'onchain_count' then
    update lhq_grok_usage set onchain_count = onchain_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and onchain_count < p_limit
      returning onchain_count into v_new;
  else
    raise exception 'increment_ai_usage: invalid column %', p_column;
  end if;

  if v_new is null then
    -- Per-tool cap already hit. Nothing was incremented, so nothing to undo,
    -- and neither the pool nor the global counter should be touched.
    return null;
  end if;

  v_result := v_new; -- optimistic; downgraded to -2 / -1 by the checks below

  -- Shared tool-pool check. Only the one-shot tool routes pass a non-null
  -- p_pool_limit; quick/deep/chat/search/briefing and the whole free tier
  -- pass null and skip this entirely.
  if p_pool_limit is not null then
    update lhq_grok_usage
      set tool_pool_count = tool_pool_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and tool_pool_count < p_pool_limit
      returning tool_pool_count into v_pool;
    if v_pool is null then
      v_result := -2;
    end if;
  end if;

  if v_result > 0 and p_global_limit is not null then
    insert into lhq_global_ai_usage (date, xai_call_count, updated_at)
    values (p_date, 0, now())
    on conflict (date) do nothing;

    update lhq_global_ai_usage
      set xai_call_count = xai_call_count + 1, updated_at = now()
      where date = p_date and xai_call_count < p_global_limit
      returning xai_call_count into v_global;

    if v_global is null then
      v_result := -1;
    end if;
  end if;

  if v_result > 0 then
    return v_result; -- per-tool, pool (if any) and global (if any) all passed
  end if;

  -- Blocked after the per-tool increment already landed: undo it so a call
  -- that never actually reaches xAI doesn't consume the user's own quota.
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
  elsif p_column = 'dry_powder_count' then
    update lhq_grok_usage set dry_powder_count = dry_powder_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'macro_context_count' then
    update lhq_grok_usage set macro_context_count = macro_context_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'onchain_count' then
    update lhq_grok_usage set onchain_count = onchain_count - 1 where user_id = p_user_id and date = p_date;
  end if;

  -- And undo the pool increment too, but only if it actually landed (v_pool
  -- is null exactly when the pool itself was what blocked, i.e. nothing was
  -- added to it) - otherwise a global-cap block would silently refund a pool
  -- slot that was never taken.
  if v_pool is not null then
    update lhq_grok_usage set tool_pool_count = tool_pool_count - 1
      where user_id = p_user_id and date = p_date;
  end if;

  return v_result; -- -2 (pool) or -1 (global)
end;
$$;

revoke execute on function increment_ai_usage(uuid, date, text, int, int, int) from public;
grant execute on function increment_ai_usage(uuid, date, text, int, int, int) to authenticated;
