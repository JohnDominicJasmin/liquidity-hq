/* Every message the bot sends for the commands and the plan-ended notice (owner sweep 2026-11-18).
 *
 * ENGLISH ONLY FOR NOW, AS CONSTANTS, NOT LABELS: the webhook and the alert cron do not know a chat's language yet (that is the languages lane).
 * Kept in one file so that lane has one place to swap them for labels. Short and facts only (owner rule 22). Plain text with <b> only: the
 * sends use parse_mode HTML, so anything user-provided must be escaped by the caller. Pure and dependency-free so QA can pin the wording. */

export const BOT_COMMANDS = ['/status', '/pause', '/resume', '/stop', '/help'] as const;

export const BOT_HELP =
  'Commands:\n' +
  '/status - connection, alerts and plan\n' +
  '/pause - pause all alerts\n' +
  '/resume - turn alerts back on\n' +
  '/stop - disconnect this chat\n' +
  '/help - this list';

export const BOT_NOT_LINKED = 'This chat is not connected. Open Alerts in the app and press Connect Telegram.';
export const BOT_PAUSED = 'Alerts paused. Send /resume to turn them back on.';
export const BOT_RESUMED = 'Alerts are on. Quiet hours, if set, still apply.';
export const BOT_SAVE_FAILED = 'Could not save that. Try again.';
export const BOT_READ_FAILED = 'Could not read your settings. Try again.';

export type BotPlan = 'pro' | 'trial' | 'free';
export type BotAlertState = 'on' | 'paused' | 'snoozed';

const two = (h: number) => String(h).padStart(2, '0');

/** The /status reply for a linked chat. `snoozeUntil` and `quiet` are pre-formatted by the caller; `quiet` null means none set. */
export function botStatusText(o: {
  plan: BotPlan;
  alerts: BotAlertState;
  snoozeUntil?: string | null;
  quiet: { start: number; end: number; timeZone: string } | null;
}): string {
  const plan = o.plan === 'pro' ? 'Pro' : o.plan === 'trial' ? 'Pro trial' : 'Free (Telegram alerts need Pro)';
  const alerts = o.alerts === 'paused' ? 'paused (send /resume)'
    : o.alerts === 'snoozed' ? `snoozed until ${o.snoozeUntil ?? 'later'}`
    : 'on';
  const quiet = o.quiet ? `${two(o.quiet.start)}:00-${two(o.quiet.end)}:00 (${o.quiet.timeZone})` : 'off';
  return `<b>Connected</b>\nAlerts: ${alerts}\nQuiet hours: ${quiet}\nPlan: ${plan}`;
}

/** The one message sent when Pro or the trial ends. `upgradeUrl` is the plan page. */
export function planEndedText(upgradeUrl: string, wasTrial: boolean): string {
  return `Your ${wasTrial ? 'Pro trial' : 'Pro plan'} has ended, so Telegram alerts are paused.\nUpgrade to turn them back on: ${upgradeUrl}`;
}
