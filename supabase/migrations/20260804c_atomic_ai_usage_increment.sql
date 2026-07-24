-- Fixes the TOCTOU race on daily AI usage caps: every route (grok, grok-chat,
-- briefing, thesis-check, strategy-research, shadow-account, behavioral-bias,
-- pine-script, hypotheses/[id]/analyze) previously did a SELECT to read
-- today's count, compared it to the tier limit in application code, then a
-- separate UPSERT to write count+1 - two concurrent requests can both read
-- the same under-limit count and both pass the check before either write
-- lands, exceeding the daily cap.
--
-- This replaces that with a single atomic UPDATE ... WHERE <col> < limit
-- RETURNING <col> - Postgres row-level locking on the UPDATE serializes
-- concurrent callers, so only requests that are actually still under the
-- limit at the moment they acquire the row lock succeed. Column name comes
-- from a fixed CASE list (not dynamic SQL) so there's no injection surface
-- even though p_column is caller-supplied.
--
-- No refund on a failed xAI call after a successful increment - trades a
-- rare UX papercut (lose 1 unit of quota on a network/API failure) for
-- closing the race outright without a second compensating-write path that
-- would reopen its own smaller race.
--
-- security invoker (default, not definer) - runs under the caller's Supabase
-- JWT via the anon-key client, so the existing "users_own_usage" RLS policy
-- (user_id = auth.uid()) still gates every insert/update exactly like before.
-- Run once per project's SQL Editor - table name differs prod vs dev.

-- ── PROD (project qdpwhnvmhqgzijuwopso) - table lhq_grok_usage ──────────────
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
  else
    raise exception 'increment_ai_usage: invalid column %', p_column;
  end if;

  return v_new; -- null => limit already reached, caller must treat null as blocked
end;
$$;

revoke execute on function increment_ai_usage(uuid, date, text, int) from public;
grant execute on function increment_ai_usage(uuid, date, text, int) to authenticated;

-- ── DEV (project wdtjhrilakoitfcezxpx) - table lhq_dev_grok_usage ───────────
-- Identical function body, only the table name differs. Run this block
-- against the dev project instead of the block above.
--
-- create or replace function increment_ai_usage(
--   p_user_id uuid, p_date date, p_column text, p_limit int
-- ) returns int language plpgsql as $$
-- declare v_new int;
-- begin
--   insert into lhq_dev_grok_usage (user_id, date, updated_at)
--   values (p_user_id, p_date, now()) on conflict (user_id, date) do nothing;
--   if p_column = 'deep_count' then
--     update lhq_dev_grok_usage set deep_count = deep_count + 1, updated_at = now()
--       where user_id = p_user_id and date = p_date and deep_count < p_limit
--       returning deep_count into v_new;
--   elsif p_column = 'quick_count' then
--     update lhq_dev_grok_usage set quick_count = quick_count + 1, updated_at = now()
--       where user_id = p_user_id and date = p_date and quick_count < p_limit
--       returning quick_count into v_new;
--   elsif p_column = 'chat_count' then
--     update lhq_dev_grok_usage set chat_count = chat_count + 1, updated_at = now()
--       where user_id = p_user_id and date = p_date and chat_count < p_limit
--       returning chat_count into v_new;
--   elsif p_column = 'chat_search_count' then
--     update lhq_dev_grok_usage set chat_search_count = chat_search_count + 1, updated_at = now()
--       where user_id = p_user_id and date = p_date and chat_search_count < p_limit
--       returning chat_search_count into v_new;
--   elsif p_column = 'briefing_count' then
--     update lhq_dev_grok_usage set briefing_count = briefing_count + 1, updated_at = now()
--       where user_id = p_user_id and date = p_date and briefing_count < p_limit
--       returning briefing_count into v_new;
--   elsif p_column = 'thesis_check_count' then
--     update lhq_dev_grok_usage set thesis_check_count = thesis_check_count + 1, updated_at = now()
--       where user_id = p_user_id and date = p_date and thesis_check_count < p_limit
--       returning thesis_check_count into v_new;
--   elsif p_column = 'strategy_research_count' then
--     update lhq_dev_grok_usage set strategy_research_count = strategy_research_count + 1, updated_at = now()
--       where user_id = p_user_id and date = p_date and strategy_research_count < p_limit
--       returning strategy_research_count into v_new;
--   elsif p_column = 'shadow_account_count' then
--     update lhq_dev_grok_usage set shadow_account_count = shadow_account_count + 1, updated_at = now()
--       where user_id = p_user_id and date = p_date and shadow_account_count < p_limit
--       returning shadow_account_count into v_new;
--   elsif p_column = 'behavioral_bias_count' then
--     update lhq_dev_grok_usage set behavioral_bias_count = behavioral_bias_count + 1, updated_at = now()
--       where user_id = p_user_id and date = p_date and behavioral_bias_count < p_limit
--       returning behavioral_bias_count into v_new;
--   elsif p_column = 'pine_script_count' then
--     update lhq_dev_grok_usage set pine_script_count = pine_script_count + 1, updated_at = now()
--       where user_id = p_user_id and date = p_date and pine_script_count < p_limit
--       returning pine_script_count into v_new;
--   elsif p_column = 'hypothesis_analyze_count' then
--     update lhq_dev_grok_usage set hypothesis_analyze_count = hypothesis_analyze_count + 1, updated_at = now()
--       where user_id = p_user_id and date = p_date and hypothesis_analyze_count < p_limit
--       returning hypothesis_analyze_count into v_new;
--   else
--     raise exception 'increment_ai_usage: invalid column %', p_column;
--   end if;
--   return v_new;
-- end;
-- $$;
--
-- revoke execute on function increment_ai_usage(uuid, date, text, int) from public;
-- grant execute on function increment_ai_usage(uuid, date, text, int) to authenticated;
