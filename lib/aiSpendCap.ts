/* Per-account AI DOLLAR caps, on top of the per-feature call counts (#1399 part 2).
 *
 * Owner's limits (chosen 2026-09-26): Pro $1.00/day AND $10.00/month; free and
 * trial $0.15/day; a whole-site fuse at $10.00/day. These are dollars of MEASURED
 * AI cost from the ledger (lib/aiCallLog.ts writes one row per completed call with
 * cost_usd = xAI's own figure), read here before a new call is allowed.
 *
 * WHY read the ledger and not a rate constant: `SEARCH_CALL_COST_USD` in
 * lib/aiCost.ts is ~4x low against the one real measurement, so any cap built on
 * it would let a heavy user run ~4x over. The ledger's cost_usd is xAI's reported
 * cost (parseAiUsage prefers cost_in_usd_ticks), so summing it is accurate.
 *
 * WHY the sum happens in SQL, not here: this project's PostgREST caps every read
 * at 1000 rows. Reading the ledger rows into JS and summing them TRUNCATED once a
 * window passed 1000 rows (a Pro month, worst case ~3.9k rows; or the whole site
 * in a day), producing a sum that was too LOW - so the monthly cap and the fuse
 * could under-count and never trip (QA, #1437). The two aggregate functions in
 * supabase/migrations/20260927b_ai_spend_sums.sql do the SUM server-side where no
 * row cap applies. They return the exact sum of known costs plus a COUNT of
 * NULL-cost rows per type; the per-type NULL estimate is applied here
 * (spendSumToUsd), so the estimate constants exist in exactly one place and no
 * cost literal lives in SQL.
 *
 * TIMING: cost is only known AFTER a call (recordAiCall runs post-response), so
 * this gate measures PRIOR cumulative spend; one in-flight call can push a touch
 * over the cap. That is the same accepted "no refund" overshoot the call counts
 * already carry (lib/aiUsage.ts) - read-then-decide, not an atomic reserve.
 *
 * The window boundary is decided HERE (dayStartIsoUtc / monthStartIsoUtc) and
 * passed to the functions as p_since, so "today"/"this month" stays UTC-aligned
 * with the call-count day (lib/aiUsage.ts todayUtc) in one place, never in SQL.
 */
import { getSupabaseAdmin } from './supabase-admin.ts';
import { PLAIN_CALL_COST_USD } from './aiCost.ts';
import type { UsageTier } from './limits.ts';

export const PRO_DAILY_CAP_USD    = 1.00;
export const PRO_MONTHLY_CAP_USD   = 10.00;
export const FREE_DAILY_CAP_USD    = 0.15;
export const SITE_FUSE_DAILY_USD   = 10.00;

/* Fallback cost for a ledger row whose cost_usd is NULL (unknown - the schema is
 * explicit "null = UNKNOWN, never 0", so an unmeasured call must not count as free
 * toward a cap). Both are ESTIMATES until the ledger has real rows per type
 * (PM 2026-09-27): chat_search from the one measured search call ($0.0372); every
 * other type from the plain-call estimate already in lib/aiCost.ts. These are the
 * ONLY copy of these numbers - the SQL aggregate returns NULL-row counts, never a
 * cost, precisely so these cannot be duplicated (and drift) in the migration. */
export const NULL_COST_SEARCH_ESTIMATE_USD = 0.0372;
export const NULL_COST_OTHER_ESTIMATE_USD  = PLAIN_CALL_COST_USD;

/** One aggregate row returned by lhq_ai_spend_user_since / lhq_ai_spend_all_since:
 *  the DB's exact sum of known costs, plus counts of NULL-cost rows by type. The
 *  fields arrive as numbers (float8/int casts) but are typed to accept the string
 *  form Postgres numeric/bigint would produce, so a change of cast can't break the
 *  reader. */
export interface SpendSumRow {
  cost: number | string | null;
  null_search: number | string | null;
  null_other: number | string | null;
}

/** Combine one aggregate row into dollars: the exact summed cost of measured
 *  calls, plus the per-type NULL estimate for each unmeasured row. Pure and
 *  DB-free so it is unit-testable on its own. */
export function spendSumToUsd(row: SpendSumRow | null | undefined): number {
  if (!row) return 0;
  const num = (v: number | string | null | undefined): number => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  return num(row.cost)
    + num(row.null_search) * NULL_COST_SEARCH_ESTIMATE_USD
    + num(row.null_other)  * NULL_COST_OTHER_ESTIMATE_USD;
}

/** Start of the current UTC day as an ISO timestamp (matches lib/aiUsage.ts
 *  todayUtc()'s calendar-day boundary, expressed for a created_at range). */
export function dayStartIsoUtc(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10) + 'T00:00:00.000Z';
}

/** Start of the current UTC month as an ISO timestamp. No such helper existed;
 *  the monthly Pro cap needs one. */
