-- Security audit fixes. Every finding below was proven with a live query
-- against prod (set local role + forged request.jwt.claims, inside a
-- transaction that was rolled back) - not inferred from the advisor, which
-- was wrong in both directions on the first pass.
--
-- 1. CRITICAL - lhq_grok_usage let a user reset their own AI quota.
--    Policy `users_own_usage` was FOR ALL with (user_id = auth.uid()) on both
--    USING and WITH CHECK, and anon/authenticated held INSERT/UPDATE/DELETE
--    table grants. So any signed-in user could PATCH or DELETE their own
--    counter row straight through /rest/v1/ and get unlimited AI: the daily
--    caps, the Pro/Free split, and the tool pool were all bypassable, with
--    every reset billed to us at xAI. Proven live: an UPDATE zeroing
--    quick_count/deep_count/chat_count/tool_pool_count as the row's own user
--    succeeded.
--    Nothing in the app writes this table from the client - all 14 AI routes
--    reach it through increment_ai_usage() (SECURITY DEFINER, runs as
--    postgres, bypasses both RLS and grants) or through getSupabaseAdmin()
--    (service_role, ops routes). The client only ever SELECTs its own row for
--    the usage meter. So: keep SELECT-own, drop every client write path.
--
-- 2. HIGH - increment_ai_usage() never checked p_user_id against the caller.
--    SECURITY DEFINER + EXECUTE for `authenticated` + no auth.uid() check =
--    any signed-in account could burn down another user's daily quota by
--    passing their id. Proven live: with request.jwt.claims.sub set to an
--    unrelated uuid, the call still incremented the victim's row (returned 1).
--    Fixed in 20260807b, which has to recreate the whole function body and so
--    is kept out of this grants/policies pass. Note the fix below does NOT
--    cover it: the function is SECURITY DEFINER and runs as postgres, so it
--    sails past the revoked table grants by design.
--
-- 3. lhq_liq_events - INSERT and DELETE were both `true` for public (anon
--    included). Every visitor's browser relays real exchange liquidations into
--    this shared table (components/LiqFeed.tsx), which is why it is writable at
--    all, but `true` also let anyone inject fabricated events into what other
--    users see, or wipe the entire history with one DELETE. Replaced with
--    bounded policies: inserts must look like a plausible recent event, deletes
--    are confined to rows past the app's own 7-day retention cutoff
--    (SB_RETAIN_MS in LiqFeed.tsx), which is the only delete the app performs.
--
-- 4. lhq_signals - INSERT was `true` for authenticated and SELECT is `true`,
--    so one user could inject arbitrary signal rows that other users read.
--    Bounded to plausible values. Written by app/arena/page.tsx.
--
-- 5. lhq_clusters - policy `authenticated_all` (ALL, true/true) on a table no
--    application code reads or writes any more (lib/tables.ts still names it;
--    nothing calls T.clusters) and which holds 0 rows. Write access removed.
--
-- 6. Defense in depth: anon/authenticated held full write grants on
--    lhq_admin_users, lhq_admin_audit_log, lhq_app_config and
--    lhq_disposable_email_domains. Not exploitable today - RLS is enabled with
--    zero policies on all four, which denies everything - but that means the
--    ONLY thing standing between a user and writing themselves into
--    lhq_admin_users is the continued absence of a policy. Anyone adding a
--    well-meaning policy later turns a broad grant into privilege escalation.
--    Every legitimate caller is service_role, so the grants buy nothing.
--    lhq_user_status keeps SELECT (AuthProvider's realtime ban subscription
--    needs it) and loses its writes.
--
-- Run the PROD block against qdpwhnvmhqgzijuwopso. Dev (lhq_dev_*) is applied
-- separately - see 20260807b.

-- ── 1. lhq_grok_usage: read-own only, no client writes ──────────────────────
drop policy if exists users_own_usage on lhq_grok_usage;

create policy grok_usage_select_own on lhq_grok_usage
  for select to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete, truncate on lhq_grok_usage from anon, authenticated;

-- ── 3. lhq_liq_events: bounded relay writes ─────────────────────────────────
drop policy if exists liq_events_public_insert on lhq_liq_events;
drop policy if exists liq_events_public_delete on lhq_liq_events;

create policy liq_events_insert_bounded on lhq_liq_events
  for insert to anon, authenticated
  with check (
        side   in ('LONG','SHORT')
    and source in ('BN','BB')
    and length(coin) between 2 and 12
    and usd   > 0 and usd   < 1000000000
    and price > 0 and price < 10000000
    and ts > (extract(epoch from (now() - interval '3 days')) * 1000)
    and ts < (extract(epoch from (now() + interval '5 minutes')) * 1000)
  );

create policy liq_events_delete_expired on lhq_liq_events
  for delete to anon, authenticated
  using (ts < (extract(epoch from (now() - interval '7 days')) * 1000));

-- ── 4. lhq_signals: bounded inserts ─────────────────────────────────────────
drop policy if exists signals_insert_authenticated on lhq_signals;

create policy signals_insert_bounded on lhq_signals
  for insert to authenticated
  with check (
        signal in ('LONG','SHORT','FLAT')
    and confidence between 0 and 100
    and length(coin) between 2 and 12
    and length(coalesce(entry_zone,'')) <= 200
    and length(coalesce(reasoning,''))  <= 4000
    and length(coalesce(session,''))    <= 64
  );

-- ── 5. lhq_clusters: no client writes (table is unused) ─────────────────────
drop policy if exists authenticated_all on lhq_clusters;

create policy clusters_select_authenticated on lhq_clusters
  for select to authenticated
  using (true);

revoke insert, update, delete, truncate on lhq_clusters from anon, authenticated;

-- ── 6. Grant tightening on RLS-only tables ──────────────────────────────────
revoke insert, update, delete, truncate on
  lhq_admin_users, lhq_admin_audit_log, lhq_app_config,
  lhq_disposable_email_domains, lhq_user_status
  from anon, authenticated;

revoke select on lhq_admin_users, lhq_admin_audit_log, lhq_disposable_email_domains
  from anon, authenticated;

-- increment_global_ai_usage is SECURITY INVOKER, so its anon/authenticated
-- EXECUTE grant is already inert (the body's write to lhq_global_ai_usage is
-- refused for want of a table grant - verified live). Dropping the grant
-- anyway so the exposure does not depend on that second line of defense.
revoke execute on function increment_global_ai_usage(date, integer) from anon, authenticated;
