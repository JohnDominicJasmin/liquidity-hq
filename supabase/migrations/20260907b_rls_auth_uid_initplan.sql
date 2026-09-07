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
-- OWNER-APPROVED, DEV ONLY (2026-09-07). Their word was "go" against a
-- recommendation that named dev-only explicitly - not prod. So the DEV
-- statements below are the active ones; PROD's are commented, reversing
-- this repo's usual prod-active/dev-commented convention on purpose.
--
-- WHY PROD IS EXCLUDED, written down rather than inferred: production
-- Supabase is on the Free plan and has ZERO backups - not a short window,
-- none - and the owner deferred that upgrade earlier today, deliberately,
-- while there are no real users yet. An RLS policy rewrite with no recovery
-- path behind it is the one combination on the board with no undo. Dev is
-- also where the actual problem lives: it is the project at 91% of its
-- Disk IO budget (#1025), serving both `qa` and `staging`. Prod is not
-- complaining.
--
-- Every statement is `drop policy if exists` + `create policy` with the
-- IDENTICAL using/with check semantics as today's live policy, confirmed by
-- reading each one's own migration (cited per table below) rather than
-- guessed - only the auth.uid() call sites change.
--
-- ROLLBACK: re-run the DROP + CREATE for the affected policy with
-- auth.uid() unwrapped, exactly as it reads in the cited source migration -
-- e.g. lhq_dev_user_settings.user_settings_select reverts by re-running its
-- CREATE with `using (auth.uid() = user_id)` in place of
-- `using ((select auth.uid()) = user_id)`. Every policy below cites its
-- source file; the original clause is a copy from that file, not
-- archaeology. No data changes, no column changes - only the six DEV
-- policies below are touched, and each is a single independent statement.
--
-- SCOPE - what this covers and what it deliberately does not:
--
-- Covers 6 of the 8 previously-prepared tables, DEV ONLY
-- (wdtjhrilakoitfcezxpx): lhq_dev_user_settings, lhq_dev_hypotheses,
-- lhq_dev_hypothesis_evidence, lhq_dev_push_subscriptions,
-- lhq_dev_muted_alerts, lhq_dev_trades, lhq_dev_user_subscriptions - all
-- with current policy text confirmed from a migration file in this repo.
--
-- Does NOT cover lhq_grok_usage (either project) in this pass. Prod's
-- policy was hardened in 20260807a (grok_usage_select_own, select-only)
-- after a critical quota-reset vulnerability; whether dev's equivalent was
-- ever applied is unconfirmed - no migration in this repo shows it, and
-- 20260807b (cited as the dev follow-up) only fixes the
-- increment_ai_usage() function, not this table's policy. Dev's
-- lhq_dev_grok_usage may still carry the original 20260627 policy
-- (`users_own_usage`, FOR ALL) - a security question, not a performance
-- one, and it needs its own check before either project's grok_usage
-- policy is touched here. Still flagged on #1025, not silently
-- rewritten around.
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
-- where tablename in ('lhq_dev_user_status','lhq_dev_price_alerts')`)
-- before a safe rewrite can be written for these two.
--
-- Also does not cover whatever the advisor lists "below the fold" - PM's
-- comment named 9 tables explicitly and said there were more; only those 9
-- (minus grok_usage and the two dashboard-only tables above) were ever
-- scoped, and only the dev side of 7 of those 9 is applied here.
--
-- BEFORE / AFTER: measure the Disk IO budget percentage before applying
-- and again afterward. The whole claim is that per-row auth.uid()
-- re-evaluation is a second contributor to #1025 alongside the sign-in
-- churn already identified. If the budget does not move, that hypothesis
-- was wrong and #1025 goes back to the churn fix alone - a negative result
-- closes a line of enquiry and is worth recording as much as a positive one.
--
-- COURTESY: dev backs both `qa` and `staging` - ask QA for timing before
-- applying, since a policy change landing mid-verification is how a clean
-- run gets misread as a regression. Not a lock; do not wait for an answer.

-- ── lhq_dev_user_settings (supabase/migrations/20260605_user_settings.sql, 20260719_squeeze_threshold.sql) ──
drop policy if exists "user_settings_select" on lhq_dev_user_settings;
create policy "user_settings_select" on lhq_dev_user_settings
  for select using ((select auth.uid()) = user_id);

drop policy if exists "user_settings_insert" on lhq_dev_user_settings;
create policy "user_settings_insert" on lhq_dev_user_settings
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "user_settings_update" on lhq_dev_user_settings;
create policy "user_settings_update" on lhq_dev_user_settings
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ── lhq_dev_hypotheses / lhq_dev_hypothesis_evidence (20260804e) ────────────
drop policy if exists owner_all_hypotheses on lhq_dev_hypotheses;
create policy owner_all_hypotheses on lhq_dev_hypotheses
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists owner_all_evidence on lhq_dev_hypothesis_evidence;
create policy owner_all_evidence on lhq_dev_hypothesis_evidence
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ── lhq_dev_push_subscriptions (20260716_push_subscriptions.sql) ────────────
drop policy if exists "users manage own push subscriptions" on lhq_dev_push_subscriptions;
create policy "users manage own push subscriptions"
  on lhq_dev_push_subscriptions
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ── lhq_dev_muted_alerts (20260717_muted_alerts_per_user.sql) ───────────────
drop policy if exists "users manage own muted alerts" on lhq_dev_muted_alerts;
create policy "users manage own muted alerts"
  on lhq_dev_muted_alerts
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ── lhq_dev_trades (20260804a_trades_user_scoping.sql) ───────────────────────
drop policy if exists "owner_all_trades" on lhq_dev_trades;
create policy "owner_all_trades" on lhq_dev_trades
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ── lhq_dev_user_subscriptions (20260616_user_subscriptions.sql) ────────────
drop policy if exists "sub_select_own" on lhq_dev_user_subscriptions;
create policy "sub_select_own" on lhq_dev_user_subscriptions
  for select using ((select auth.uid()) = user_id);


-- ══════════════════════════════════════════════════════════════════════════
-- PROD (qdpwhnvmhqgzijuwopso) - DEFERRED, not applied. Same statements,
-- lhq_ prefix. See "WHY PROD IS EXCLUDED" above: zero backups on the Free
-- plan, owner deferred the upgrade deliberately, no undo behind this if it
-- shipped wrong. Un-comment and apply only on separate, explicit
-- owner approval for prod specifically.
-- ══════════════════════════════════════════════════════════════════════════

-- drop policy if exists "user_settings_select" on lhq_user_settings;
-- create policy "user_settings_select" on lhq_user_settings
--   for select using ((select auth.uid()) = user_id);
--
-- drop policy if exists "user_settings_insert" on lhq_user_settings;
-- create policy "user_settings_insert" on lhq_user_settings
--   for insert with check ((select auth.uid()) = user_id);
--
-- drop policy if exists "user_settings_update" on lhq_user_settings;
-- create policy "user_settings_update" on lhq_user_settings
--   for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
--
-- drop policy if exists owner_all_hypotheses on lhq_hypotheses;
-- create policy owner_all_hypotheses on lhq_hypotheses
--   for all
--   using ((select auth.uid()) = user_id)
--   with check ((select auth.uid()) = user_id);
--
-- drop policy if exists owner_all_evidence on lhq_hypothesis_evidence;
-- create policy owner_all_evidence on lhq_hypothesis_evidence
--   for all
--   using ((select auth.uid()) = user_id)
--   with check ((select auth.uid()) = user_id);
--
-- drop policy if exists "users manage own push subscriptions" on lhq_push_subscriptions;
-- create policy "users manage own push subscriptions"
--   on lhq_push_subscriptions
--   for all
--   using ((select auth.uid()) = user_id)
--   with check ((select auth.uid()) = user_id);
--
-- drop policy if exists "users manage own muted alerts" on lhq_muted_alerts;
-- create policy "users manage own muted alerts"
--   on lhq_muted_alerts
--   for all
--   using ((select auth.uid()) = user_id)
--   with check ((select auth.uid()) = user_id);
--
-- drop policy if exists "owner_all_trades" on lhq_trades;
-- create policy "owner_all_trades" on lhq_trades
--   for all
--   using ((select auth.uid()) = user_id)
--   with check ((select auth.uid()) = user_id);
--
-- drop policy if exists "sub_select_own" on lhq_user_subscriptions;
-- create policy "sub_select_own" on lhq_user_subscriptions
--   for select using ((select auth.uid()) = user_id);


-- ══════════════════════════════════════════════════════════════════════════
-- lhq_grok_usage (either project) - NOT INCLUDED, either polarity. See
-- "Does NOT cover lhq_grok_usage" above - dev's current policy text is
-- unconfirmed and may still be the pre-20260807a vulnerable shape. Needs
-- its own check before an InitPlan rewrite is written for it.
-- ══════════════════════════════════════════════════════════════════════════
