-- #1632 item 4: liquidation collection moves server-side; the browser write grant on the table is removed.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NOT APPLIED TO ANY DATABASE. PM/DevOps applies it, and ONLY IN THIS ORDER:
--   1. LIQ_COLLECTOR=1 is set on the PRODUCTION service (never on dev/qa/staging: free plan, sleeps).
--   2. The release carrying lib/liqCollector.ts is deployed.
--   3. OBSERVED WORKING: `lhq_api_health` shows source 'liq:collect' ok with a rows-written detail, and
--        select count(*), max(ts) from lhq_liq_events where created_at > now() - interval '30 minutes';
--      moves between two reads a few minutes apart.
--   4. THEN this file, in one window, prod block on prod (qdpwhnvmhqgzijuwopso) and the dev block on dev (wdtjhrilakoitfcezxpx). The prod block needs the owner's OK.
-- Revoking before step 3 stops all liquidation history on a table every visitor loads 5,000 rows from, and the symptom is a chart that thins out over days.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT IT DOES. Removes the INSERT policy `liq_events_insert_bounded` (20260807a) and the browser roles' write privileges on the table. The service role needs neither a policy nor a grant: it bypasses RLS
-- and holds the table privileges, so the server collector keeps writing. The DELETE and UPDATE revoke was already applied on 2026-10-23 (20261023c).
--
-- AFTER IT RUNS, a direct anonymous INSERT and a direct anonymous DELETE must BOTH be refused (QA asserts both: checking only one leaves the other unverified).
--
-- ===================== PROD (qdpwhnvmhqgzijuwopso) =====================
drop policy if exists liq_events_insert_bounded on public.lhq_liq_events;
revoke insert, update, delete, truncate on public.lhq_liq_events from anon, authenticated;

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
drop policy if exists liq_events_insert_bounded on public.lhq_dev_liq_events;
revoke insert, update, delete, truncate on public.lhq_dev_liq_events from anon, authenticated;

-- Read-back (both projects; SELECT must remain for the public read, INSERT must be gone):
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name in ('lhq_liq_events','lhq_dev_liq_events') and grantee in ('anon','authenticated') order by 1,2;
