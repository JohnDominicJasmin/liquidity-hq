-- Server-side log of every Grok API call made by the Telegram alert cron.
-- No user_id - this is system-level spend, not per-user quota.
-- Run once in the Supabase SQL Editor.

create table if not exists lhq_alert_grok_log (
  id          bigserial   primary key,
  called_at   timestamptz not null default now(),
  signal_type text
);

create table if not exists lhq_dev_alert_grok_log (
  id          bigserial   primary key,
  called_at   timestamptz not null default now(),
  signal_type text
);

-- Useful query: daily call counts by signal type
-- select date_trunc('day', called_at) as day, signal_type, count(*)
-- from lhq_alert_grok_log
-- group by 1, 2 order by 1 desc, 3 desc;
