-- #1651 (comment 6358207585, "Most alerts are a coin flip"): make the alert outcome table able to answer the question.
--
-- WHAT THE TABLE LACKED (explained on #1651, comment 6873340397):
--   1. no record of WHEN an outcome was priced, so "24 h" could silently be 30 h (the resolver prices a due row with the live ticker at the first cron tick after the window, up to 200 rows per tick);
--   2. the number that triggered a fire (the RSI value or the squeeze score) only survived as text inside label;
--   3. (code, not schema) a failed insert was swallowed; the cron now reports attempted / stored / failed as the health row alert:fires.
--
-- ADDITIVE and NULLABLE: old rows stay null = "not recorded". Nothing is written by applying it.
-- ORDER: apply this BEFORE the deploy that uses it. If the deploy runs first, the cron's insert (which now names metric_value and threshold_kind) retries WITHOUT those two columns, so no fire is lost; they are stored as null (not recorded) until the columns exist. The resolver RPC change is harmless either way.
--
-- Run against ONE project at a time (per 20260912b): the prod block on prod qdpwhnvmhqgzijuwopso, the dev block (commented) on dev wdtjhrilakoitfcezxpx, which the qa and staging deploys use. The dev block must not run on prod (it would create lhq_dev_* names there).
--
-- Roll back: alter table lhq_alert_fires drop column metric_value, drop column threshold_kind, drop column resolved_at_24h, drop column resolved_at_48h; then re-create lhq_resolve_alert_outcomes from 20260919a.

-- ── prod: qdpwhnvmhqgzijuwopso ──────────────────────────────────────────────
alter table lhq_alert_fires
  add column if not exists metric_value    numeric,
  add column if not exists threshold_kind  text,
  add column if not exists resolved_at_24h timestamptz,
  add column if not exists resolved_at_48h timestamptz;

comment on column lhq_alert_fires.metric_value    is 'The RSI value or squeeze score that triggered the fire. Null = a rule with no per-user threshold, or a row that predates the column.';
comment on column lhq_alert_fires.threshold_kind  is 'rsi_ob | rsi_os | squeeze. Null as above.';
comment on column lhq_alert_fires.resolved_at_24h is 'When the 24 h outcome was priced. The gap to fired_at + 24 h is the resolver lag. Null = predates the column.';
comment on column lhq_alert_fires.resolved_at_48h is 'When the 48 h outcome was priced.';

create or replace function lhq_resolve_alert_outcomes(p_hours integer, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if p_hours = 24 then
    update lhq_alert_fires f
       set price_24h = v.price, outcome_pct_24h = v.pct, resolved_24h = true, resolved_at_24h = now()
      from jsonb_to_recordset(p_rows) as v(id bigint, price numeric, pct numeric)
     where f.id = v.id and not f.resolved_24h;
  elsif p_hours = 48 then
    update lhq_alert_fires f
       set price_48h = v.price, outcome_pct_48h = v.pct, resolved_48h = true, resolved_at_48h = now()
      from jsonb_to_recordset(p_rows) as v(id bigint, price numeric, pct numeric)
     where f.id = v.id and not f.resolved_48h;
  else
    raise exception 'lhq_resolve_alert_outcomes: p_hours must be 24 or 48, got %', p_hours;
  end if;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function lhq_resolve_alert_outcomes(integer, jsonb) from public, anon, authenticated;
grant execute on function lhq_resolve_alert_outcomes(integer, jsonb) to service_role;

-- ── dev: wdtjhrilakoitfcezxpx (byte-identical except the names; apply separately) ─────────
-- alter table lhq_dev_alert_fires
--   add column if not exists metric_value    numeric,
--   add column if not exists threshold_kind  text,
--   add column if not exists resolved_at_24h timestamptz,
--   add column if not exists resolved_at_48h timestamptz;
--
-- create or replace function lhq_dev_resolve_alert_outcomes(p_hours integer, p_rows jsonb)
-- returns integer
-- language plpgsql
-- security definer
-- set search_path = public
-- as $$
-- declare
--   n integer;
-- begin
--   if p_hours = 24 then
--     update lhq_dev_alert_fires f
--        set price_24h = v.price, outcome_pct_24h = v.pct, resolved_24h = true, resolved_at_24h = now()
--       from jsonb_to_recordset(p_rows) as v(id bigint, price numeric, pct numeric)
--      where f.id = v.id and not f.resolved_24h;
--   elsif p_hours = 48 then
--     update lhq_dev_alert_fires f
--        set price_48h = v.price, outcome_pct_48h = v.pct, resolved_48h = true, resolved_at_48h = now()
--       from jsonb_to_recordset(p_rows) as v(id bigint, price numeric, pct numeric)
--      where f.id = v.id and not f.resolved_48h;
--   else
--     raise exception 'lhq_dev_resolve_alert_outcomes: p_hours must be 24 or 48, got %', p_hours;
--   end if;
--   get diagnostics n = row_count;
--   return n;
-- end;
-- $$;
-- revoke execute on function lhq_dev_resolve_alert_outcomes(integer, jsonb) from public, anon, authenticated;
-- grant execute on function lhq_dev_resolve_alert_outcomes(integer, jsonb) to service_role;
