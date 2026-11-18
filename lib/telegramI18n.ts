/* TELEGRAM MESSAGES IN THE READER'S LANGUAGE (#1651, owner sweep 2026-11-18: "Every bot message is English regardless of the user's language").
 *
 * HOW. The message builders keep writing English, exactly as before, so an English reader gets byte-identical messages and every English
 * pin stays true. Just before a message goes to a chat whose saved language is ko / zh / ru / ar, `localizeTelegram` swaps each fixed
 * English fragment for that language's label (lib/telegramPhrases.ts lists the keys; each key's English text is its value in
 * lib/labelDefaults.en.json, the same label system the app uses). Numbers, coin symbols, prices, user text and the HTML stay untouched,
 * because only the listed fixed fragments are ever replaced, in ONE pass (a replacement is never re-read, so a translation cannot be
 * translated again).
 *
 * WHERE A FRAGMENT MAY MATCH ('kind' in the table): `phrase` anywhere; `start` only at the start of a line (the "Price: " style labels, so a
 * news headline that happens to contain "Price:" is never touched: a headline line starts with "<b>"); `end` only at the end of a line;
 * `line` only as a whole line; `key` never matched, rendered by key (`tgText`).
 *
 * SAFETY. A translation is used only if it carries exactly the same HTML tags and entities as the English, and no raw "<", ">" or "&";
 * otherwise that fragment stays English. So a bad label row can never produce a body Telegram's HTML parser rejects. A missing label, a
 * failed label read or an unknown language all mean English. Pure: no I/O here (labels are passed in; lib/telegramLabels.ts loads them). */
import labelDefaults from './labelDefaults.en.json';
import { TG_PHRASES } from './telegramPhrases.ts';

export type TgLocale = 'en' | 'ko' | 'zh' | 'ru' | 'ar';
export const TG_LOCALES: readonly TgLocale[] = ['en', 'ko', 'zh', 'ru', 'ar'];

/** The saved app language as a Telegram locale; anything else (null, a locale the bot has no copy for) is English. */
export function tgLocaleOf(language: string | null | undefined): TgLocale {
  return (TG_LOCALES as readonly string[]).includes(language ?? '') ? (language as TgLocale) : 'en';
}

const DEFAULTS = labelDefaults as Record<string, string>;
const markupOf = (s: string) => (s.match(/<[^>]*>|&[a-z]+;/g) ?? []).join('');
const rawMarkup = (s: string) => /[<>&]/.test(s.replace(/<[^>]*>|&[a-z]+;/g, ''));

/** The label for `key` in these labels, or the English default when it is missing or not HTML-safe. */
export function tgLabel(key: string, labels: Readonly<Record<string, string>> | null | undefined): string {
  const en = DEFAULTS[key] ?? key;
  const v = labels?.[key];
  if (typeof v !== 'string' || !v.trim() || v === en) return en;
  return markupOf(v) === markupOf(en) && !rawMarkup(v) ? v : en;
}

