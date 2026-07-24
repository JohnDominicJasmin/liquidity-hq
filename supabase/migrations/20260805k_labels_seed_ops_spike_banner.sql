-- Label for the new /ops top-of-page spike banner (app/ops/page.tsx's
-- SpikeBanner) - distinct, more visible placement from the existing buried
-- AiCostCard note (OPS_CARDS_SPIKE_ALERT). Same data source
-- (globalBreaker.spikeAlert from /api/ops/ai-cost), just surfaced louder, per
-- the explicit ask to "create a notification in admin" for the AI-spend
-- spike, not just email. English-only, matching the wave-13 admin-surface
-- convention (PENDING.md i18n-paused note) - falls back to English on every
-- other locale via the labels API's merge behavior.
-- Applied live against both lhq_labels (prod, qdpwhnvmhqgzijuwopso) and
-- lhq_dev_labels (dev, wdtjhrilakoitfcezxpx) via execute_sql.

insert into lhq_labels (key, locale, value) values
('OPS_SPIKE_BANNER','en','AI usage spike: {calls} of {cap} xAI calls today ({pct}%) - approaching the daily cap.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- Same row, run against lhq_dev_labels on wdtjhrilakoitfcezxpx (already applied).
