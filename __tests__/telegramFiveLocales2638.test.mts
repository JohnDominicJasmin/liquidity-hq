import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { TG_LOCALES, tgLocaleOf, tgDateLocale, tgLabel, localizeTelegram, type TgLocale } from '../lib/telegramI18n.ts';
import { TG_PHRASES } from '../lib/telegramPhrases.ts';

/* #2638 THE TELEGRAM BOT SPEAKS vi, pt-BR, tr, es AND id (migration 20261121c, held). The old guard's row parser read only two-letter locale codes and plain '...' values, so the pt-BR rows and the E'' row (TG_BOT_HELP) were never checked: this file parses the migration with a parser that
 * reads BOTH and pins what the PR says: every TG_* label of the app in each of the five locales, once, in the PROD and the DEV block, no en rows; every {placeholder} survives; the HTML tags and entities equal the English (the app's own safety rule refuses a row that differs, which would make
 * that fragment silently English); no text is longer than its English; the bot commands and line breaks of the help text survive; and the app side: tgLocaleOf for each of the five (ar stays English), tgDateLocale per locale, a translated row is used, a missing one is English.
 *   T1 the migration is complete and well-formed   T2 safety: every row passes the app's own markup rule   T3 length and the help text   T4 tgLocaleOf / tgDateLocale   T5 the localizer per locale (translated when present, English when missing or unsafe) */
const FIVE = ['vi', 'pt-BR', 'tr', 'es', 'id'] as const;
const root = new URL('../', import.meta.url);
const EN = JSON.parse(readFileSync(new URL('lib/labelDefaults.en.json', root), 'utf8')) as Record<string, string>;
const TG_KEYS = Object.keys(EN).filter((k) => k.startsWith('TG_'));
const dir = new URL('supabase/migrations/', root);
const file = readdirSync(dir).find((f) => /^20261121c_labels_telegram_vi_pt_tr_es_id\.sql$/.test(f));
const ROW = /\('(TG_[A-Za-z0-9_]+)','([a-z]{2}(?:-[A-Z]{2})?)',(E?)'((?:[^']|'')*)'\)/g;
type Rows = Map<string, Map<string, string>>;
function parse(block: string): { rows: Rows; count: number } {
  const rows: Rows = new Map(); let count = 0;
  for (const m of block.matchAll(ROW)) { count++; const v = m[3] === 'E' ? m[4].replace(/''/g, "'").replace(/\\(.)/g, (_w, c) => (c === 'n' ? '\n' : c)) : m[4].replace(/''/g, "'"); if (!rows.has(m[1])) rows.set(m[1], new Map()); const prev = rows.get(m[1])!; assert.equal(prev.has(m[2]), false, `${m[1]}/${m[2]} appears twice in one block`); prev.set(m[2], v); }
  return { rows, count };
}
const sql = file ? readFileSync(new URL(file, dir), 'utf8').replace(/\r\n/g, '\n') : '';
const p = sql.indexOf('===================== PROD'), d = sql.indexOf('===================== DEV');
const prod = file && p >= 0 && d > p ? parse(sql.slice(p, d)) : { rows: new Map() as Rows, count: 0 }, dev = file && d > p ? parse(sql.slice(d)) : { rows: new Map() as Rows, count: 0 };
const markup = (s: string) => (s.match(/<[^>]*>|&[a-z]+;/g) ?? []).join('');
const place = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

