/* THE MACRO EVENT REMINDER HONOURS THE "MACRO HEADLINES" SWITCH AND EACH READER'S CLOCK (#1651, owner sweep 2026-11-18).
 *
 * app/api/macro-alert sent one message, stamped in UTC, to every Pro chat: no switch, no mute. Now:
 *   - a user holding the `macro_news` mute (the "Macro headlines" switch on /alerts) gets no reminder;
 *   - the event time is printed in the user's saved timezone (user_settings.timezone), UTC when none is saved or the name is bad,
 *     the same fallback as the main alert cron.
 * A failed read returns null and the caller sends nothing this run: an unread mute list is not "nothing muted" (same rule as the
 * main alert cron's fetchMutedKeysByUser). No database configured (local) returns empty prefs, so the env chat still gets it. */
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { selectAllRows } from '@/lib/selectAllRows';

export const MACRO_MUTE_KEY = 'macro_news';

export interface MacroChatPrefs {
  mutedChats: Set<string>;
  tzByChat: Map<string, string | null>;
}

/** "14:30 GMT+2" (or "09:30 EST", "21:30 GMT+8": whatever the reader's zone is) in the reader's zone; "06:30 UTC" when the zone is unknown or not a valid IANA name. */
export function eventTimeIn(iso: string, timeZone: string | null): string {
  const d = new Date(iso);
  const utc = () => d.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }) + ' UTC';
  if (!timeZone) return utc();
  try {
    return d.toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  } catch {
    return utc();
  }
}

export async function loadMacroChatPrefs(): Promise<MacroChatPrefs | null> {
  const prefs: MacroChatPrefs = { mutedChats: new Set(), tzByChat: new Map() };
  let admin: ReturnType<typeof getSupabaseAdmin>;
  try { admin = getSupabaseAdmin(); } catch { return prefs; }
  try {
    const [settings, mutes] = await Promise.all([
      selectAllRows('macro-alert:prefs', 'user_id', () => admin
        .from(T.user_settings)
        .select('user_id, telegram_chat_id, timezone')
        .not('telegram_chat_id', 'is', null)
        .neq('telegram_chat_id', '')),
      selectAllRows('macro-alert:mutes', ['user_id', 'key'], () => admin
        .from(T.muted_alerts)
        .select('user_id, key')
        .eq('key', MACRO_MUTE_KEY)),
    ]);
    if (settings.error || mutes.error) return null;
    const mutedUsers = new Set(mutes.data.map((r) => String(r.user_id)));
    for (const row of settings.data) {
      const chatId = String(row.telegram_chat_id ?? '').trim();
      if (!chatId) continue;
      prefs.tzByChat.set(chatId, typeof row.timezone === 'string' && row.timezone ? row.timezone : null);
      if (mutedUsers.has(String(row.user_id))) prefs.mutedChats.add(chatId);
    }
    return prefs;
  } catch {
    return null;
  }
}
