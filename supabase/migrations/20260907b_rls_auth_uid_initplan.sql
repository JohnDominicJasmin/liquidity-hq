-- #1025 (RLS perf lead, PM/DevOps 2026-09-07): Supabase's own performance
-- advisor flags "Auth RLS Initialization Plan" (severity 2) across most of
-- the schema. The pattern in every flagged policy is `auth.uid() = user_id`
-- (or the reverse) written directly - Postgres treats a bare call to
-- auth.uid() as a per-row expression and re-evaluates it for every row the
-- planner scans, so cost scales with TABLE size, not RESULT size. Wrapping
-- the call in a scalar subquery - `(select auth.uid())` - lets Postgres fold
-- it into a single InitPlan the planner evaluates once per statement. Same
-- semantics, same result set, cheaper plan. This is Supabase's own
-- documented fix for this exact advisor warning, not a workaround.
--
-- PREPARED, NOT APPLIED. A policy change is a shared-database write and
-- goes to the owner - see CLAUDE.md and #1025. Every statement below is
-- `drop policy if exists` + `create policy` with the IDENTICAL using/with
-- check semantics as today's live policy, confirmed by reading each one's
-- own migration (cited per table below) rather than guessed - only the
-- auth.uid() call sites change.
--
-- SCOPE - what this covers and what it deliberately does not:
--
-- Covers the 8 tables below, both prod (qdpwhnvmhqgzijuwopso) and dev
-- (wdtjhrilakoitfcezxpx), because both sides' current policy text is
-- confirmed from a migration file in this repo for all 8 - no guessing.
--
-- Does NOT cover lhq_user_status or lhq_price_alerts, both named by the
-- advisor. Neither has a CREATE POLICY statement anywhere in
-- supabase/migrations/ - 20260730_news_realtime.sql's own comment
-- ("done in SQL rather than the dashboard toggle used for lhq_user_status")
-- confirms user_status's policy was set via the Supabase dashboard UI
-- directly, never recorded as SQL. Writing a rewrite for a policy whose
-- exact current text is unverified risks silently changing its semantics
-- instead of just its performance. Needs the current policy text pulled
-- from the dashboard (Database -> Policies, or `select * from pg_policies
-- where tablename in ('lhq_user_status','lhq_dev_user_status',
-- 'lhq_price_alerts','lhq_dev_price_alerts')`) before a safe rewrite can be
-- written for these two.
--
-- Does NOT cover lhq_dev_grok_usage. Prod's policy was hardened in
-- 20260807a (grok_usage_select_own, select-only) after a critical quota-
-- reset vulnerability; that file's own comment says dev needed the
-- equivalent applied "separately" but no migration in this repo shows it
-- happening, and 20260807b (cited as the dev follow-up) only fixes the
-- increment_ai_usage() function, not this table's policy. So dev's
-- lhq_dev_grok_usage may still carry the original 20260627 policy
-- (`users_own_usage`, FOR ALL, the same shape that was CRITICAL on prod) -
-- a security question, not a performance one, and worth its own check
-- before dev is assumed safe. Flagged on #1025 rather than silently
-- rewritten around.
--
-- Also does not cover whatever the advisor lists "below the fold" - PM's
-- comment named 9 tables explicitly and said there were more; only those 9
-- (minus the two above) are addressed here.

-- ── lhq_user_settings (supabase/migrations/20260605_user_settings.sql) ──────
drop policy if exists "user_settings_select" on lhq_user_settings;
create policy "user_settings_select" on lhq_user_settings
  for select using ((select auth.uid()) = user_id);

