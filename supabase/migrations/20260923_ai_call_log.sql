-- #1399 part 1: one row per xAI call made on a user's behalf, with the cost xAI
-- itself reported for it. Until now the only record was lhq_grok_usage, which
-- COUNTS calls per user per day and prices them by assuming an average call -
-- so nobody could say what a given account actually costs, and the owner's
-- break-even ($0.0085 per call at the planned prices) could not be checked.
--
-- Written ONLY by the service-role client, from lib/aiCallLog.ts, after each
-- of the sixteen AI routes gets its response. Same shape as lhq_admin_audit_log:
-- an append-only ledger, RLS enabled with no policy, so anon/authenticated
-- cannot read or write it and service-role bypasses RLS. Read by /ops (admin
-- client) for the spend-by-tier view, and by part 2's monthly ceiling.
--
-- NO FOREIGN KEY on user_id, on purpose: this is an accounting record. A
-- deleted account's spend still happened and still has to add up; `on delete
-- cascade` would silently shrink last month's bill, and `set null` would need a
-- constraint that adds nothing but that risk. lhq_admin_audit_log made the same
-- choice for the same reason.
--
-- COST IS NULLABLE, AND NULL MEANS UNKNOWN, NOT FREE. cost_source says how each
-- row's figure was obtained:
--   'xai'        xAI's own per-call figure (usage.cost_in_usd_ticks / 1e10).
--                Verified live 2026-09-23: both endpoints return it, and it
--                matches the published rates to the tick.
--   'estimated'  xAI sent token counts but no cost; priced from the one rate
--                table in lib/aiCost.ts.
--   'unknown'    no usable usage object. cost_usd and the token columns are
--                null. Never zero: an unmeasured call is not a free call.
--
-- Registered in lib/tables.ts as T.ai_call_log (prefix-aware: lhq_ prod /
-- lhq_dev_ dev). Run against BOTH projects, ONE SECTION AT A TIME: the prod block
-- below is live, the dev block is commented (20260912b). Additive only; nothing
-- existing is touched.

create table if not exists lhq_ai_call_log (
  id                bigserial   primary key,
  user_id           uuid,                        -- the caller; no FK, see header
  call_type         text        not null,        -- one of AI_CALL_TYPES in lib/aiCost.ts
  model             text        not null,        -- as the response named it, e.g. 'grok-4.3'
  prompt_tokens     int,                         -- null = unknown
  completion_tokens int,                         -- billed output incl. reasoning; null = unknown
  cost_usd          numeric,                     -- null = unknown, never 0 for an unmeasured call
  cost_source       text        not null,        -- 'xai' | 'estimated' | 'unknown'
  created_at        timestamptz not null default now()
);

alter table lhq_ai_call_log enable row level security;
create index if not exists lhq_ai_call_log_created_at_idx on lhq_ai_call_log (created_at desc);
-- Per-account totals over a window (part 2's monthly ceiling, /ops top spenders).
create index if not exists lhq_ai_call_log_user_created_idx on lhq_ai_call_log (user_id, created_at desc);

-- DEV: same table against lhq_dev_ai_call_log - apply separately, per 20260912b's
-- convention (the dev block is commented so running this file against prod can
-- never create a dev object there - #1310's class; QA caught it on #1401).
--
-- create table if not exists lhq_dev_ai_call_log (
--   id                bigserial   primary key,
--   user_id           uuid,
--   call_type         text        not null,
--   model             text        not null,
--   prompt_tokens     int,
--   completion_tokens int,
--   cost_usd          numeric,
--   cost_source       text        not null,
--   created_at        timestamptz not null default now()
-- );
--
-- alter table lhq_dev_ai_call_log enable row level security;
-- create index if not exists lhq_dev_ai_call_log_created_at_idx on lhq_dev_ai_call_log (created_at desc);
-- create index if not exists lhq_dev_ai_call_log_user_created_idx on lhq_dev_ai_call_log (user_id, created_at desc);

-- Useful query: real spend per account over the last 30 days, and how much of
-- it xAI priced itself versus what we had to estimate or could not measure.
-- select user_id,
--        sum(cost_usd)                                       as usd_30d,
--        count(*)                                            as calls,
--        count(*) filter (where cost_source = 'xai')         as priced_by_xai,
--        count(*) filter (where cost_source = 'unknown')     as unmeasured
-- from lhq_ai_call_log
-- where created_at > now() - interval '30 days'
-- group by 1 order by 2 desc nulls last;
