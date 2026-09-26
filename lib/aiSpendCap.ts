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
 * TIMING: cost is only known AFTER a call (recordAiCall runs post-response), so
 * this gate measures PRIOR cumulative spend; one in-flight call can push a touch
 * over the cap. That is the same accepted "no refund" overshoot the call counts
 * already carry (lib/aiUsage.ts) - read-then-decide, not an atomic reserve.
 *
 * Cost is summed ad-hoc from the ledger (no rollup table, PM 2026-09-27): the
 * (user_id, created_at) and (created_at) indexes on lhq_ai_call_log support the
 * windowed reads. Revisit if a day's rows pass ~50k.
 */
import { getSupabaseAdmin } from './supabase-admin.ts';
import { T } from './tables.ts';
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
 * other type from the plain-call estimate already in lib/aiCost.ts. */
export const NULL_COST_SEARCH_ESTIMATE_USD = 0.0372;
export const NULL_COST_OTHER_ESTIMATE_USD  = PLAIN_CALL_COST_USD;

function fallbackCostUsd(callType: string): number {
  return callType === 'chat_search' ? NULL_COST_SEARCH_ESTIMATE_USD : NULL_COST_OTHER_ESTIMATE_USD;
}

interface LedgerRow { cost_usd: number | null; call_type: string; created_at?: string }

/** Sum a set of ledger rows in dollars, substituting the per-type estimate for a
 *  NULL (unknown) cost so unmeasured calls still count. */
export function sumLedgerUsd(rows: LedgerRow[]): number {
  let total = 0;
  for (const r of rows) {
    total += typeof r.cost_usd === 'number' && Number.isFinite(r.cost_usd)
      ? r.cost_usd
      : fallbackCostUsd(r.call_type);
  }
  return total;
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

/**
 * Whether this call must be blocked for exceeding a dollar cap. Called BEFORE the
 * xAI call, alongside the per-feature count reserve.
 *
 * THREE STATES on a ledger-read failure ("unknown is not no", PM 2026-09-27):
 *   Pro        -> fails OPEN (returns not-blocked): a read error must not lock out
 *                 a paying customer; the count reserve still bounds them.
 *   free/trial -> fails CLOSED (blocked, reason 'free_daily'): do not spend on an
 *                 account whose cheap cap we cannot confirm.
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
      // One read over the month window covers both the month and (by filter) the day.
      const monthStart = monthStartIsoUtc(nowMs);
      const { data, error } = await db
        .from(T.ai_call_log)
        .select('cost_usd, call_type, created_at')
        .eq('user_id', userId)
        .gte('created_at', monthStart);
      if (error) throw error;
      const rows = (data ?? []) as LedgerRow[];
      if (sumLedgerUsd(rows) >= PRO_MONTHLY_CAP_USD) return { blocked: true, reason: 'pro_monthly' };
      const dayRows = rows.filter((r) => (r.created_at ?? '') >= dayStart);
      if (sumLedgerUsd(dayRows) >= PRO_DAILY_CAP_USD) return { blocked: true, reason: 'pro_daily' };
      return { blocked: false };
    }

    // free / trial: own daily cap, then the whole-site fuse.
    const { data: mine, error: myErr } = await db
      .from(T.ai_call_log)
      .select('cost_usd, call_type')
      .eq('user_id', userId)
      .gte('created_at', dayStart);
    if (myErr) throw myErr;
    if (sumLedgerUsd((mine ?? []) as LedgerRow[]) >= FREE_DAILY_CAP_USD) {
      return { blocked: true, reason: 'free_daily' };
    }

    // Whole-site fuse: sum today's cost across ALL users. Only free/trial calls are
    // stopped by it (Pro keeps its own per-account caps and never reaches here).
    const { data: site, error: siteErr } = await db
      .from(T.ai_call_log)
      .select('cost_usd, call_type')
      .gte('created_at', dayStart);
    if (siteErr) throw siteErr;
    if (sumLedgerUsd((site ?? []) as LedgerRow[]) >= SITE_FUSE_DAILY_USD) {
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