/** A key-only text (buttons, the mute confirmation) with its {placeholders} filled. */
export function tgText(key: string, labels: Readonly<Record<string, string>> | null | undefined, vars: Record<string, string | number> = {}): string {
  return tgLabel(key, labels).replace(/\{(\w+)\}/g, (whole, k: string) => (k in vars ? String(vars[k]) : whole));
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

interface Matcher { re: RegExp; keyOf: (m: string) => string }
let matcher: Matcher | null = null;
/** One alternation of every matchable fragment: whole lines first, then the rest longest first, so the longest fragment at a position wins. */
function getMatcher(): Matcher {
  if (matcher) return matcher;
  const items = TG_PHRASES
    .filter(([key, kind]) => kind !== 'key' && typeof DEFAULTS[key] === 'string' && DEFAULTS[key].length > 0)
    .map(([key, kind]) => ({ key, kind, en: DEFAULTS[key] }))
    .sort((a, b) => (a.kind === 'line' ? 0 : 1) - (b.kind === 'line' ? 0 : 1) || b.en.length - a.en.length);
  const byText = new Map<string, string>();
  const parts: string[] = [];
  for (const it of items) {
    if (byText.has(it.en)) continue; // two keys with one English text (e.g. "BTC FR:"): the first wins, they translate alike
    byText.set(it.en, it.key);
    const body = esc(it.en);
    parts.push(it.kind === 'start' ? `(?<=^|\\n)${body}` : it.kind === 'end' ? `${body}(?=\\n|$)` : it.kind === 'line' ? `(?<=^|\\n)${body}(?=\\n|$)` : body);
  }
  matcher = { re: new RegExp(parts.join('|'), 'g'), keyOf: (m) => byText.get(m) ?? '' };
  return matcher;
}

/* TEXT THAT IS NOT OURS IS NEVER TRANSLATED: a news headline, its source, a user's price-alert note. The builder wraps it in tgKeep(); the
   wrapped part is skipped and the markers are removed on every path (English included), so they never reach a chat. */
const KEEP = '⁣';
export function tgKeep(s: string): string {
  return KEEP + s.replaceAll(KEEP, '') + KEEP;
}

/** The message in the reader's language. English (or no labels) returns the text unchanged apart from removing tgKeep() markers. */
export function localizeTelegram(text: string, locale: TgLocale, labels: Readonly<Record<string, string>> | null | undefined): string {
  if (locale === 'en' || !labels) return text.replaceAll(KEEP, '');
  const { re, keyOf } = getMatcher();
  return text.split(KEEP).map((part, i) => (i % 2 === 1 ? part
    : part.replace(re, (m) => { const key = keyOf(m); return key ? tgLabel(key, labels) : m; }))).join('');
}

/** The inline keyboard under an OI / CVD / rapid-move alert, in the reader's language: each button is rebuilt from its own callback data
 *  (`tmute:<rule>:<hours>`), so its text never depends on matching English. A button whose data is not a mute button is left as it is. */
const TYPE_KEY: Record<string, string> = { oi_spike: 'TG_TYPE_OI', cvd: 'TG_TYPE_CVD', rapid_move: 'TG_TYPE_RAPID' };
export function localizeKeyboard<T extends { inline_keyboard: { text: string; callback_data: string }[][] }>(
  markup: T | null | undefined, locale: TgLocale, labels: Readonly<Record<string, string>> | null | undefined,
): T | null | undefined {
  if (!markup || locale === 'en' || !labels) return markup;
  return {
    ...markup,
    inline_keyboard: markup.inline_keyboard.map((row) => row.map((b) => {
      const m = /^tmute:([a-z_]+):(\d+)$/.exec(b.callback_data);
      if (!m || !TYPE_KEY[m[1]]) return b;
      // The short form ("Mute 1 h") is the one-type message; the long form names the type (lib/alertTypeMute.ts typeMuteKeyboard).
      const text = b.text === `Mute ${m[2]} h`
        ? tgText('TG_MUTE_HOURS', labels, { h: m[2] })
        : tgText('TG_MUTE_TYPE_HOURS', labels, { type: tgLabel(TYPE_KEY[m[1]], labels), h: m[2] });
      return { ...b, text };
    })),
  };
}

/** "Open interest alerts muted for 1 h." in the reader's language. */
export function typeMuteConfirmationIn(ruleKey: string, hours: number, labels: Readonly<Record<string, string>> | null | undefined): string {
  return tgText('TG_MUTED_FOR', labels, { type: tgLabel(TYPE_KEY[ruleKey] ?? '', labels), h: hours });
}

/** The BCP 47 tag for dates in the reader's language (the daily summary's date line). Latin digits in Arabic, like every number in the message. */
export function tgDateLocale(locale: TgLocale): string {
  return locale === 'ko' ? 'ko-KR' : locale === 'zh' ? 'zh-CN' : locale === 'ru' ? 'ru-RU' : locale === 'ar' ? 'ar-u-nu-latn' : 'en-GB';
}