drop policy if exists "user_settings_insert" on lhq_user_settings;
create policy "user_settings_insert" on lhq_user_settings
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "user_settings_update" on lhq_user_settings;
create policy "user_settings_update" on lhq_user_settings
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ── lhq_hypotheses / lhq_hypothesis_evidence (20260804e) ────────────────────
drop policy if exists owner_all_hypotheses on lhq_hypotheses;
create policy owner_all_hypotheses on lhq_hypotheses
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists owner_all_evidence on lhq_hypothesis_evidence;
create policy owner_all_evidence on lhq_hypothesis_evidence
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ── lhq_push_subscriptions (20260716_push_subscriptions.sql) ────────────────
drop policy if exists "users manage own push subscriptions" on lhq_push_subscriptions;
create policy "users manage own push subscriptions"
  on lhq_push_subscriptions
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ── lhq_muted_alerts (20260717_muted_alerts_per_user.sql) ───────────────────
drop policy if exists "users manage own muted alerts" on lhq_muted_alerts;
create policy "users manage own muted alerts"
  on lhq_muted_alerts
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ── lhq_trades (20260804a_trades_user_scoping.sql) ───────────────────────────
drop policy if exists "owner_all_trades" on lhq_trades;
create policy "owner_all_trades" on lhq_trades
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ── lhq_user_subscriptions (20260616_user_subscriptions.sql) ────────────────
drop policy if exists "sub_select_own" on lhq_user_subscriptions;
create policy "sub_select_own" on lhq_user_subscriptions
  for select using ((select auth.uid()) = user_id);

-- ── lhq_grok_usage - PROD ONLY (20260807a_rls_grant_hardening.sql) ──────────
-- See "Does NOT cover lhq_dev_grok_usage" above for why dev is excluded.
drop policy if exists grok_usage_select_own on lhq_grok_usage;
create policy grok_usage_select_own on lhq_grok_usage
  for select to authenticated
  using (user_id = (select auth.uid()));


-- ══════════════════════════════════════════════════════════════════════════
-- DEV EQUIVALENTS (wdtjhrilakoitfcezxpx) - same statements, lhq_dev_ prefix.
-- Commented per this repo's established convention for prod/dev pairs.
-- ══════════════════════════════════════════════════════════════════════════

-- drop policy if exists "user_settings_select" on lhq_dev_user_settings;
-- create policy "user_settings_select" on lhq_dev_user_settings
--   for select using ((select auth.uid()) = user_id);
--
-- drop policy if exists "user_settings_insert" on lhq_dev_user_settings;
-- create policy "user_settings_insert" on lhq_dev_user_settings
--   for insert with check ((select auth.uid()) = user_id);
--
-- drop policy if exists "user_settings_update" on lhq_dev_user_settings;
-- create policy "user_settings_update" on lhq_dev_user_settings
--   for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
--
-- drop policy if exists owner_all_hypotheses on lhq_dev_hypotheses;
-- create policy owner_all_hypotheses on lhq_dev_hypotheses
--   for all
--   using ((select auth.uid()) = user_id)
--   with check ((select auth.uid()) = user_id);
--
-- drop policy if exists owner_all_evidence on lhq_dev_hypothesis_evidence;
-- create policy owner_all_evidence on lhq_dev_hypothesis_evidence
--   for all
--   using ((select auth.uid()) = user_id)
--   with check ((select auth.uid()) = user_id);
--
-- drop policy if exists "users manage own push subscriptions" on lhq_dev_push_subscriptions;
-- create policy "users manage own push subscriptions"
--   on lhq_dev_push_subscriptions
--   for all
--   using ((select auth.uid()) = user_id)
--   with check ((select auth.uid()) = user_id);
--
-- drop policy if exists "users manage own muted alerts" on lhq_dev_muted_alerts;
-- create policy "users manage own muted alerts"
--   on lhq_dev_muted_alerts
--   for all
--   using ((select auth.uid()) = user_id)
--   with check ((select auth.uid()) = user_id);
--
-- drop policy if exists "owner_all_trades" on lhq_dev_trades;
-- create policy "owner_all_trades" on lhq_dev_trades
--   for all
--   using ((select auth.uid()) = user_id)
--   with check ((select auth.uid()) = user_id);
--
-- drop policy if exists "sub_select_own" on lhq_dev_user_subscriptions;
-- create policy "sub_select_own" on lhq_dev_user_subscriptions
--   for select using ((select auth.uid()) = user_id);
