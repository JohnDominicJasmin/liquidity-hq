-- Add briefing_count column to track Morning Briefing Grok API usage.
-- Run once in the Supabase SQL Editor.

alter table lhq_grok_usage
  add column if not exists briefing_count int not null default 0;

alter table lhq_dev_grok_usage
  add column if not exists briefing_count int not null default 0;
