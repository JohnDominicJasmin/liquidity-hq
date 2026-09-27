-- AI dollar spend caps (#1399 part 2): move the ledger SUM out of application
-- code and into the database.
--
-- WHY: spendCapBlock (lib/aiSpendCap.ts) originally read the ledger rows with
-- plain PostgREST selects and summed cost_usd in JS. This project's PostgREST
-- caps every read at 1000 rows, so the sum silently TRUNCATED once a window
-- crossed 1000 rows - a Pro user past 1000 calls in a month (worst case ~3.9k)
-- or the whole site past 1000 calls in a day. A truncated sum is too LOW, so
-- the monthly Pro cap and the whole-site fuse would under-count and could never
-- trip. QA caught this on #1437 with a red truncation test. Summing in SQL has
-- no row cap, so the aggregate is exact regardless of volume.
--
-- Two additive, read-only aggregate functions. Both return the real
-- coalesce(sum(cost_usd),0) PLUS a count of rows whose cost_usd is NULL, split
-- into chat_search vs everything else. NO COST LITERAL APPEARS IN THIS FILE by
-- design: the application multiplies those counts by the per-type NULL estimate
-- (the "null = UNKNOWN, never 0" fallback), so the estimate constants live in
-- exactly one place (lib/aiSpendCap.ts NULL_COST_*_ESTIMATE_USD) and cannot
-- drift from a copy embedded in SQL. A NULL call_type is counted as "other" via
-- IS DISTINCT FROM, so no row is ever silently dropped from the sum.
--
-- The window start is passed in as p_since (the TS helpers dayStartIsoUtc /
-- monthStartIsoUtc decide "today"/"this month"); SQL never computes the boundary
-- itself, so the same UTC-day logic the call counts use stays in one place.
--
-- Returns float8 cost and int counts (not numeric/bigint) so the values arrive
-- as plain JS numbers rather than strings; the sums are small dollar amounts and
-- the counts cannot approach int4 range in a day/month, so no precision is lost.
--
-- SECURITY: security definer + a pinned search_path = public (the standard
-- definer hardening), and EXECUTE granted to service_role ONLY. These are
-- called exclusively by the service-role admin client (getSupabaseAdmin);
-- authenticated/anon must not call them - lhq_ai_spend_all_since would otherwise
-- expose the whole site's spend to any signed-in user.
--
-- DEPLOY ORDER: this migration MUST be applied BEFORE the deploy that ships the
-- RPC-calling code. If the functions are missing at runtime the RPC errors, and
-- by the three-state rule in spendCapBlock that fails CLOSED for free/trial
-- (blocking them) - correct as a fail-safe, but it means "migration first, then
-- deploy". Owner-gated like every migration; applied by PM/DevOps with the
-- owner's word. Additive only - no existing object is altered or dropped.
--
-- Run once per project's SQL Editor - table name differs prod vs dev.

-- ── PROD (project qdpwhnvmhqgzijuwopso) - table lhq_ai_call_log ─────────────
create or replace function lhq_ai_spend_user_since(p_user uuid, p_since timestamptz)
returns table(cost float8, null_search int, null_other int)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(cost_usd), 0)::float8,
    count(*) filter (where cost_usd is null and call_type = 'chat_search')::int,
    count(*) filter (where cost_usd is null and call_type is distinct from 'chat_search')::int
  from lhq_ai_call_log
  where user_id = p_user and created_at >= p_since;
$$;

create or replace function lhq_ai_spend_all_since(p_since timestamptz)
returns table(cost float8, null_search int, null_other int)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(cost_usd), 0)::float8,
    count(*) filter (where cost_usd is null and call_type = 'chat_search')::int,
    count(*) filter (where cost_usd is null and call_type is distinct from 'chat_search')::int
  from lhq_ai_call_log
  where created_at >= p_since;
$$;

revoke execute on function lhq_ai_spend_user_since(uuid, timestamptz) from public, anon, authenticated;
grant  execute on function lhq_ai_spend_user_since(uuid, timestamptz) to service_role;
revoke execute on function lhq_ai_spend_all_since(timestamptz) from public, anon, authenticated;
grant  execute on function lhq_ai_spend_all_since(timestamptz) to service_role;

-- ── DEV (project wdtjhrilakoitfcezxpx) - table lhq_dev_ai_call_log ──────────
-- Identical bodies, only the table name differs. Run this block against the dev
-- project instead of the block above. `qa` shares this dev database, so applying
-- it here also covers the qa environment.
--
-- create or replace function lhq_ai_spend_user_since(p_user uuid, p_since timestamptz)
-- returns table(cost float8, null_search int, null_other int)
-- language sql stable security definer set search_path = public as $$
--   select
--     coalesce(sum(cost_usd), 0)::float8,
--     count(*) filter (where cost_usd is null and call_type = 'chat_search')::int,
--     count(*) filter (where cost_usd is null and call_type is distinct from 'chat_search')::int
--   from lhq_dev_ai_call_log
--   where user_id = p_user and created_at >= p_since;
-- $$;
--
-- create or replace function lhq_ai_spend_all_since(p_since timestamptz)
-- returns table(cost float8, null_search int, null_other int)
-- language sql stable security definer set search_path = public as $$
--   select
--     coalesce(sum(cost_usd), 0)::float8,
--     count(*) filter (where cost_usd is null and call_type = 'chat_search')::int,
--     count(*) filter (where cost_usd is null and call_type is distinct from 'chat_search')::int
--   from lhq_dev_ai_call_log
--   where created_at >= p_since;
-- $$;
--
-- revoke execute on function lhq_ai_spend_user_since(uuid, timestamptz) from public, anon, authenticated;
-- grant  execute on function lhq_ai_spend_user_since(uuid, timestamptz) to service_role;
-- revoke execute on function lhq_ai_spend_all_since(timestamptz) from public, anon, authenticated;
-- grant  execute on function lhq_ai_spend_all_since(timestamptz) to service_role;
