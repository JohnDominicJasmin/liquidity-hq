/* When a triggered price alert counts as delivered (#1667). PURE: no network, no database, the clock is passed in.
 *
 * WHAT WAS WRONG. The alert cron sent the Telegram message and then switched the alert off unconditionally. A send that failed (bot
 * blocked, chat not found, Telegram down) or was paused by the /ops kill switch still consumed the alert: it was marked triggered, never
 * retried, and the user was never told.
 *
 * THE RULE. An alert is consumed only when at least one message actually landed. A paused send consumes nothing and changes nothing. A
 * failed send keeps the alert active and holds the message that should have gone out, to be sent again after a backoff (5 min, doubling,
 * at most 6 h). The touch already happened, so the retry resends that message rather than waiting for price to cross again.
 *
 * KNOWN LIMIT (v1): the held message lives in the server process. A restart drops it; the alert is still active, so it fires again on the
 * next touch. A retry count that survives restarts needs a column on the alerts table, which is a migration. */

/** What one send attempt achieved, per recipient chat. */
export interface SendResult { sent: number; failed: number; paused: boolean }

/** A triggered alert whose message has not been delivered yet. */
export interface PendingDelivery { body: string; attempts: number; nextAt: number }

export const RETRY_BASE_MS = 5 * 60_000;
export const RETRY_CAP_MS = 6 * 3600_000;

/** Wait before the next attempt after `attempts` failed ones: 5 min, 10, 20, 40 ... capped at 6 h. */
export function retryDelayMs(attempts: number): number {
  return Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

/** Whether a held message may be tried again at `now`. */
export function dueForRetry(p: PendingDelivery, now: number): boolean {
  return now >= p.nextAt;
}

/** The outcome of one attempt: consume the alert, or keep it with what (if anything) is still owed. */
export function afterSend(r: SendResult, prev: PendingDelivery | undefined, body: string, now: number): { consume: boolean; pending: PendingDelivery | null } {
  if (r.sent > 0) return { consume: true, pending: null };
  // Paused by the kill switch: nothing is consumed and nothing is counted. A message already owed stays owed.
  if (r.paused) return { consume: false, pending: prev ?? null };
  const attempts = (prev?.attempts ?? 0) + 1;
  return { consume: false, pending: { body, attempts, nextAt: now + retryDelayMs(attempts) } };
}
