/* The database half of the short mute from a Telegram alert (lib/alertTypeMute.ts holds the rules). Server only: the service-role client
 * writes user_settings.alert_type_mutes, a column the browser cannot write (migration 20261119w grants it to nobody). */
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { selectAllRows } from '@/lib/selectAllRows';
import { T } from '@/lib/tables';
import {
  parseTypeMuteCallback, readTypeMutes, withTypeMute, typeMuteConfirmation, TYPE_MUTE_SAVE_FAILED, type TypeMutes,
} from '@/lib/alertTypeMute';

/** Every user's stored type mutes, for the alert cron. FAILS OPEN on purpose: a read that fails or takes over 5 s returns an empty map and
 *  the run goes on. Unlike the main mute list (which stops the signal alerts when unreadable, B6), these are at most four hours long and
 *  set by a tap; skipping every signal alert for every user because this one column could not be read (or does not exist yet, before its
 *  migration) would cost far more than one muted type arriving early. */
export async function loadTypeMutesByUser(): Promise<Map<string, TypeMutes>> {
  const empty = new Map<string, TypeMutes>();
  const query = (async () => {
    try {
      const db = getSupabaseAdmin();
      const { data, error } = await selectAllRows('alert:type_mutes', 'user_id', () =>
        db.from(T.user_settings).select('user_id, alert_type_mutes').not('alert_type_mutes', 'is', null));
      if (error || !data) { console.warn('[alert] type mutes unreadable, none applied this run'); return empty; }
      const map = new Map<string, TypeMutes>();
      for (const row of data) map.set(String(row.user_id), readTypeMutes(row.alert_type_mutes));
      return map;
    } catch { console.warn('[alert] type mutes unreadable, none applied this run'); return empty; }
  })();
  const cap = new Promise<Map<string, TypeMutes>>(res => setTimeout(() => res(empty), 5_000));
  return Promise.race([query, cap]);
}

/** One tap on "Mute 1 h" / "Mute 4 h". Returns the text for answerCallbackQuery, or null to answer with no text (nothing was done).
 *  - data outside the allowlist: nothing is read or written.
 *  - a chat linked to no account: nothing is written.
 *  - otherwise the account(s) linked to THIS chat get the type muted until now + hours. The chat id comes from Telegram's own update for
 *    the chat the button was pressed in, never from the callback data, so a tap can only ever mute alerts for the account of that chat. */
export async function applyTypeMuteTap(chatId: string | null, data: string | undefined, nowMs = Date.now()): Promise<string | null> {
  const want = parseTypeMuteCallback(data);
  if (!want || !chatId) return null;
  const admin = getSupabaseAdmin();
  const { data: rows, error } = await admin.from(T.user_settings)
    .select('user_id, alert_type_mutes')
    .eq('telegram_chat_id', chatId);
  if (error) return TYPE_MUTE_SAVE_FAILED;
  if (!rows || rows.length === 0) return null;
  for (const row of rows) {
    const next = withTypeMute(readTypeMutes(row.alert_type_mutes), want.ruleKey, want.hours, nowMs);
    const { error: writeErr } = await admin.from(T.user_settings)
      .update({ alert_type_mutes: next })
      .eq('user_id', row.user_id)
      .eq('telegram_chat_id', chatId);
    if (writeErr) return TYPE_MUTE_SAVE_FAILED;
  }
  return typeMuteConfirmation(want.ruleKey, want.hours);
}