export function monthStartIsoUtc(nowMs: number): string {
  const d = new Date(nowMs);
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${d.getUTCFullYear()}-${m}-01T00:00:00.000Z`;
}

export type SpendReason = 'pro_daily' | 'pro_monthly' | 'free_daily' | 'fuse';
export type SpendDecision = { blocked: false } | { blocked: true; reason: SpendReason };

/** A set-returning RPC comes back as an array of rows; take the first (there is
 *  always exactly one aggregate row), tolerating a non-array shape defensively. */
function firstRow(data: unknown): SpendSumRow | null {
  if (Array.isArray(data)) return (data[0] ?? null) as SpendSumRow | null;
  return (data ?? null) as SpendSumRow | null;
}

/**
 * Whether this call must be blocked for exceeding a dollar cap. Called BEFORE the
 * xAI call, alongside the per-feature count reserve.
 *
 * THREE STATES on a ledger-read failure ("unknown is not no", PM 2026-09-27),
 * applied to EACH RPC call (QA #1437):
 *   Pro        -> fails OPEN (returns not-blocked): a read error must not lock out
 *                 a paying customer; the count reserve still bounds them. But a
 *                 read that SUCCEEDED and is over its cap still blocks even if the
 *                 other read errored - fail-open never discards a confirmed
 *                 over-cap (R10/R11).
 *   free/trial -> fails CLOSED (blocked, reason 'free_daily'): do not spend on an
 *                 account whose cheap cap we cannot confirm. A missing migration
 *                 (function not yet created) is an RPC error and lands here, which
 *                 is why the migration is applied BEFORE the deploy.
 */
export async function spendCapBlock(
  tier: UsageTier,
  userId: string,
  nowMs: number = Date.now(),
): Promise<SpendDecision> {
  const db = getSupabaseAdmin();
  const dayStart = dayStartIsoUtc(nowMs);

  try {
    if (tier === 'pro') {
      const monthStart = monthStartIsoUtc(nowMs);
      // Month and day are separate windows (day is not derivable from the month
      // total), so two aggregate calls, in parallel.
      const [monthRes, dayRes] = await Promise.all([
        db.rpc('lhq_ai_spend_user_since', { p_user: userId, p_since: monthStart }),
        db.rpc('lhq_ai_spend_user_since', { p_user: userId, p_since: dayStart }),
      ]);
      // Evaluate each read on its own. A read that SUCCEEDED and is at/over its
      // cap is a CONFIRMED over-limit and must block, even if the OTHER read
      // errored - fail-open is only for a read we could not obtain, and must not
      // discard a cap we already know was exceeded (QA #1437 R10/R11: month came
      // back $12 but the day read errored -> the call must still block on the month).
      if (!monthRes.error && spendSumToUsd(firstRow(monthRes.data)) >= PRO_MONTHLY_CAP_USD) {
        return { blocked: true, reason: 'pro_monthly' };
      }
      if (!dayRes.error && spendSumToUsd(firstRow(dayRes.data)) >= PRO_DAILY_CAP_USD) {
        return { blocked: true, reason: 'pro_daily' };
      }
      // Neither cap confirmed exceeded. A read may have errored (then we could not
      // fully confirm under-cap), but Pro fails OPEN by policy - the count reserve
      // still bounds them; if both reads succeeded, the caller is genuinely under both.
      return { blocked: false };
    }

    // free / trial: own daily cap, then the whole-site fuse.
    const mineRes = await db.rpc('lhq_ai_spend_user_since', { p_user: userId, p_since: dayStart });
    if (mineRes.error) throw mineRes.error;
    if (spendSumToUsd(firstRow(mineRes.data)) >= FREE_DAILY_CAP_USD) {
      return { blocked: true, reason: 'free_daily' };
    }

    // Whole-site fuse: sum today's cost across ALL users. Only free/trial calls are
    // stopped by it (Pro keeps its own per-account caps and never reaches here).
    const siteRes = await db.rpc('lhq_ai_spend_all_since', { p_since: dayStart });
    if (siteRes.error) throw siteRes.error;
    if (spendSumToUsd(firstRow(siteRes.data)) >= SITE_FUSE_DAILY_USD) {
      // The owner-ALERT on trip is the immediate /ops follow-up (it needs a
      // once-a-day dedup store - one `cost_fuse_alerted` column - which this PR
      // deliberately avoids, PM 2026-09-27 option A). Until that lands a tripped
      // fuse BLOCKS SILENTLY: free/trial calls stop and it is visible only in
      // /ops. The block is the protective half and ships now regardless.
      return { blocked: true, reason: 'fuse' };
    }
    return { blocked: false };
  } catch {
    // Ledger read failed - the third state.
    return tier === 'pro' ? { blocked: false } : { blocked: true, reason: 'free_daily' };
  }
}

/** The owner-approved label key for a block reason (en defaults live in
 *  lib/labelDefaults.en.json; wording approved by the owner). */
export function spendCapLabelKey(reason: SpendReason): string {
  switch (reason) {
    case 'pro_daily':   return 'AI_CAP_PRO_DAILY';
    case 'pro_monthly': return 'AI_CAP_PRO_MONTHLY';
    case 'free_daily':  return 'AI_CAP_FREE_DAILY';
    case 'fuse':        return 'AI_CAP_FUSE';
  }
}
