-- refund_ai_usage_impl could not refund 12 of the 16 columns it is asked for, and gave back half
-- of each refund it did perform.
--
-- ⚠️ **NOT APPLIED. PENDING QA REVIEW, THEN RELEASE-TIME APPLICATION WITH 20261031a.** Writes to the
-- shared database, so the owner approves it. PM/DevOps asked for it after finding the first symptom.
--
-- ── WHAT IS BROKEN. THREE THINGS, AND ONLY THE FIRST WAS REPORTED ──────────────────────────────
--
-- The live allowlist, read from prod on 2026-11-05:
--
--     if p_column not in ('deep_count', 'quick_count', 'chat_count', 'search_count', 'briefing_count')
--
-- **1. TWELVE REFUNDABLE COLUMNS ARE MISSING.** `increment_ai_usage_impl` accepts sixteen columns.
-- Four of them are on that list. So a refund for any of these raises `22023` and the app logs it
-- and returns null — the user keeps the charge for a call that produced nothing:
--
--     chat_search_count          thesis_check_count       strategy_research_count
--     shadow_account_count       behavioral_bias_count    pine_script_count
--     hypothesis_analyze_count   token_unlock_count       smc_snapshot_count
--     dry_powder_count           macro_context_count      onchain_count
--
-- Every refund path in the app today targets one of those twelve, so **no refund has ever
-- succeeded.** `smc_snapshot_count` is the newest and was added in the same breath as this file.
--
-- **2. `search_count` IS NOT A COLUMN.** It is on the allowlist and does not exist on
-- `lhq_grok_usage` in either project — the real one is `chat_search_count`. So that entry admits a
-- name the `execute format(%I)` below would then fail on, while the column it was meant to name is
-- refused. A dead entry guarding nothing.
--
-- **3. A REFUND GAVE BACK HALF OF ITSELF, and this one nobody had noticed.**
-- `increment_ai_usage_impl` charges a tool TWICE: the tool's own column, and `tool_pool_count`, the
-- shared across-tools budget (it bumps the pool whenever `p_pool_limit` is not null, which
-- `incrementToolUsage` always passes for an extra tool). `refund_ai_usage_impl` decremented the one
-- named column and left the pool spent.
--
-- So even once the allowlist is fixed, every extra-tool refund would still under-credit: the user
-- gets their per-tool count back and stays one call down on the pool that gates all twelve. That is
-- invisible in testing unless you look at `tool_pool_count` specifically, because the per-tool
-- number — the one a refund test would assert on — is correct.
--
-- ── WHAT THIS CHANGES ──────────────────────────────────────────────────────────────────────────
--
-- Rewrites `refund_ai_usage_impl` so that:
--
--   - the allowlist is the SAME SIXTEEN columns `increment_ai_usage_impl` accepts, plus
--     `draw_structure_count`;
--   - `search_count` is gone;
--   - a refund for one of the twelve POOL columns also decrements `tool_pool_count`, in the same
--     statement, so the two cannot diverge.
--
-- `refund_ai_usage` (the thin `auth.uid()` wrapper) is untouched and still refuses a client caller.
--
-- ── `draw_structure_count` IS LISTED THOUGH THE COLUMN DOES NOT EXIST YET, DELIBERATELY ────────
--
-- It is added by 20261031a, which has not been applied to prod — PM/DevOps's permission layer
-- refused it on 2026-11-05 and it runs at release time. Listing it here is safe and makes the two
-- files order-independent in both directions:
--
--   - this file first: the name is accepted by the allowlist, and nothing can reach the `%I` for a
--     column that does not exist, because `increment_ai_usage_impl` has no branch for
--     `draw_structure_count` either — the reservation fails first, which is exactly why Draw
--     Structure answers `503 NOT_ENABLED` today.
--   - 20261031a first: the column and its increment branch exist, and refunds start working the
--     moment this file lands.
--
-- An allowlist entry is a string comparison, not a reference. Leaving it out would mean a third
-- migration later, and that is how the first gap got here.
--
-- ── HOW THE POOL LIST IS DECIDED, AND WHY IT IS NOT "EVERY COLUMN" ─────────────────────────────
--
-- The twelve pool columns are exactly the ones the app reserves through `incrementToolUsage`
-- (`EXTRA_TOOL_COLUMN` in lib/aiUsage.ts). `deep_count`, `quick_count`, `chat_count`,
-- `chat_search_count` and `briefing_count` go through `incrementUsageColumn` with no `poolLimit`,
-- so the pool was never charged for them and must not be credited back.
--
-- Deriving it from the column name inside the function keeps the app's call signature unchanged and
-- puts the charge and the refund rules in one place. The alternative — a `p_refund_pool` boolean
-- passed from TypeScript — would let the two sides disagree, which is the shape of the bug this
-- file is fixing.
--
-- ── WHAT THIS DOES NOT CHANGE, SO NOBODY READS IT AS FIXED ─────────────────────────────────────
--
-- **The `coalesce(refund_count, 0) < 3` cap stays.** A user gets at most three refunds per UTC day;
-- the fourth failed call keeps its charge. That is a deliberate abuse bound and it is also the
-- backstop that keeps the two refund-window issues on #1975's follow-up from being open-ended. Not
-- widened here, because this file is about which refunds WORK and not about how many are allowed.
--
-- **It does not make a failed refund visible.** `v_new is null` still only raises a `notice`, so a
-- refund that finds no row, or hits the cap, is silent to the caller — the app sees `null` and
-- cannot tell "capped" from "no such row" from "nothing to refund". Worth a return-code change, but
-- that is an interface change for both callers and belongs in its own PR.
--
-- ── WHAT TO ASSERT. QA OWNS THE TEST AND THIS IS THE SPEC, NOT THE TEST ───────────────────────
--
-- PM/DevOps asked for "a test that every column reserved via incrementToolUsage/
-- incrementUsageColumn is refundable". **Dev does not write tests** (CONTRIBUTING.md, owner ruling
-- 2026-09-07), so here is what it needs to assert instead of a test file:
--
--   1. **Parity, derived from the source rather than listed.** Extract the column names from
--      `EXTRA_TOOL_COLUMN` plus the five core columns in lib/aiUsage.ts, extract the allowlist from
--      this migration, and assert the sets match. A hand-written expected list in the test would
--      rot the same way the allowlist did, and the rot would be invisible.
--   2. **The pool half.** For one extra tool: reserve, refund, then assert `tool_pool_count` is
--      back where it started. Asserting only the per-tool column passes today on the broken
--      function, so a test that checks just that column is not a test of this fix.
--   3. **The negative.** Refunding `deep_count` must NOT move `tool_pool_count`, because the pool
--      was never charged for it. Without this, "refund the pool for everything" also passes.
--   4. **A column that is not on either list** must still raise `22023` — the allowlist has to stay
--      a guard, not become a pass-through.
--
-- ── VERIFY, AFTER APPLYING ─────────────────────────────────────────────────────────────────────
--
--   -- the allowlist now matches increment's, and search_count is gone
--   SELECT (pg_get_functiondef(oid) LIKE '%smc_snapshot_count%')   AS allows_smc,
--          (pg_get_functiondef(oid) LIKE '%draw_structure_count%') AS allows_draw_structure,
--          (pg_get_functiondef(oid) LIKE '%''search_count''%')     AS still_has_phantom,
--          (pg_get_functiondef(oid) LIKE '%tool_pool_count%')      AS refunds_pool
--   FROM pg_proc WHERE proname = 'refund_ai_usage_impl';
--   -- expect: true, true, FALSE, true
--
-- **DEV HAS NO refund_ai_usage_impl AT ALL.** Queried 2026-11-05: the function is absent from
-- `wdtjhrilakoitfcezxpx`, so 20261023a has been applied to prod only. The DEV section below is
-- therefore a `CREATE OR REPLACE` that will CREATE rather than replace, and that is intended — it
-- brings dev level with prod in one step. Run 20261023a's own dev section first if it does anything
-- besides this function.

