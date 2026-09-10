-- Completes the dev half of the auth.uid() InitPlan rewrite that
-- 20260907b_rls_auth_uid_initplan.sql deliberately left unfinished.
--
-- WHY THIS FILE EXISTS RATHER THAN AN EDIT TO 20260907b: that file records
-- what it did and why it stopped. It stopped for good reasons, and those
-- reasons are worth keeping readable. This file records what finished the
-- job, on the day it happened. Rewriting the earlier file would have
-- deleted the record of a correct decision.
--
-- APPLIED TO DEV (wdtjhrilakoitfcezxpx) ON 2026-09-11, OWNER-APPROVED.
-- Their instruction was "apply to dev now", after approving both projects
-- in principle. PROD IS NOT TOUCHED HERE and its statements are not
-- included - see DEFERRED below.
--
-- ── WHAT 20260907b DEFERRED, AND WHY IT COULD NOW BE DONE ────────────────
--
-- That file excluded five policies because their current text was
-- UNCONFIRMED: no CREATE POLICY for them exists anywhere in
-- supabase/migrations/. They had been set through the Supabase dashboard,
-- so the repo could not say what they actually were. Its own words:
-- "writing a rewrite for a policy whose exact current text is unverified
-- risks silently changing its semantics instead of just its performance."
--
-- It named the fix: pull the live text from pg_policies first.
--
-- That is exactly what was done. Every statement below was written from
-- the output of:
--
--   select tablename, policyname, cmd, roles, qual, with_check
--   from pg_policies where schemaname = 'public';
--
-- Command, roles and clauses are copied from the live definition. ONLY the
-- auth.uid() call sites change. Nothing was inferred from a table's name
-- or from what a policy "should" say.
--
-- ── A SECURITY QUESTION 20260907b LEFT OPEN, NOW ANSWERED ────────────────
--
-- That file excluded lhq_dev_grok_usage for a SECURITY reason, not a
-- performance one: prod's policy was hardened in 20260807a after a
-- critical quota-reset vulnerability, but whether dev ever received the
-- same hardening was unconfirmed. Dev might still have carried the
-- original 20260627 policy - `users_own_usage`, FOR ALL - which would let
-- a user WRITE their own usage row and reset their own AI quota.
--
-- CHECKED BEFORE TOUCHING IT. lhq_dev_grok_usage carries exactly one
-- policy: grok_usage_select_own, SELECT, authenticated. `users_own_usage`
-- does not exist on dev. So dev WAS hardened, the vulnerability is not
-- present there, and the rewrite below is a pure performance change.
--
-- Recorded because the question was raised in writing and deserves an
-- answer in writing rather than being quietly dropped once it turned out
-- fine.
--
-- ── DUPLICATE POLICIES: PRESENT, DELIBERATELY NOT DROPPED ────────────────
--
-- lhq_dev_hypotheses and lhq_dev_hypothesis_evidence each now carry TWO
-- permissive ALL policies with identical semantics:
--
--   owner_all_hypotheses      (created by 20260907b)
--   owner_all_dev_hypotheses  (pre-existing, rewritten below)
--
-- 20260907b created a NEW policy rather than replacing the differently
-- named existing one. Permissive policies OR together, so access is
-- unchanged - but both were being evaluated, and until this file the
-- pre-existing one still did so per row.
--
-- Both are now InitPlan-folded, so the cost problem is gone. The
-- REDUNDANCY remains and is not resolved here: dropping a live RLS policy
-- is a security change, and doing one as a tidy-up inside a performance
-- migration is how a boundary gets removed by accident. It needs its own
-- decision and its own verification. Flagged on #1157.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────
--
-- Re-run each CREATE below with auth.uid() unwrapped - `auth.uid()` in
-- place of `(select auth.uid())`. Semantics are identical either way; only
-- the query plan differs. No data, columns, grants or role assignments are
-- touched by this file.
--
-- ── VERIFICATION THAT MATTERS ───────────────────────────────────────────
--
-- NOT a timing measurement. These policies are the boundary that stops one
-- user reading another's rows. The check is that an authenticated user
-- still sees exactly their own rows and nothing else, per table. A faster
-- query with a broken isolation boundary is a worse outcome than the
-- slowness it fixed. QA owns that verification.
--
-- The before/after timing question is explicitly abandoned - see #1025.
-- Thirteen foreign tables were dropped from this database at
-- 2026-09-10T16:51:54.804Z and this rewrite followed before a post-delete
-- baseline existed, so neither change can be credited. Recorded as a lost
-- measurement rather than resolved with a plausible attribution.

-- ── lhq_dev_user_subscriptions ──────────────────────────────────────────
-- The entitlement read behind #1119. Live text: SELECT, authenticated,
-- using (user_id = auth.uid()), no with_check.
drop policy if exists "sub_select_own" on lhq_dev_user_subscriptions;
create policy "sub_select_own" on lhq_dev_user_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ── lhq_dev_grok_usage ──────────────────────────────────────────────────
-- Confirmed select-only and hardened before rewriting. See above.
drop policy if exists "grok_usage_select_own" on lhq_dev_grok_usage;
create policy "grok_usage_select_own" on lhq_dev_grok_usage
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ── lhq_dev_price_alerts ────────────────────────────────────────────────
drop policy if exists "price_alerts_own" on lhq_dev_price_alerts;
create policy "price_alerts_own" on lhq_dev_price_alerts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ── lhq_dev_user_onboarding ─────────────────────────────────────────────
drop policy if exists "onboarding_own" on lhq_dev_user_onboarding;
create policy "onboarding_own" on lhq_dev_user_onboarding
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ── lhq_dev_user_status ─────────────────────────────────────────────────
-- Live text is TO public, SELECT only. Preserved exactly - this policy was
-- set via the dashboard and never existed as SQL until now.
drop policy if exists "user can read own status" on lhq_dev_user_status;
create policy "user can read own status" on lhq_dev_user_status
  for select to public
  using ((select auth.uid()) = user_id);

-- ── lhq_dev_hypotheses (the pre-existing duplicate) ─────────────────────
-- No with_check in the live definition; for an ALL policy Postgres applies
-- the using clause to writes, so adding one would CHANGE semantics rather
-- than preserve them. Left absent on purpose.
drop policy if exists "owner_all_dev_hypotheses" on lhq_dev_hypotheses;
create policy "owner_all_dev_hypotheses" on lhq_dev_hypotheses
  for all to public
  using ((select auth.uid()) = user_id);

-- ── lhq_dev_hypothesis_evidence (the pre-existing duplicate) ────────────
drop policy if exists "owner_all_dev_evidence" on lhq_dev_hypothesis_evidence;
create policy "owner_all_dev_evidence" on lhq_dev_hypothesis_evidence
  for all to public
  using ((select auth.uid()) = user_id);

-- ── DEFERRED: PRODUCTION ────────────────────────────────────────────────
--
-- The owner has approved prod in principle - "apply it to dev and prod" -
-- and it is NOT included here, deliberately.
--
-- Prod's live policy text has not been pulled and verified the way dev's
-- was above. Several of these policies were created through the dashboard
-- and are not in this repo, so prod's versions cannot be assumed to match
-- dev's; the two projects have already diverged once, on grok_usage.
--
-- Production Supabase has ZERO backups. An RLS rewrite written from
-- assumed policy text, on a database with no recovery path, is the one
-- combination on this board with no undo.
--
-- So prod gets the same treatment dev got: pull the live text first, write
-- statements from it, apply, then verify isolation - not a copy of this
-- file with the prefix changed.
--
-- After applying to dev this database reports 15 rewritten policies and 0
-- remaining per-row auth.uid() call sites.
