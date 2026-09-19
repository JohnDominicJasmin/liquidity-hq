-- #1282 (the last open item): one round trip per window for the hourly outcome
-- resolver, instead of one PATCH per row.
--
-- app/api/alert-outcomes/resolve/route.ts resolved up to 200 rows per window
-- with `await admin.from(T.alert_fires).update(...).eq('id', row.id)` in a loop,
-- the 24h and 48h windows side by side. Each PATCH carries that row's own
-- price and outcome, so a plain PostgREST bulk PATCH cannot express it (one
-- payload for the whole filter), and grouping rows that happen to share a
-- payload would collapse little: the outcome depends on each fire's own
-- price_at_fire, which is captured per fire. An UPDATE ... FROM over a jsonb
-- array is the shape the job actually is: many rows, each with its own
-- values, one statement.
--
-- Guarded with `not resolved_Nh`, so a second run that overlaps the first (or a
-- retry after a partial failure) cannot overwrite an outcome that is already
-- resolved, and the returned count is the rows this call really resolved, not
-- the rows it was asked about.
--
-- Same hardening as lhq_record_api_health (20260731_api_health.sql):
-- security definer with a pinned search_path, executable only through a
-- service-role RPC call, never as an anon/authenticated PostgREST endpoint.
-- The table itself has no INSERT/UPDATE policy (20260719_alert_fires.sql), so
-- nothing new becomes reachable to anon.
--
-- ADDITIVE. CREATE OR REPLACE of a new function, no table or column touched, no
-- data written by applying it. The route calls it, so APPLY THIS BEFORE THE
-- DEPLOY THAT USES IT - on a project where it is missing, every resolve call
-- errors (logged, returned in the response's `errors`, rows stay unresolved and
-- are retried) rather than falling back to the old per-row loop.
-- Roll back: drop function lhq_resolve_alert_outcomes(integer, jsonb);
--
-- Run against BOTH projects: prod qdpwhnvmhqgzijuwopso gets the first block,
-- dev wdtjhrilakoitfcezxpx (and so the qa and staging deploys) the second.
-- lib names them the same way it names tables (env-prefixed), see
-- app/api/alert-outcomes/resolve/route.ts.

-- ── prod: qdpwhnvmhqgzijuwopso ──────────────────────────────────────────────
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
       set price_24h = v.price, outcome_pct_24h = v.pct, resolved_24h = true
      from jsonb_to_recordset(p_rows) as v(id bigint, price numeric, pct numeric)
     where f.id = v.id and not f.resolved_24h;
  elsif p_hours = 48 then
    update lhq_alert_fires f
       set price_48h = v.price, outcome_pct_48h = v.pct, resolved_48h = true
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

-- ── dev: wdtjhrilakoitfcezxpx (byte-identical except the names) ─────────────
create or replace function lhq_dev_resolve_alert_outcomes(p_hours integer, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if p_hours = 24 then
    update lhq_dev_alert_fires f
       set price_24h = v.price, outcome_pct_24h = v.pct, resolved_24h = true
      from jsonb_to_recordset(p_rows) as v(id bigint, price numeric, pct numeric)
     where f.id = v.id and not f.resolved_24h;
  elsif p_hours = 48 then
    update lhq_dev_alert_fires f
       set price_48h = v.price, outcome_pct_48h = v.pct, resolved_48h = true
      from jsonb_to_recordset(p_rows) as v(id bigint, price numeric, pct numeric)
     where f.id = v.id and not f.resolved_48h;
  else
    raise exception 'lhq_dev_resolve_alert_outcomes: p_hours must be 24 or 48, got %', p_hours;
  end if;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function lhq_dev_resolve_alert_outcomes(integer, jsonb) from public, anon, authenticated;
grant execute on function lhq_dev_resolve_alert_outcomes(integer, jsonb) to service_role;
