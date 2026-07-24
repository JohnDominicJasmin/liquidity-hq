-- app/api/smc-snapshot/route.ts has the identical unbounded-cache-key gap as
-- token-unlock (20260804d_token_unlock_cap.sql): cache key is
-- `smc-snapshot:${asset}:${tf}` where `asset` was only uppercased/stripped of
-- a trailing USDT (no charset check at all) and `tf` had no validation
-- whatsoever. Any signed-in user could force unlimited fresh xAI calls.
--
-- Adds smc_snapshot_count + wires it into increment_ai_usage(). Run the PROD
-- block in qdpwhnvmhqgzijuwopso, the DEV block (commented) in
-- wdtjhrilakoitfcezxpx.

-- ── PROD ─────────────────────────────────────────────────────────────────
alter table lhq_grok_usage
  add column if not exists smc_snapshot_count int not null default 0;

create or replace function increment_ai_usage(
  p_user_id uuid,
  p_date    date,
  p_column  text,
  p_limit   int
) returns int
language plpgsql
as $$
declare
  v_new int;
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

  return v_new;
end;
$$;

revoke execute on function increment_ai_usage(uuid, date, text, int) from public;
grant execute on function increment_ai_usage(uuid, date, text, int) to authenticated;

-- ── DEV (table lhq_dev_grok_usage) - run separately against the dev project ─
-- alter table lhq_dev_grok_usage
--   add column if not exists smc_snapshot_count int not null default 0;
-- (then re-run the CREATE OR REPLACE FUNCTION body against lhq_dev_grok_usage,
-- same pattern as 20260804d_token_unlock_cap.sql's DEV block)
