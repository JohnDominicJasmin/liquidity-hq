/* The alert cron's two reads for the Telegram controls (owner sweep 2026-11-18). The rules live in pure files QA can pin:
 *   lib/alertQuiet.ts   paused / snoozed / quiet hours -> isQuietNow
 *   lib/planLapse.ts    the one "plan ended" message per lapse -> lapseNoticeDue
 * Kept out of app/api/telegram/alert/route.ts so the route only gains two calls. */
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { selectAllRows } from '@/lib/selectAllRows';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { isQuietNow, type AlertHoldSettings } from '@/lib/alertQuiet';
import { lapseNoticeDue, lapseMomentOf, lapsedFromTrial } from '@/lib/planLapse';
import { planEndedText } from '@/lib/telegramBotText';
import type { PlanRow } from '@/lib/paidPeriod';

/** user_ids whose Telegram alerts are held at `nowMs` (paused, snoozed or in quiet hours).
 *  A FAILED READ HOLDS NOBODY: these are preferences, and failing closed would silence every subscriber (including before the columns
 *  migration is applied, when the select names columns that do not exist yet). The failure is logged. */
export async function loadHeldUserIds(nowMs: number): Promise<Set<string>> {
  const held = new Set<string>();
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await selectAllRows('alert:holds', 'user_id', () => admin
      .from(T.user_settings)
      .select('user_id, timezone, alert_paused, alert_snooze_until, alert_quiet_start, alert_quiet_end')
      .not('telegram_chat_id', 'is', null)
      .or('alert_paused.eq.true,alert_snooze_until.not.is.null,alert_quiet_start.not.is.null'));
    if (error) { console.warn('[alert] quiet/snooze/pause settings unreadable; nobody held this run', error.message); return held; }
    for (const row of (data ?? []) as Array<AlertHoldSettings & { user_id: string }>) {
      if (isQuietNow(row, nowMs)) held.add(row.user_id);
    }
  } catch (e) {
    console.warn('[alert] quiet/snooze/pause read failed; nobody held this run', e instanceof Error ? e.message : 'unknown');
  }
  return held;
}

type SubRow = PlanRow & { user_id?: unknown };

const upgradeUrl = () => `${(process.env.NEXT_PUBLIC_APP_URL || 'https://liquidity-hq.com').replace(/\/$/, '')}/upgrade`;

/** Sends the one "plan ended, alerts paused" message to each linked chat whose Pro or trial lapsed within the window and has not had it for
 *  this lapse. The mark is CLAIMED before the send (a conditional update that only one run can win), so two overlapping runs, or a run after
 *  a failed write, never send it twice; the cost is that a failed send is not retried. Returns how many were sent. Never throws. */
export async function sendPlanLapseNotices(token: string, subs: readonly SubRow[], nowMs: number): Promise<number> {
  let sent = 0;
  try {
    const due = subs.filter((r) => typeof r.user_id === 'string' && lapseNoticeDue(r, null, nowMs));
    if (due.length === 0) return 0;
    if (!(await isFeatureEnabled('telegram'))) return 0; // /ops pause: claim nothing, so the message still goes once sends resume
    const admin = getSupabaseAdmin();
    const byUser = new Map(due.map((r) => [r.user_id as string, r]));
    const ids = [...byUser.keys()];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await admin.from(T.user_settings)
        .select('user_id, telegram_chat_id, telegram_lapse_notified_at')
        .in('user_id', ids.slice(i, i + 200))
        .not('telegram_chat_id', 'is', null);
      if (error) { console.warn('[alert] plan-ended notices skipped: settings unreadable', error.message); return sent; }
      for (const s of data ?? []) {
        const userId = s.user_id as string;
        const chatId = typeof s.telegram_chat_id === 'string' ? s.telegram_chat_id.trim() : '';
        const sub = byUser.get(userId);
        if (!chatId || !sub || !lapseNoticeDue(sub, s.telegram_lapse_notified_at as string | null, nowMs)) continue;
        const lapseIso = new Date(lapseMomentOf(sub)!).toISOString();
        const { data: claimed, error: claimErr } = await admin.from(T.user_settings)
          .update({ telegram_lapse_notified_at: new Date(nowMs).toISOString() })
          .eq('user_id', userId)
          .or(`telegram_lapse_notified_at.is.null,telegram_lapse_notified_at.lt."${lapseIso}"`)
          .select('user_id');
        if (claimErr || !claimed?.length) continue;
        try {
          const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: planEndedText(upgradeUrl(), lapsedFromTrial(sub)), disable_web_page_preview: true }),
            signal: AbortSignal.timeout(10_000),
          });
          if (res.ok) sent++;
        } catch { /* claimed and not retried: one missed notice beats one repeated every run */ }
      }
    }
  } catch (e) {
    console.warn('[alert] plan-ended notices failed', e instanceof Error ? e.message : 'unknown');
  }
  return sent;
}
