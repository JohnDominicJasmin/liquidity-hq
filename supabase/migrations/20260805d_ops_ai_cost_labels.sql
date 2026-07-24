-- Labels for the new /ops AI $-cost view (lib/aiCost.ts, app/ops/_cards.tsx
-- AiCostCard, app/ops/users/[id]/page.tsx). English-only by design - this is
-- an admin-only surface (see PENDING.md's "i18n translation paused" note);
-- the labels API (app/api/labels/route.ts) merges English as the base layer
-- for every locale, so any other locale falls back to these values instead
-- of showing a raw key. Already applied live against both lhq_labels (prod)
-- and lhq_dev_labels (dev) via execute_sql.

insert into lhq_labels (key, locale, value) values
('OPS_CARDS_AI_SPEND_24H','en','AI spend (24h)'),
('OPS_CARDS_AI_SPEND_7D','en','AI spend (7d)'),
('OPS_CARDS_AI_SPEND_30D','en','AI spend (30d)'),
('OPS_CARDS_GLOBAL_CAP_TODAY','en','Today vs global cap'),
('OPS_CARDS_GLOBAL_CAP_UNSET','en','AI_GLOBAL_DAILY_MAX not set'),
('OPS_CARDS_SPIKE_ALERT','en','Approaching the global daily cap - check for a usage spike.'),
('OPS_CARDS_TOP_SPENDERS_TITLE','en','Top spenders (30d)'),
('OPS_CARDS_MARGIN_LABEL','en','margin {margin}'),
('OPS_USER_DETAIL_EST_COST_14D','en','Est. cost (14d)'),
('OPS_USER_DETAIL_MARGIN_14D','en','Margin (14d)'),
('OPS_USER_DETAIL_MARGIN_NOTE','en','Estimated from real xAI per-token rates (grok-4.3), not an exact invoice match. Margin = monthly Pro revenue minus estimated 14-day AI cost.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV (already applied live against lhq_dev_labels):
-- insert into lhq_dev_labels (key, locale, value) values (... same rows ...)
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
