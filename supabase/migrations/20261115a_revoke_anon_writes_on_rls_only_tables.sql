-- Revoke the anon role's WRITE grants on the app tables that rely on row level security alone.
--
-- *** ALREADY APPLIED on BOTH projects by PM/DevOps (dev first, QA pinned it, then prod with the owner's OK; recorded 2026-11-15). This file is the RECORD of what ran; do not run it again unless the grants have come back. ***
-- PROD READ-BACK (PM): authenticated grants identical before and after (same md5 of the grant list, 111 grants); anon holds no INSERT/UPDATE/DELETE on the 12 tables.
--
-- WHY: the browser's public key signs in as `anon`. On these tables `anon` holds table-level INSERT, UPDATE and/or DELETE. Row level security is ON for all of them, so today
-- the only thing stopping an anonymous write is RLS: where a write policy exists it is scoped to the signed-in owner (`auth.uid() = user_id`, which an anonymous caller can never match),
-- and where NO write policy exists (ai_call_log, alert_fires, alert_grok_log, labels, live_signals) the default-deny of RLS is the only protection. One policy mistake in a later
-- migration would turn a latent grant into an open write. No code path writes these tables as `anon`: every writer is the server with the service role, or a signed-in user (`authenticated`).
--
-- WHAT: revoke INSERT, UPDATE and DELETE from `anon` on those tables. Nothing else:
--   * `authenticated` is NOT touched (signed-in users keep exactly what they have).
--   * `anon` keeps SELECT everywhere it has it: the app reads `labels` with the anon key, and the public market tables are read anonymously.
--   * `liq_events` is NOT touched: its anon INSERT is a deliberate, bounded policy (the browser is the collector; side/source checks), per QA's read.
--   * the service role is not affected by grants revoked from anon.
-- Idempotent: revoking a privilege that is not held is a no-op. Data is not touched.
--
-- ORDER / RISK: no code depends on it, so it can be applied before or after any deploy. The risk to check is the opposite one: a code path that writes one of these tables with the anon key
-- would start to fail. A search of app/ and lib/ for writes shows only service-role and user-session writers; QA's pin (anon has no INSERT/UPDATE/DELETE on these tables, authenticated
-- unchanged) is the check after applying. Apply on dev first, run the app's flows, then prod.
--
-- Run ONE block per project: the prod block on prod (qdpwhnvmhqgzijuwopso), the dev block on dev (wdtjhrilakoitfcezxpx). (Prod needed the owner's OK, a shared-database write; given.)
--
-- CONFIRMED BY QA'S FULL SWEEP (read-only, 2026-11-15, prod at cfe5772 and dev): all 36 prod lhq_ tables have RLS on; the 12 tables below are the ONLY ones where anon holds INSERT/UPDATE/DELETE (liq_events, INSERT only by design, is excluded);
-- every other lhq_ table has no anon write grant; TRUNCATE is not granted to anon on either project. Prod holds all three verbs on most of them, DEV mostly INSERT only (labels all three), so each statement below
-- revokes all three: a revoke of a privilege that is not held is a no-op, which is what lets one statement serve both projects.
--
-- Roll back: grant insert, update, delete on public.<table> to anon;  for each table below.
--
-- READ BACK (after applying, per project; expected: zero rows):
--   select table_name, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and grantee = 'anon' and privilege_type in ('INSERT','UPDATE','DELETE')
--      and table_name in (<the tables below>) order by 1, 2;
--   and the control, which must STILL return its rows: anon SELECT on labels / market tables, and `authenticated` grants unchanged from before.

-- AUTHENTICATED IS UNTOUCHED by this file. Note for the record (PM, 2026-11-15): dev lacked authenticated UPDATE/DELETE on eight lhq_dev_ tables until 2026-11-14, a pre-existing difference between dev and prod
-- that surfaced when QA tested after the dev apply; PM restored those dev grants. Prod authenticated has full INSERT/UPDATE/DELETE on those tables and this file does not change it.
--
-- BEFORE RUNNING EITHER BLOCK, SNAPSHOT authenticated (an earlier dev apply left signed-in users without UPDATE/DELETE on eight tables, so this is checked, not assumed):
--   select table_name, string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
--    where table_schema='public' and grantee='authenticated' and table_name like 'lhq_%' group by 1 order by 1;
-- Run it before and after; the two results must be IDENTICAL. Every statement below names `anon` ONLY: there is no revoke from authenticated, from public, and no `revoke all` in this file.

-- ── prod: qdpwhnvmhqgzijuwopso ──────────────────────────────────────────────
revoke insert, update, delete on public.lhq_ai_call_log          from anon;
revoke insert, update, delete on public.lhq_alert_fires          from anon;
revoke insert, update, delete on public.lhq_alert_grok_log       from anon;
revoke insert, update, delete on public.lhq_hypotheses           from anon;
revoke insert, update, delete on public.lhq_hypothesis_evidence  from anon;
revoke insert, update, delete on public.lhq_labels               from anon;
revoke insert, update, delete on public.lhq_live_signals         from anon;
revoke insert, update, delete on public.lhq_muted_alerts         from anon;
revoke insert, update, delete on public.lhq_price_alerts         from anon;
revoke insert, update, delete on public.lhq_trades               from anon;
revoke insert, update, delete on public.lhq_user_onboarding      from anon;
revoke insert, update, delete on public.lhq_user_settings        from anon;

-- ── dev: wdtjhrilakoitfcezxpx ───────────────────────────────────────────────
revoke insert, update, delete on public.lhq_dev_ai_call_log          from anon;
revoke insert, update, delete on public.lhq_dev_alert_fires          from anon;
revoke insert, update, delete on public.lhq_dev_alert_grok_log       from anon;
revoke insert, update, delete on public.lhq_dev_hypotheses           from anon;
revoke insert, update, delete on public.lhq_dev_hypothesis_evidence  from anon;
revoke insert, update, delete on public.lhq_dev_labels               from anon;
revoke insert, update, delete on public.lhq_dev_live_signals         from anon;
revoke insert, update, delete on public.lhq_dev_muted_alerts         from anon;
revoke insert, update, delete on public.lhq_dev_price_alerts         from anon;
revoke insert, update, delete on public.lhq_dev_trades               from anon;
revoke insert, update, delete on public.lhq_dev_user_onboarding      from anon;
revoke insert, update, delete on public.lhq_dev_user_settings        from anon;
