-- Labels for /ops's new call-count-by-type breakdown (AiCostCard): answers
-- "how many calls of each kind have we made" - both the alert cron's signal
-- types (whale_trade, confluence, ema_signal_<tf>, daily_summary, etc, from
-- lhq_alert_grok_log) and user-triggered feature calls (quick/deep/chat/
-- briefing/one-shot tools, summed from lhq_grok_usage). The alert-cron
-- breakdown was already computed server-side (system.byType) but never
-- rendered; the user-triggered breakdown is new (app/api/ops/ai-cost/route.ts
-- userCallsByType). English-only, matching the wave-13 admin-surface
-- convention (PENDING.md i18n-paused note).
-- Applied live against both lhq_labels (prod, qdpwhnvmhqgzijuwopso) and
-- lhq_dev_labels (dev, wdtjhrilakoitfcezxpx) via execute_sql.

insert into lhq_labels (key, locale, value) values
('OPS_CARDS_ALERT_CALLS_BY_TYPE','en','Alert calls by type (14d)'),
('OPS_CARDS_USER_CALLS_BY_TYPE','en','User action calls by type (30d)')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- Same 2 rows, run against lhq_dev_labels on wdtjhrilakoitfcezxpx (already applied).