test('T1. CONTROL + completeness: the migration exists; PROD and DEV each hold exactly the app\'s TG_* labels x the five locales (805 rows each at 161 keys), no en rows, the same rows in both blocks', (t) => {
  if (!file) { t.skip('the migration 20261121c is not in this tree'); return; }
  assert.ok(TG_KEYS.length >= 100, `CONTROL: only ${TG_KEYS.length} TG_ keys in the shipped defaults`); assert.equal(prod.count, TG_KEYS.length * 5, `PROD rows: ${prod.count}`); assert.equal(dev.count, TG_KEYS.length * 5, `DEV rows: ${dev.count}`);
  for (const [name, b] of [['PROD', prod], ['DEV', dev]] as const) {
    assert.deepEqual([...b.rows.keys()].sort(), [...TG_KEYS].sort(), `${name}: the keys differ from the app's TG_* labels`);
    for (const k of TG_KEYS) { const loc = b.rows.get(k)!; assert.deepEqual([...loc.keys()].sort(), [...FIVE].sort(), `${name} ${k}: locales ${[...loc.keys()].join(',')}`); assert.equal(loc.has('en'), false, `${name} ${k}: an en row would override the shipped English`); for (const l of FIVE) assert.ok(loc.get(l)!.trim().length > 0, `${name} ${k}/${l}: empty`); }
  }
  for (const [k, loc] of prod.rows) for (const [l, v] of loc) assert.equal(dev.rows.get(k)?.get(l), v, `${k}/${l} differs between PROD and DEV`);
  const phrases = new Set(TG_PHRASES.map(([k]) => k)); const unread = TG_KEYS.filter((k) => !phrases.has(k)); console.log(`[TG] TG_ keys not in TG_PHRASES (rendered by key or unused): ${unread.length}`);
});
test('T2. safety: every row keeps its {placeholders} and passes the app\'s markup rule, so no fragment silently stays English', (t) => {
  if (!file) { t.skip('no migration'); return; }
  const bad: string[] = [];
  for (const k of TG_KEYS) for (const l of FIVE) {
    const v = prod.rows.get(k)?.get(l); if (v === undefined) continue; const en = EN[k];
    if (place(v) !== place(en)) bad.push(`${k}/${l}: placeholders ${place(en)} -> ${place(v)}`);
    if (markup(v) !== markup(en)) bad.push(`${k}/${l}: markup ${JSON.stringify(markup(en))} -> ${JSON.stringify(markup(v))}`);
    else if (v !== en && tgLabel(k, { [k]: v }) !== v) bad.push(`${k}/${l}: the app refuses this row (it would stay English): ${v.slice(0, 40)}`);
  }
  assert.deepEqual(bad.slice(0, 12), [], `${bad.length} rows are unsafe or lose a placeholder`);
});
test('T3. no text is longer than its English (the PR\'s own rule), the help text keeps its five commands and its line count, and the rows that equal the English stay few', (t) => {
  if (!file) { t.skip('no migration'); return; }
  const long: string[] = [], same: Record<string, string[]> = {};
  for (const k of TG_KEYS) for (const l of FIVE) { const v = prod.rows.get(k)?.get(l); if (v === undefined) continue; if ([...v].length > [...EN[k]].length) long.push(`${k}/${l} ${[...v].length}>${[...EN[k]].length}`); if (v === EN[k]) (same[l] ??= []).push(k); }
  for (const l of FIVE) console.log(`[TG] ${l}: ${(same[l] ?? []).length} of ${TG_KEYS.length} rows equal the English`);
  assert.deepEqual(long.slice(0, 12), [], `${long.length} rows are longer than their English`);
  for (const l of FIVE) assert.ok((same[l] ?? []).length <= Math.ceil(TG_KEYS.length * 0.15), `${l}: ${(same[l] ?? []).length} rows equal the English (more than 15 percent look untranslated): ${(same[l] ?? []).slice(0, 10).join(', ')}`);
  for (const l of FIVE) { const h = prod.rows.get('TG_BOT_HELP')!.get(l)!; for (const c of ['/status', '/pause', '/resume', '/stop', '/help']) assert.ok(h.includes(c), `TG_BOT_HELP/${l} lost ${c}`); assert.equal(h.split('\n').length, EN.TG_BOT_HELP.split('\n').length, `TG_BOT_HELP/${l}: a different number of lines`); assert.equal(h.includes('\\n'), false, `TG_BOT_HELP/${l}: a literal backslash-n survived (the E'' string was not decoded)`); assert.equal(h.includes('\r'), false, 'a carriage return'); }
});
test('T4. tgLocaleOf: each of the five maps to itself; ar, other languages and nothing are English; matching is exact; tgDateLocale per locale', () => {
  for (const l of FIVE) assert.equal(tgLocaleOf(l), l, `${l} must be a Telegram locale`);
  for (const l of ['en', 'ko', 'zh', 'ru']) assert.equal(tgLocaleOf(l), l);
  for (const l of ['ar', 'pt', 'PT-BR', 'pt-br', 'vi-VN', 'fr', 'de', 'ja', '', null, undefined, 'xx']) assert.equal(tgLocaleOf(l as string | null | undefined), 'en', `${JSON.stringify(l)} must be English`);
  assert.deepEqual([...TG_LOCALES], ['en', 'ko', 'zh', 'ru', 'vi', 'pt-BR', 'tr', 'es', 'id']);
  const want: Record<TgLocale, string> = { en: 'en-GB', ko: 'ko-KR', zh: 'zh-CN', ru: 'ru-RU', vi: 'vi-VN', 'pt-BR': 'pt-BR', tr: 'tr-TR', es: 'es-ES', id: 'id-ID' };
  for (const l of TG_LOCALES) assert.equal(tgDateLocale(l), want[l], `${l}: the date locale`);
  for (const l of TG_LOCALES) assert.doesNotThrow(() => new Date(Date.UTC(2026, 10, 21)).toLocaleDateString(tgDateLocale(l), { month: 'short', day: 'numeric', timeZone: 'UTC' }), `${l}: the date tag is not a valid BCP 47 tag`);
});
test('T5. the localizer, per locale: a translated row is used, a missing label is English, an unsafe row is English, and the real migration rows localize a real message', (t) => {
  const KEY = TG_PHRASES.find(([k, kind]) => kind === 'start' && EN[k] && /^[A-Za-z/ ]+: ?$/.test(EN[k]))?.[0]; assert.ok(KEY, 'CONTROL: no simple "Label: " phrase to test with');
  const msg = `${EN[KEY!]}<b>60%</b>`;
  for (const l of FIVE) {
    assert.equal(localizeTelegram(msg, l, { [KEY!]: `[${l}] ` }), `[${l}] <b>60%</b>`, `${l}: a translated row was not used`);
    assert.equal(localizeTelegram(msg, l, {}), msg, `${l}: a missing label must leave the English`); assert.equal(localizeTelegram(msg, l, null), msg); assert.equal(localizeTelegram(msg, l, { [KEY!]: '<script>x</script>' }), msg, `${l}: an unsafe row must leave the English`);
  }
  assert.equal(localizeTelegram(msg, 'en', { [KEY!]: 'X ' }), msg, 'English is never translated');
  if (!file) return;
  for (const l of FIVE) {
    const labels: Record<string, string> = {}; for (const k of TG_KEYS) labels[k] = prod.rows.get(k)!.get(l)!;
    const out = localizeTelegram(`${EN.TG_L_LS ?? EN[KEY!]}<b>61.0% Long</b>`, l, labels); assert.ok(out.includes('<b>61.0% Long</b>'), `${l}: the figure and its markup must survive`); assert.ok(!/undefined|\{[a-z]+\}/.test(out), `${l}: ${out}`);
  }
});
