/* SERVER ONLY. The reader's Telegram language and the labels to render it with (lib/telegramI18n.ts holds the pure part, #1651).
 * Every function here falls back to English and never throws: a failed read must never stop or delay a message, only leave it in English. */
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { getLabels } from '@/lib/labelsServer';
import { tgLocaleOf, type TgLocale } from '@/lib/telegramI18n';

/** The label table for a Telegram locale; null for English (the code's own text) or when the table cannot be read. */
export async function tgLabelsFor(locale: TgLocale): Promise<Record<string, string> | null> {
  if (locale === 'en') return null;
  try {
    const { data } = await getLabels(locale);
    return Object.keys(data).length ? data : null;
  } catch {
    return null;
  }
}

/** The tables for every locale in `locales`, read once each (the cron reads them once per run). */
export async function tgLabelsForAll(locales: Iterable<TgLocale>): Promise<Map<TgLocale, Record<string, string> | null>> {
  const out = new Map<TgLocale, Record<string, string> | null>();
  await Promise.all([...new Set(locales)].map(async (l) => { out.set(l, await tgLabelsFor(l)); }));
  return out;
}

/** The saved app language of the account linked to this chat (user_settings.language); English when none or unreadable. */
export async function chatLocale(chatId: string | number | null | undefined): Promise<TgLocale> {
  if (chatId == null || chatId === '') return 'en';
  try {
    const { data } = await getSupabaseAdmin().from(T.user_settings).select('language').eq('telegram_chat_id', String(chatId)).limit(1).maybeSingle();
    return tgLocaleOf(data?.language as string | null | undefined);
  } catch {
    return 'en';
  }
}

/** The saved app language of this account; English when none or unreadable. */
export async function userLocale(userId: string | null | undefined): Promise<TgLocale> {
  if (!userId) return 'en';
  try {
    const { data } = await getSupabaseAdmin().from(T.user_settings).select('language').eq('user_id', userId).maybeSingle();
    return tgLocaleOf(data?.language as string | null | undefined);
  } catch {
    return 'en';
  }
}
