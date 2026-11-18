/* The one Telegram message a person gets when their Pro or trial ends (owner sweep 2026-11-18).
 *
 * Telegram alerts need Pro or an active trial (lib/paidPeriod.ts planKindOfRow). When that ends the alert cron stops sending, and before this
 * the chat simply went quiet with no word. Now the cron sends ONE message per lapse. "Per lapse" is decided from two times:
 *   the lapse moment   the later of the trial end and the paid period end (+ the 48 h grace planKindOfRow applies to a paid row)
 *   notified_at        user_settings.telegram_lapse_notified_at, written when the message is claimed
 * A message is owed when the plan reads free now, the lapse moment is in the past but within LAPSE_NOTICE_WINDOW_MS, and notified_at is
 * empty or older than the lapse moment. A renewal that lapses again has a later lapse moment, so it gets its own one message.
 *
 * The window stops the first deploy from messaging everyone whose trial ended months ago.
 *
 * Pure and dependency-free (bar paidPeriod, which is too) so QA can pin it directly. */
import { planKindOfRow, PAID_GRACE_MS, type PlanRow } from './paidPeriod.ts';

export const LAPSE_NOTICE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** When this row's Pro or trial stopped covering it (ms), or null when it never had either. */
export function lapseMomentOf(row: PlanRow | null | undefined): number | null {
  if (!row) return null;
  const trialEnd = ms(row.trial_ends_at);
  const periodEnd = ms(row.current_period_end);
  const paidEnd = periodEnd == null ? null : periodEnd + (row.role === 'pro' && row.cancel_at_period_end !== true ? PAID_GRACE_MS : 0);
  const ends = [trialEnd, paidEnd].filter((t): t is number => t != null);
  return ends.length ? Math.max(...ends) : null;
}

/** True when the trial is what ended last (the message says "trial" rather than "plan"). */
export function lapsedFromTrial(row: PlanRow | null | undefined): boolean {
  const trialEnd = ms(row?.trial_ends_at);
  return trialEnd != null && trialEnd === lapseMomentOf(row);
}

/** True when this person is owed the "alerts paused, plan ended" message now. */
export function lapseNoticeDue(row: PlanRow | null | undefined, notifiedAt: string | null | undefined, nowMs: number): boolean {
  if (planKindOfRow(row, nowMs) !== 'free') return false;
  const lapse = lapseMomentOf(row);
  if (lapse == null || lapse > nowMs || nowMs - lapse > LAPSE_NOTICE_WINDOW_MS) return false;
  const sent = ms(notifiedAt);
  return sent == null || sent < lapse;
}
