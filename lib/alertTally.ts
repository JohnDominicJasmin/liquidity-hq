/* The alert cron's one line of output, and the only window into a run.
 *
 * It used to print `fired=N sent=N failed=N`, and those three numbers count
 * populations that are not comparable - so the two states a reader most needs
 * to tell apart rendered IDENTICALLY:
 *
 *   every alert correctly filtered out   -> fired=7 sent=0 failed=0
 *   total delivery outage                -> fired=7 sent=0 failed=0
 *
 * That cost part of an investigation on 2026-08-08 (#82). The counts were
 * split then. This file exists so the split cannot quietly close again: a log
 * format nobody asserts on drifts back within a month, and the drift is
 * invisible by construction - nothing fails, the line just stops answering the
 * question.
 *
 * What each number counts, since they are deliberately different populations:
 *
 *   fired      every rule that fired, INCLUDING direct-send checks (news,
 *              fear/greed, daily summary, sentiment) that never enter the
 *              queue - and counting each EMA signal TWICE, once per Anti-Chop
 *              variant, because only the one matching a recipient's setting is
 *              ever delivered. So fired is not an upper bound on sent in any
 *              intuitive way.
 *   queued     the subset subject to per-recipient eligibility.
 *   eligible   of those, how many survived a recipient's mutes and thresholds.
 *              Deduped: two recipients eligible for one entry is 1.
 *   sent       Telegram messages dispatched, after entries are GROUPED BY COIN
 *              into one message each. So sent < eligible is normal.
 *   failed     dispatches that errored.
 *
 * Read it as: `eligible=0` with `fired>0` is correct filtering, nothing is
 * wrong. `eligible>0` with `sent=0` is a real bug.
 */

export interface AlertTally {
  /** Rule keys that fired. Included in the line - that is what makes a
   *  structure alert visible at all without a database query. */
  fired: readonly string[];
  queued: number;
  eligible: number;
  sent: number;
  failed: number;
  recipients: number;
  /** #1266 step 1: per-upstream count of checks that returned early because
   *  their own fetch failed - `fired=0` on a Binance block reads identically
   *  to `fired=0` on a genuinely quiet market otherwise, which is #1266's own
   *  "unknown read as no" bug, one instance of the SAME class this file's own
   *  header describes for fired/sent/failed. Keyed by upstream rather than a
   *  single number, since a future source (e.g. Bybit, once #1266 step 2
   *  lands) shouldn't have to share a bucket with Binance's count to stay
   *  visible. Optional and omitted entirely when every key is zero, so a
   *  healthy run's line is unchanged and `'skipped' in body`-style checks
   *  keep working. */
  skipped?: Readonly<Record<string, number>>;
}

export function formatAlertTally(t: AlertTally): string {
  const skippedEntries = Object.entries(t.skipped ?? {}).filter(([, n]) => n > 0);
  return (
    `[alert] fired=${t.fired.length}${t.fired.length ? ` (${t.fired.join(',')})` : ''} ` +
    `queued=${t.queued} eligible=${t.eligible} ` +
    `sent=${t.sent} failed=${t.failed} recipients=${t.recipients}` +
    (skippedEntries.length ? ` skipped=${skippedEntries.map(([k, n]) => `${k}:${n}`).join(',')}` : '')
  );
}
