-- Fixes from running Supabase's own security advisor (get_advisors) against
-- both live projects, prompted by a request to audit Supabase-reliance risk.
-- Every fix here was verified empirically (a live anon-key curl call against
-- the RPC endpoint, not just re-running the advisor) before and after.
--
-- 1. lhq_user_id_by_email / lhq_dev_user_id_by_email (added earlier this
--    session for the ban-reason-on-login feature) - the `revoke ... from
--    public` in its own migration (20260728c) did NOT actually block `anon`/
--    `authenticated` in practice, confirmed by a real unauthenticated curl
--    call succeeding (200, not 401). Supabase grants EXECUTE on new public-
--    schema functions to anon/authenticated directly (not only via PUBLIC
--    membership), so revoking from PUBLIC alone doesn't remove it - anon/
--    authenticated need to be named explicitly. Re-tested after this fix:
--    same call now returns 401 "permission denied for function ...".
--
-- 2. increment_ai_usage - anon (fully unauthenticated) had EXECUTE on a
--    SECURITY DEFINER function that writes lhq_grok_usage/lhq_global_ai_usage,
--    including the app-wide AI circuit breaker counter. Every real caller is
--    already authenticated (see lib/aiUsage.ts) - anon was never supposed to
--    reach this. `authenticated` keeps EXECUTE (intentional, that's the real
--    caller) - separately noted, NOT fixed here: the function never checks
--    p_user_id against the caller's own auth.uid(), so any signed-in account
--    can currently target another user's usage counters. Flagged as a
--    follow-up, not fixed in this pass - it's a live paid-tier quota function,
--    changing its logic deserves its own review rather than folding into a
--    grants-only cleanup.
--
-- 3. search_path hardening on 3 older functions that predate this codebase's
--    now-consistent `set search_path = public` convention (every function
--    written this session already has it) - defense against search_path
--    hijacking on SECURITY DEFINER functions specifically.
--
-- Run the PROD block in qdpwhnvmhqgzijuwopso, the DEV block (commented) in
-- wdtjhrilakoitfcezxpx.

-- ── PROD ─────────────────────────────────────────────────────────────────
revoke execute on function lhq_user_id_by_email(text) from anon, authenticated, public;
revoke execute on function increment_ai_usage(uuid, date, text, integer, integer, integer) from anon;
alter function lhq_normalize_trial_email(text) set search_path = public;
alter function increment_global_ai_usage(date, integer) set search_path = public;

-- ── DEV - run separately against the dev project ────────────────────────────
-- revoke execute on function lhq_dev_user_id_by_email(text) from anon, authenticated, public;
-- revoke execute on function increment_ai_usage(uuid, date, text, integer, integer, integer) from anon;
-- alter function lhq_dev_normalize_trial_email(text) set search_path = public;
