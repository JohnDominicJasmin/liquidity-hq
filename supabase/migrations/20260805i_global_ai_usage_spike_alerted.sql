-- Dedup flag for app/api/ops/spike-alert/route.ts - without this, a Telegram
-- spike warning would re-fire every single cron tick once today's usage
-- crosses 80% of AI_GLOBAL_DAILY_MAX, since the counter itself only resets
-- at midnight. Defaults false on every new day's row (the table is keyed by
-- date - see 20260805a_global_ai_circuit_breaker.sql), so this needs no
-- separate reset logic.
--
-- Applied live against both lhq_global_ai_usage (prod, qdpwhnvmhqgzijuwopso)
-- and lhq_dev_global_ai_usage (dev, wdtjhrilakoitfcezxpx) - the dev table
-- exists (confirmed via information_schema) even though the base circuit-
-- breaker migration's dev block was left commented-out/unapplied.

alter table lhq_global_ai_usage add column if not exists spike_alerted boolean not null default false;

-- DEV (already applied):
-- alter table lhq_dev_global_ai_usage add column if not exists spike_alerted boolean not null default false;
