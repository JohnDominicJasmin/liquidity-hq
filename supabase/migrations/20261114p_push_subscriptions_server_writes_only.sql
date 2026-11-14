-- Push subscriptions are written by the server only (security audit #1413).
--
-- WHY: /api/push/subscribe now validates the endpoint (https, a known push service host, bounded keys; lib/pushEndpoint.ts), but the table's policy "users manage own push subscriptions"
-- is FOR ALL and the table grants let a signed-in user INSERT or UPDATE a row directly with the public anon key, which bypasses that validation completely: a stored endpoint the
-- server later requests. Every real writer already uses the service role (app/api/push/subscribe), so the client write grants are not needed.
--
-- WHAT: revoke INSERT and UPDATE from anon and authenticated; revoke SELECT and DELETE from anon. A signed-in user keeps SELECT and DELETE on their own rows (the policy still scopes them),
-- the server (service role) is unaffected. Idempotent. No data is touched.
--
-- BOTH BLOCKS ARE LIVE (PM/DevOps, 2026-11-14): the prod block applies on prod (qdpwhnvmhqgzijuwopso) and the dev block on dev (wdtjhrilakoitfcezxpx). Run each project's own block only:
-- running the whole file on one project fails on the other's table name.
--
-- Roll back: grant insert, update on lhq_push_subscriptions to authenticated; grant select, delete on lhq_push_subscriptions to anon;  (and the lhq_dev_ equivalents on dev).

-- ── prod: qdpwhnvmhqgzijuwopso ──────────────────────────────────────────────
revoke insert, update on public.lhq_push_subscriptions from anon, authenticated;
revoke select, delete on public.lhq_push_subscriptions from anon;

-- ── dev: wdtjhrilakoitfcezxpx ───────────────────────────────────────────────
revoke insert, update on public.lhq_dev_push_subscriptions from anon, authenticated;
revoke select, delete on public.lhq_dev_push_subscriptions from anon;
