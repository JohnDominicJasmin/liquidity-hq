-- Snapshot how much agreement existed when each alert fired, so the question
-- "does confluence actually predict anything" becomes answerable later.
--
-- Right now it is not. The Arena Confluence Score is computed in the browser at
-- render time and never stored, so there is no record of what it said when any
-- given alert fired. It also cannot simply be recomputed in the cron: its Order
-- Flow factor (weight 25, the second heaviest) is built from OI trend, CVD
-- divergence, taker buy ratio, POC and VWAP, all of which reach the client over
-- its own market feed and none of which the cron holds. Persisting a
-- server-side "confluence score" missing a quarter of its weight would be a
-- different number wearing the same name, and every conclusion drawn from it
-- would be about something the user never saw.
--
-- So this records what the cron genuinely knows, under a name that says what it
-- is: how many independent rules fired on the same coin in the same scan, and
-- how strongly they agreed on direction.
--
--   agree_count  distinct rule keys that fired for this coin in this run,
--                including this one. 1 = it fired alone.
--   agree_net    long fires minus short fires among them. +3 means three rules
--                all said long; 0 means they cancelled out.
--
-- That is a stricter and more honest reading of "confluence" than a weighted
-- score anyway: independent rules agreeing is the thing worth measuring, and
-- unlike the UI score these two columns cannot drift from what actually fired.
--
-- Both nullable with no default, so rows written before this shipped stay
-- distinguishable as "not recorded" rather than silently reading as 1/0.
--
-- The analysis this is for, once a few weeks have accumulated:
--   select agree_count,
--          count(*),
--          round(avg(outcome_pct_24h)::numeric, 3),
--          round((100.0 * count(*) filter (where outcome_pct_24h > 0)
--                 / count(*))::numeric, 1) as win_rate
--     from lhq_alert_fires
--    where resolved_24h and agree_count is not null
--    group by agree_count order by agree_count;
--
-- If win rate does not climb with agree_count, combining signals is not adding
-- anything and the Arena score's weights are decoration.

-- ── PROD (qdpwhnvmhqgzijuwopso) ──────────────────────────────────────────────
alter table lhq_alert_fires
  add column if not exists agree_count smallint,
  add column if not exists agree_net   smallint;

comment on column lhq_alert_fires.agree_count is
  'Distinct rule keys that fired for this coin in the same cron run, including this one. Null = predates the column.';
comment on column lhq_alert_fires.agree_net is
  'Long fires minus short fires among those rules. Positive = agreed long.';

-- ── DEV (wdtjhrilakoitfcezxpx) - NOTHING TO RUN ─────────────────────────────
-- There is no lhq_dev_alert_fires table. The alert cron is scheduled against
-- prod only (cron-job.org, see docs/INFRASTRUCTURE.md §2), so nothing has ever
-- written fires on dev and the table was never created. Verified 2026-08-01:
--   select table_name from information_schema.tables
--    where table_schema='public' and table_name like '%alert_fires%';  -> 0 rows
-- If the cron is ever pointed at dev, create the table there first from the
-- original migration rather than assuming this one is all that is missing.
