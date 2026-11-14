-- Push subscriptions are written by the server only (security audit #1413).
--
-- WHY: /api/push/subscribe now validates the endpoint (https, a known push service host, bounded keys; lib/pushEndpoint.ts), but the table's policy "users manage own push subscriptions"
-- is FOR ALL and the table grants let a signed-in user INSERT or UPDATE a row directly with the public anon key, which bypasses that validation completely: a stored endpoint the
-- server later requests. Every real writer already uses the service role (app/api/push/subscribe), so the client write grants are not needed.
--
-- WHAT: revoke INSERT and UPDATE from anon and authenticated; revoke SELECT and DELETE from anon. The server (service role) is unaffected. Idempotent. No data is touched.
--
-- WHAT IS ACTUALLY TRUE PER PROJECT (corrected 2026-11-14; an earlier version of this comment said signed-in users "keep SELECT and DELETE", which was an expectation, not a measurement):
--   DEV (measured by QA with has_table_privilege, #2338): anon has NO privilege; authenticated has SELECT ONLY (no DELETE); service_role has all four. So on dev a signed-in user cannot
--   delete a row directly either; unsubscribing goes through the server route (service role), which is the only writer.
--   PROD: NOT MEASURED. The file revokes INSERT and UPDATE from anon and authenticated and SELECT and DELETE from anon, so whatever else the table grant held for authenticated
--   (SELECT, and DELETE if it was granted) is left as it was. Read it back after applying (see the manifest on #2292) rather than assuming it matches dev.
--
-- BOTH BLOCKS ARE LIVE (PM/DevOps, 2026-11-14): the prod block applies on prod (qdpwhnvmhqgzijuwopso) and the dev block on dev (wdtjhrilakoitfcezxpx). Run each project's own block only:
-- running the whole file on one project fails on the other's table name.
--
-- Roll back: grant insert, update on lhq_push_subscriptions to authenticated (and anon, if it held them); grant select, delete on lhq_push_subscriptions to anon  (and the lhq_dev_ equivalents on dev).

-- ── prod: qdpwhnvmhqgzijuwopso ──────────────────────────────────────────────
revoke insert, update on public.lhq_push_subscriptions from anon, authenticated;
revoke select, delete on public.lhq_push_subscriptions from anon;

-- ── dev: wdtjhrilakoitfcezxpx ───────────────────────────────────────────────
revoke insert, update on public.lhq_dev_push_subscriptions from anon, authenticated;
revoke select, delete on public.lhq_dev_push_subscriptions from anon;
