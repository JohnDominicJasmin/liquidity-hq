-- Per-user daily cap on the 3 cached xAI routes that never had one
-- (dry-powder, macro-context, onchain) - SECURITY_AUDIT.md's last open code
-- item. These already bound real xAI cost tightly via a shared cache
-- (cached(), lib/apiCache.ts), but had no per-user counter for
-- attribution/symmetry with every other metered route, and no floor against
-- one account hammering the endpoint itself. Same proven pattern as
-- token_unlock_count/smc_snapshot_count (20260805a/20260805f): the
-- increment only happens on the cache-miss path inside the route's
-- cached() callback, so a cache hit stays free for everyone - only the
-- (rare, shared) real xAI call counts against the caller's quota.
--
-- Run against BOTH projects - prod (qdpwhnvmhqgzijuwopso, table
-- lhq_grok_usage) and dev (wdtjhrilakoitfcezxpx, table
-- lhq_dev_grok_usage) - substitute the table name in every statement below.

alter table lhq_grok_usage
  add column if not exists dry_powder_count int not null default 0,
  add column if not exists macro_context_count int not null default 0,
  add column if not exists onchain_count int not null default 0;

create or replace function increment_ai_usage(
  p_user_id      uuid,
  p_date         date,
  p_column       text,
  p_limit        int,
  p_global_limit int default null
) returns int
language plpgsql
security definer
set search_path = public
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
    return null;
  end if;

  if p_global_limit is null then
    return v_new;
  end if;

  insert into lhq_global_ai_usage (date, xai_call_count, updated_at)
  values (p_date, 0, now())
  on conflict (date) do nothing;

  update lhq_global_ai_usage
    set xai_call_count = xai_call_count + 1, updated_at = now()
    where date = p_date and xai_call_count < p_global_limit
    returning xai_call_count into v_global;

  if v_global is not null then
    return v_new;
  end if;

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

  return -1;
end;
$$;

revoke execute on function increment_ai_usage(uuid, date, text, int, int) from public;
grant execute on function increment_ai_usage(uuid, date, text, int, int) to authenticated;

-- Same statements run against wdtjhrilakoitfcezxpx (dev), substituting
-- lhq_grok_usage -> lhq_dev_grok_usage throughout.