-- ════════════════════════════════════════════════════════════════════════════
-- PROD  (qdpwhnvmhqgzijuwopso)
-- Run this section against PROD ONLY.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.refund_ai_usage_impl(p_user_id uuid, p_date date, p_column text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new  integer;
  v_pool boolean;
begin
  /* THE SAME SIXTEEN increment_ai_usage_impl ACCEPTS, PLUS draw_structure_count.
     If you add a tool, it goes in BOTH functions. The parity test QA owns is what catches a
     one-sided edit; this comment is what tells you there are two sides. */
  if p_column not in (
    'deep_count', 'quick_count', 'chat_count', 'chat_search_count', 'briefing_count',
    'thesis_check_count', 'strategy_research_count', 'shadow_account_count',
    'behavioral_bias_count', 'pine_script_count', 'hypothesis_analyze_count',
    'token_unlock_count', 'smc_snapshot_count', 'dry_powder_count',
    'macro_context_count', 'onchain_count', 'draw_structure_count'
  ) then
    raise exception 'refund_ai_usage: unknown column %', p_column using errcode = '22023';
  end if;

  /* THE TWELVE THE POOL WAS CHARGED FOR. These are the columns the app reserves through
     `incrementToolUsage`, which always passes a `p_pool_limit` - so `increment_ai_usage_impl`
     bumped `tool_pool_count` as well, and a refund that ignores it gives back half.
     The five core columns are NOT here: they are reserved with no pool limit, so crediting the
     pool for them would hand out a call nobody paid for. */
  v_pool := p_column in (
    'thesis_check_count', 'strategy_research_count', 'shadow_account_count',
    'behavioral_bias_count', 'pine_script_count', 'hypothesis_analyze_count',
    'token_unlock_count', 'smc_snapshot_count', 'dry_powder_count',
    'macro_context_count', 'onchain_count', 'draw_structure_count'
  );

  /* ONE STATEMENT, so the column and the pool cannot diverge - a second UPDATE could fail on its
     own and leave the refund half-applied, which is the bug this file exists to fix in another
     form. `greatest(x - 1, 0)` on both, so a refund can never drive a counter negative.
     The `refund_count < 3` cap is unchanged and applies to the whole operation. */
  execute format(
    'update lhq_grok_usage set %I = greatest(%I - 1, 0), '
    'tool_pool_count = case when $3 then greatest(tool_pool_count - 1, 0) else tool_pool_count end, '
    'refund_count = coalesce(refund_count, 0) + 1, updated_at = now() '
    'where user_id = $1 and date = $2 and coalesce(refund_count, 0) < 3 returning %I',
    p_column, p_column, p_column
  ) into v_new using p_user_id, p_date, v_pool;

  if v_new is null then
    raise notice 'refund_ai_usage: no refund for % on % (no row, or the daily refund cap is reached)', p_user_id, p_date;
  end if;

  return v_new;
end;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- DEV  (wdtjhrilakoitfcezxpx)
-- Run this section against DEV ONLY. `qa` and `staging` share this project.
--
-- Identical body. This CREATEs rather than replaces: the function is absent from dev as of
-- 2026-11-05, measured, because 20261023a was applied to prod only.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.refund_ai_usage_impl(p_user_id uuid, p_date date, p_column text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new  integer;
  v_pool boolean;
begin
  if p_column not in (
    'deep_count', 'quick_count', 'chat_count', 'chat_search_count', 'briefing_count',
    'thesis_check_count', 'strategy_research_count', 'shadow_account_count',
    'behavioral_bias_count', 'pine_script_count', 'hypothesis_analyze_count',
    'token_unlock_count', 'smc_snapshot_count', 'dry_powder_count',
    'macro_context_count', 'onchain_count', 'draw_structure_count'
  ) then
    raise exception 'refund_ai_usage: unknown column %', p_column using errcode = '22023';
  end if;

  v_pool := p_column in (
    'thesis_check_count', 'strategy_research_count', 'shadow_account_count',
    'behavioral_bias_count', 'pine_script_count', 'hypothesis_analyze_count',
    'token_unlock_count', 'smc_snapshot_count', 'dry_powder_count',
    'macro_context_count', 'onchain_count', 'draw_structure_count'
  );

  execute format(
    'update lhq_dev_grok_usage set %I = greatest(%I - 1, 0), '
    'tool_pool_count = case when $3 then greatest(tool_pool_count - 1, 0) else tool_pool_count end, '
    'refund_count = coalesce(refund_count, 0) + 1, updated_at = now() '
    'where user_id = $1 and date = $2 and coalesce(refund_count, 0) < 3 returning %I',
    p_column, p_column, p_column
  ) into v_new using p_user_id, p_date, v_pool;

  if v_new is null then
    raise notice 'refund_ai_usage: no refund for % on % (no row, or the daily refund cap is reached)', p_user_id, p_date;
  end if;

  return v_new;
end;
$function$;

-- ⚠️ DEV ALSO NEEDS THE WRAPPER, IF 20261023a's dev section has not run. The wrapper is what
-- refuses a client-side caller, and without it nothing does. Checked before applying:
--
--   SELECT proname FROM pg_proc WHERE proname IN ('refund_ai_usage','refund_ai_usage_impl');
--
-- If `refund_ai_usage` is missing on dev, create it from 20261023a rather than from here - that
-- file owns the wrapper and duplicating it is how two definitions drift apart.
