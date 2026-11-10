-- 20261031a's DEV FUNCTION HALF, RE-DERIVED. Dev now has `draw_structure_count` as a COLUMN but its
-- `increment_ai_usage_impl` has no branch for it, so a Draw Structure call on dev/qa/staging raises
-- `increment_ai_usage: invalid column draw_structure_count` instead of the clean NOT_ENABLED 503 it
-- used to give. This closes that window. Prod already has both halves and is NOT touched by this file.
--
-- WHY THIS IS A NEW FILE RATHER THAN AN EDIT TO 20261031a: that file's dev section is a transcription,
-- and the file says so itself - "THE DEV SECTION MUST NOT BE TRANSCRIBED", because a copy taken on one
-- day is stale the next time anything touches the function and nothing announces when it stops being
-- right. That prediction came true twice over, and both are measured rather than assumed:
--
--   * 20261031a claims its PROD body normalises to 1ac55e216e7d23363d23cd187eacfa33. Live prod now
--     normalises to 0d71a2b421899b10091e653a6c7df47b. 20261106a touched the function after 31a was
--     written, so the file's own prod section no longer describes production either.
--   * So the dev half could NOT be produced by prefix-rewriting 31a's prod section, which was the
--     cheap route. It had to come from dev's live body, exactly as 31a's step list instructs.
--
-- DERIVED, NOT TYPED, AND THE DERIVATION IS THE EVIDENCE. The body below was generated from the
-- 16-column list by a script that emits each branch from one template. Before adding anything, the
-- script regenerated dev's CURRENT body and compared it to the live one:
--
--   dev live  `increment_ai_usage_impl` body, comments stripped, whitespace collapsed, md5:
--       9a81a905b3c8c3f0c2c84c97292e65a6   (7794 chars)
--   script's reproduction of that same body:
--       9a81a905b3c8c3f0c2c84c97292e65a6   (7794 chars)   <- identical, so nothing was mistyped
--   the body below, same normalisation:
--       e017184e47654d45a5d3cd871120d77d   (8227 chars)
--
-- A hand-copied body cannot make that first claim. This one can: if a single character of the 16
-- existing branches had drifted, the reproduction hash would not have matched and the file would not
-- have been written. Diff of the body below against dev's live body: +6 lines, 0 removed, 0 changed.
--
-- AND THE 6 NEW LINES ARE PROD'S OWN LIVE LINES, prefix-swapped - also by hash, not by eye:
--   prod live draw lines, `lhq_grok_usage` -> `lhq_dev_grok_usage`, trimmed, md5:
--       295989d7905658dc29e8ca55986953f5   (6 lines)
--   the 6 lines added below, same treatment:
--       295989d7905658dc29e8ca55986953f5   (6 lines)
--
-- Which is also the argument that this file is syntactically valid WITHOUT having been executed: the
-- 16 existing branches are byte-identical to a function running right now on dev, and the 6 added
-- lines are byte-identical to lines running right now on prod. Nothing here is new text. It has NOT
-- been executed anywhere - see NOT APPLIED below - so that is an argument, not a test run.
--
-- 20261031a's STEP 3 CHECKS, RUN ON THE BODY BELOW:
--   p_column branch set   17 distinct, gaining exactly `draw_structure_count`, losing nothing
--   tool_pool mentions    6     (unchanged - the pool refund is intact)
--   p_pool_limit          2     (unchanged; prod's 3rd mention is inside a comment, not code)
--   `--` inside a string literal   0   (so a comment-stripping apply path cannot truncate a statement)
--
-- WHAT `create or replace` RISKS HERE, stated plainly: this re-meters all 17 Pro tools at once on a
-- database with no backups. The protection is not care, it is the hash above - the 16 existing
-- branches are provably the ones currently live, so the only behaviour this can change is the 17th.
--
-- PREFIXES ARE DEV'S: `lhq_dev_grok_usage` and `lhq_dev_global_ai_usage`, taken from the live body
-- rather than rewritten from prod's. `lib/tables.ts:3` is what makes them differ per environment.
--
-- NOT APPLIED. DDL on the shared database, and the dev project serves dev, qa AND staging. QA reviews
-- this; PM/DevOps applies it in a DDL window. The column half is already applied, so this file is only
-- the function.
--
-- AFTER APPLYING, the control that matters is not that a Draw Structure call succeeds - it is that the
-- REFUND still works for a tool that is not draw_structure, because that is what a dropped branch
-- would break silently. Increment and then refund one pool tool (e.g. onchain_count) and check
-- tool_pool_count returns to where it started.
-- ============================================================================================

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
-- The column half, already applied on 2026-11-08. Left here, idempotent, so this file is complete.
alter table lhq_dev_grok_usage
  add column if not exists draw_structure_count int not null default 0;

create or replace function increment_ai_usage_impl(
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
  insert into lhq_dev_grok_usage (user_id, date, updated_at)
  values (p_user_id, p_date, now())
  on conflict (user_id, date) do nothing;

  if p_column = 'deep_count' then
    update lhq_dev_grok_usage set deep_count = deep_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and deep_count < p_limit
      returning deep_count into v_new;
  elsif p_column = 'quick_count' then
    update lhq_dev_grok_usage set quick_count = quick_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and quick_count < p_limit
      returning quick_count into v_new;
  elsif p_column = 'chat_count' then
    update lhq_dev_grok_usage set chat_count = chat_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and chat_count < p_limit
      returning chat_count into v_new;
  elsif p_column = 'chat_search_count' then
    update lhq_dev_grok_usage set chat_search_count = chat_search_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and chat_search_count < p_limit
      returning chat_search_count into v_new;
  elsif p_column = 'briefing_count' then
    update lhq_dev_grok_usage set briefing_count = briefing_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and briefing_count < p_limit
      returning briefing_count into v_new;
  elsif p_column = 'thesis_check_count' then
    update lhq_dev_grok_usage set thesis_check_count = thesis_check_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and thesis_check_count < p_limit
      returning thesis_check_count into v_new;
  elsif p_column = 'strategy_research_count' then
    update lhq_dev_grok_usage set strategy_research_count = strategy_research_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and strategy_research_count < p_limit
      returning strategy_research_count into v_new;
  elsif p_column = 'shadow_account_count' then
    update lhq_dev_grok_usage set shadow_account_count = shadow_account_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and shadow_account_count < p_limit
      returning shadow_account_count into v_new;
  elsif p_column = 'behavioral_bias_count' then
    update lhq_dev_grok_usage set behavioral_bias_count = behavioral_bias_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and behavioral_bias_count < p_limit
      returning behavioral_bias_count into v_new;
  elsif p_column = 'pine_script_count' then
    update lhq_dev_grok_usage set pine_script_count = pine_script_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and pine_script_count < p_limit
      returning pine_script_count into v_new;
  elsif p_column = 'hypothesis_analyze_count' then
    update lhq_dev_grok_usage set hypothesis_analyze_count = hypothesis_analyze_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and hypothesis_analyze_count < p_limit
      returning hypothesis_analyze_count into v_new;
  elsif p_column = 'token_unlock_count' then
    update lhq_dev_grok_usage set token_unlock_count = token_unlock_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and token_unlock_count < p_limit
      returning token_unlock_count into v_new;
  elsif p_column = 'smc_snapshot_count' then
    update lhq_dev_grok_usage set smc_snapshot_count = smc_snapshot_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and smc_snapshot_count < p_limit
      returning smc_snapshot_count into v_new;
  elsif p_column = 'dry_powder_count' then
    update lhq_dev_grok_usage set dry_powder_count = dry_powder_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and dry_powder_count < p_limit
      returning dry_powder_count into v_new;
  elsif p_column = 'macro_context_count' then
    update lhq_dev_grok_usage set macro_context_count = macro_context_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and macro_context_count < p_limit
      returning macro_context_count into v_new;
  elsif p_column = 'onchain_count' then
    update lhq_dev_grok_usage set onchain_count = onchain_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and onchain_count < p_limit
      returning onchain_count into v_new;
  elsif p_column = 'draw_structure_count' then
    update lhq_dev_grok_usage set draw_structure_count = draw_structure_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and draw_structure_count < p_limit
      returning draw_structure_count into v_new;
  else
    raise exception 'increment_ai_usage: invalid column %', p_column;
  end if;

  if v_new is null then
    return null;
  end if;

  v_result := v_new;

  if p_pool_limit is not null then
    update lhq_dev_grok_usage
      set tool_pool_count = tool_pool_count + 1, updated_at = now()
      where user_id = p_user_id and date = p_date and tool_pool_count < p_pool_limit
      returning tool_pool_count into v_pool;
    if v_pool is null then
      v_result := -2;
    end if;
  end if;

  if v_result > 0 and p_global_limit is not null then
    insert into lhq_dev_global_ai_usage (date, xai_call_count, updated_at)
    values (p_date, 0, now())
    on conflict (date) do nothing;

    update lhq_dev_global_ai_usage
      set xai_call_count = xai_call_count + 1, updated_at = now()
      where date = p_date and xai_call_count < p_global_limit
      returning xai_call_count into v_global;

    if v_global is null then
      v_result := -1;
    end if;
  end if;

  if v_result > 0 then
    return v_result;
  end if;

  if p_column = 'deep_count' then
    update lhq_dev_grok_usage set deep_count = deep_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'quick_count' then
    update lhq_dev_grok_usage set quick_count = quick_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'chat_count' then
    update lhq_dev_grok_usage set chat_count = chat_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'chat_search_count' then
    update lhq_dev_grok_usage set chat_search_count = chat_search_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'briefing_count' then
    update lhq_dev_grok_usage set briefing_count = briefing_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'thesis_check_count' then
    update lhq_dev_grok_usage set thesis_check_count = thesis_check_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'strategy_research_count' then
    update lhq_dev_grok_usage set strategy_research_count = strategy_research_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'shadow_account_count' then
    update lhq_dev_grok_usage set shadow_account_count = shadow_account_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'behavioral_bias_count' then
    update lhq_dev_grok_usage set behavioral_bias_count = behavioral_bias_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'pine_script_count' then
    update lhq_dev_grok_usage set pine_script_count = pine_script_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'hypothesis_analyze_count' then
    update lhq_dev_grok_usage set hypothesis_analyze_count = hypothesis_analyze_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'token_unlock_count' then
    update lhq_dev_grok_usage set token_unlock_count = token_unlock_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'smc_snapshot_count' then
    update lhq_dev_grok_usage set smc_snapshot_count = smc_snapshot_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'dry_powder_count' then
    update lhq_dev_grok_usage set dry_powder_count = dry_powder_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'macro_context_count' then
    update lhq_dev_grok_usage set macro_context_count = macro_context_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'onchain_count' then
    update lhq_dev_grok_usage set onchain_count = onchain_count - 1 where user_id = p_user_id and date = p_date;
  elsif p_column = 'draw_structure_count' then
    update lhq_dev_grok_usage set draw_structure_count = draw_structure_count - 1 where user_id = p_user_id and date = p_date;
  end if;

  if v_pool is not null then
    update lhq_dev_grok_usage set tool_pool_count = tool_pool_count - 1
      where user_id = p_user_id and date = p_date;
  end if;

  return v_result;
end;
$$;
