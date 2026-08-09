/* Deriving a source's status for /ops, and separating "broken" from "known".
 *
 * `lhq_api_health` is sorted worst-first so the first thing on screen is what is
 * wrong. That works until a source fails FOREVER for a reason someone already
 * investigated and accepted - then it sits permanently at the top and buries
 * whatever broke this morning.
 *
 * rss:CryptoSlate is the case: 14,234 consecutive failures, `last_ok_at` NULL,
 * and a decision recorded in lib/newsFeeds.ts on 2026-07-31 to KEEP it. It
 * returns 403 from Render's datacenter IP and 200 from an ordinary connection -
 * re-measured 2026-08-10, still 200 and 118KB from a home network - so it is
 * their WAF, not our code, and it can start working again without us doing
 * anything.
 *
 * Removing the feed would lose that. Hiding the row would hide a real state.
 * So it gets its own status instead: still reported, still visible, sorted
 * BELOW anything that might need action.
 *
 * The bar for adding an entry here is deliberately high. It is not "this is
 * failing"; it is "somebody diagnosed this, wrote down why, and decided to
 * leave it". An entry with no reason is indistinguishable from giving up.
 */

export type HealthStatus = 'down' | 'warn' | 'known' | 'ok';

/** source -> why it is expected to fail. The reason is the point. */
export const KNOWN_BLOCKED: Record<string, string> = {
  'rss:CryptoSlate':
    'blocked at their WAF for datacenter IPs - 403 from Render, 200 elsewhere. ' +
    'Kept deliberately (lib/newsFeeds.ts, 2026-07-31): it can recover without a ' +
    'deploy, and 9 other crypto feeds cover the gap.',
};

export interface HealthInput {
  source: string;
  ok: boolean;
  consecutiveFailures: number;
  /** No report in the expected window - unmonitored, which outranks the last outcome. */
  stale: boolean;
  /** Percentage of recent samples that succeeded, or null when there are too few. */
  successRate: number | null;
}

/**
 * STALE STILL OUTRANKS EVERYTHING, including `known`.
 *
 * A known-blocked source that stops reporting at all is a different fact from
 * one that is reporting its expected 403: the first means nothing is running
 * the check any more. Marking it `known` there would hide exactly the failure
 * that matters, so staleness is tested first.
 */
export function deriveHealthStatus(r: HealthInput): HealthStatus {
  if (r.stale) return 'warn';
  if (KNOWN_BLOCKED[r.source]) return r.ok ? 'ok' : 'known';
  if (r.consecutiveFailures >= 3) return 'down';
  if (!r.ok) return 'warn';
  if (r.successRate != null && r.successRate < 80) return 'warn';
  return 'ok';
}

/* Worst first, with `known` between the things that need attention and the
   things that are fine. Above `ok` because it IS a degraded state worth seeing;
   below `warn` because nobody needs to act on it. */
export const STATUS_RANK: Record<HealthStatus, number> = { down: 0, warn: 1, known: 2, ok: 3 };

/** A known source recovering is worth noticing - it means their WAF changed. */
export function knownBlockedReason(source: string): string | undefined {
  return KNOWN_BLOCKED[source];
}
