-- Add daily-usage columns for the previously-uncapped AI analysis routes
-- (thesis-check, strategy-research, shadow-account, behavioral-bias,
-- pine-script, hypotheses/[id]/analyze). Run once in the Supabase SQL Editor
-- (mirrors the pattern in 20260627_add_briefing_count.sql).

alter table lhq_grok_usage
  add column if not exists thesis_check_count       int not null default 0,
  add column if not exists strategy_research_count   int not null default 0,
  add column if not exists shadow_account_count      int not null default 0,
  add column if not exists behavioral_bias_count     int not null default 0,
  add column if not exists pine_script_count         int not null default 0,
  add column if not exists hypothesis_analyze_count  int not null default 0;

alter table lhq_dev_grok_usage
  add column if not exists thesis_check_count       int not null default 0,
  add column if not exists strategy_research_count   int not null default 0,
  add column if not exists shadow_account_count      int not null default 0,
  add column if not exists behavioral_bias_count     int not null default 0,
  add column if not exists pine_script_count         int not null default 0,
  add column if not exists hypothesis_analyze_count  int not null default 0;
