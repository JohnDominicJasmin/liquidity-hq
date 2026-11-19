import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { computeMarketRead } from '../lib/marketRead.ts';
import { defaultStore, type CoinData, type MarketStore } from '../lib/marketStore.ts';
import { LABEL_KEYS } from '../lib/labelKeys.ts';

/* #2665 (#1185, PM): THE DASHBOARD MARKET READ STATES WHAT THE DATA SHOWS, IN SHORT LINES, WITH NO ADVICE. Written rule (PR body + PM): headline "Most signals agree" / "Signals are mixed" / "Few signals agree" for the good / mid / weak band, sub-lines "Several signals line up right now." / "Signals point different ways right now." / "Few signals line up and momentum is unclear." (12 words or fewer), none of "Good time to trade", "Weak setup - better to wait", "Be picky with entries"; the score and the bands are UNCHANGED (70 and up good, 45 and up mid); the card shows the same words through its labels; the held migration carries the three sub-lines in 5 locales.
 *   F1 the real computeMarketRead over the three bands: exact verdict and sub, same scores as before, sub at most 12 words, no advice vocabulary in verdict, sub, or any factor text
 *   F2 pending (inputs missing) still waits and names what it waits for, without advice
 *   F3 every English string the function can emit has a label key in the display table, and that key's shipped default equals the string, so en shows what the code says
 *   F4 migration 20261125c: PROD = DEV, 3 keys x 5 locales once each, en = default, <= 12 words in en, own script per locale, upsert, only the label tables, held, newest row
 *   F5 the old literals are gone from the Market Read's source (lib/marketRead.ts, lib/marketReadText.ts) */
const root = new URL('../', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), 'utf8').replace(/\r\n/g, '\n');
const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const WED_NOON_UTC = Date.UTC(2026, 8, 30, 12, 0, 0);   // no session window: time 10 + day 10 (premise pinned in marketReadWaitsForInputs M0)
const pinClock = (t: TestContext) => t.mock.timers.enable({ apis: ['Date'], now: WED_NOON_UTC });
function coin(o: Partial<CoinData> = {}): CoinData { return { price: 100, change: 0, high: 100, low: 100, fundingRate: null, oi: null, vol24: null, volRatio: null, longRatio: null, shortRatio: null, bnLongRatio: null, bnShortRatio: null, bnWhaleLongRatio: null, bnWhaleShortRatio: null, rsi14: null, ma20: null, perpPrice: null, rsi5m: null, rsi1h: null, rsi4h: null, rsiDaily: null, rsiWeekly: null, rsiMonthly: null, cvd: null, cvdDivergence: null, poc: null, vah: null, val: null, orderBidWalls: null, orderAskWalls: null, vwap: null, oiTrend: null, takerBuyRatio: null, chartPattern: null, nextFrEstimate: null, nextFundingTime: null, liqDelta: null, liqLongUsd: null, liqShortUsd: null, ...o }; }
const store = (fng: number | null, btc: CoinData | undefined): MarketStore => ({ ...defaultStore, selectedCoin: 'btc', fng, coins: btc ? { btc } : {} });
const words = (s: string) => s.trim().split(/\s+/).length;
const ADVICE = /good time|better to wait|be selective|be picky|picky with|wait for|avoid|should|consider|best to|entry|entries|tighten|skip|proceed|chase|buy now|sell now/i;

test('F1. the three bands read exactly the described words, the scores did not move, no advice anywhere in the card text', (t) => {
  pinClock(t);
  const cases: [number | null, number, string, string, string][] = [[62, 0.0003, 'mid', 'Signals are mixed', 'Signals point different ways right now.'], [50, 0, 'weak', 'Few signals agree', 'Few signals line up and momentum is unclear.']];
  for (const [fng, fr, band, verdict, sub] of cases) { const r = computeMarketRead(store(fng, coin({ fundingRate: fr }))); assert.equal(r.band, band); assert.equal(r.verdict, verdict); assert.equal(r.sub, sub); }
  assert.equal(computeMarketRead(store(62, coin({ fundingRate: 0.0003 }))).score, 68, 'the score moved'); assert.equal(computeMarketRead(store(50, coin({ fundingRate: 0 }))).score, 40, 'the score moved');
  /* the good band: sweep inputs until a read reaches 70 and above (the written threshold), then pin its words */
  let good = null as null | ReturnType<typeof computeMarketRead>;
  for (const fng of [25, 40, 60, 75, 85, 95]) for (const fr of [0.0003, -0.0003, 0.001, -0.001, 0]) for (const walls of [false, true]) {
    const bid = walls ? [{ price: 99.9, size: 100 }] : null; const r = computeMarketRead(store(fng, coin({ fundingRate: fr, orderBidWalls: bid as never }))); if (r.band === 'good' && !good) good = r;
  }
  if (good) { assert.ok(good.score! >= 70); assert.equal(good.verdict, 'Most signals agree'); assert.equal(good.sub, 'Several signals line up right now.'); } else console.log('[MR] no input combination reached the good band at this clock: the good words are pinned by F3 and F5 only');
  /* every band's words: at most 12 words in the sub, no advice in anything the card prints */
  for (const [fng, fr] of [[62, 0.0003], [50, 0], [10, 0], [90, 0.001], [30, -0.001], [75, 0.0003]] as const) {
    const r = computeMarketRead(store(fng, coin({ fundingRate: fr }))); assert.ok(words(r.sub) <= 12, `sub "${r.sub}" is ${words(r.sub)} words`);
    for (const s of [r.verdict, r.sub, ...r.factors.flatMap((f) => [f.label, f.value, f.sub ?? ''])]) assert.equal(ADVICE.test(s), false, `advice wording in the card: "${s}"`);
  }
});
test('F2. while inputs are missing the card still waits, names what it waits for, and does not advise', (t) => {
  pinClock(t);
  const r = computeMarketRead(store(null, coin({ fundingRate: null }))); assert.equal(r.pending, true); assert.equal(r.verdict, 'Reading the market…'); assert.equal(r.score, null);
  assert.equal(r.sub, 'Waiting for Fear & Greed and funding data before giving a read.'); assert.equal(ADVICE.test(r.sub), false);
  assert.equal(computeMarketRead(store(50, coin({ fundingRate: null }))).sub, 'Waiting for funding data before giving a read.');
});
test('F3. every string the read can emit has a display label whose default equals it', () => {
  const table = read('lib/marketReadText.ts'); const pairs = [['Most signals agree', 'MARKET_READ_TXT_GOOD_TIME'], ['Signals are mixed', 'MARKET_READ_TXT_DECENT'], ['Few signals agree', 'MARKET_READ_TXT_WEAK'], ['Several signals line up right now.', 'MARKET_READ_TXT_SUB_GOOD'], ['Signals point different ways right now.', 'MARKET_READ_TXT_SUB_MID'], ['Few signals line up and momentum is unclear.', 'MARKET_READ_TXT_SUB_WEAK'], ['Reading the market…', 'MARKET_READ_TXT_READING_MARKET'], ['Waiting for {items} data before giving a read.', 'MARKET_READ_TXT_WAITING']] as const;
  const reg = new Set<string>(LABEL_KEYS as readonly string[]);
  for (const [en, key] of pairs) { assert.ok(table.includes(`'${en}': '${key}'`), `the display table does not map "${en}" to ${key}`); assert.ok(reg.has(key), `${key} is not registered`); assert.equal(defaults[key], en, `${key}: the shipped default differs from the string the code emits`); }
  /* what the function emits is exactly this set: no other verdict or sub literal in the source */
  const src = read('lib/marketRead.ts').replace(/\/\*[\s\S]*?\*\//g, ''); const vm = /const verdict = [\s\S]*?;\n\s*const sub = [\s\S]*?;\n/.exec(src); assert.ok(vm, 'CONTROL: the verdict / sub block was not found');
  const lits = [...vm![0].replace(/band (===|==|!=) '\w+'|band == null/g, '').matchAll(/'([^']+)'|`([^`]+)`/g)].map((m) => m[1] ?? m[2]); for (const l of lits) assert.ok(pairs.some(([en]) => en === l) || /^Waiting for \$\{/.test(l), `the read emits a string the display table does not know: "${l}"`);
});
test('F4. held migration 20261125c: the three sub-lines in five locales', () => {
  const dir = new URL('supabase/migrations/', root); const FILE = '20261125c_labels_market_read_sub_short.sql'; const sql = readFileSync(new URL(FILE, dir), 'utf8').replace(/\r\n/g, '\n');
  const block = (table: string) => { const m = new RegExp(`insert into ${table} \\(key, locale, value\\) values\\n([\\s\\S]*?)\\non conflict \\(key, locale\\) do update set value = excluded\\.value, updated_at = now\\(\\);`).exec(sql); assert.ok(m, `no upsert for ${table}`); const rows = [...m![1].matchAll(/^\('([A-Z0-9_]+)','([a-z]{2})','((?:[^']|'')*)'\),?$/gm)].map((r) => ({ key: r[1], locale: r[2], value: r[3].replace(/''/g, "'") })); assert.equal(m![1].trim().split('\n').length, rows.length, 'a row did not parse'); return rows; };
  const prod = block('lhq_labels'), dev = block('lhq_dev_labels'); const KEYS = ['MARKET_READ_TXT_SUB_GOOD', 'MARKET_READ_TXT_SUB_MID', 'MARKET_READ_TXT_SUB_WEAK'];
  assert.deepEqual(prod, dev, 'PROD and DEV differ'); assert.equal(prod.length, 15);
  for (const k of KEYS) for (const l of ['en', 'ko', 'zh', 'ru', 'ar']) assert.equal(prod.filter((r) => r.key === k && r.locale === l).length, 1, `${k}/${l}`);
  const v = (k: string, l: string) => prod.find((r) => r.key === k && r.locale === l)!.value;
  for (const k of KEYS) { assert.equal(v(k, 'en'), defaults[k], `${k}: en differs from the shipped default`); assert.ok(words(v(k, 'en')) <= 12, `${k}: more than 12 words`); assert.equal(ADVICE.test(v(k, 'en')), false);
    const S: Record<string, RegExp> = { ko: /[가-힯]/, zh: /[一-鿿]/, ru: /[Ѐ-ӿ]{2,}/, ar: /[؀-ۿ]{2,}/ }; for (const l of ['ko', 'zh', 'ru', 'ar']) { assert.ok(S[l].test(v(k, l)), `${k}/${l}: not in its script`); assert.deepEqual((v(k, l).match(/[A-Za-z]+/g) ?? []), [], `${k}/${l}: Latin words`); } }
  assert.ok(/NOT YET APPLIED TO ANY DATABASE/.test(sql)); assert.equal(/\b(delete|drop|alter|truncate)\b/i.test(sql.replace(/^--.*$/gm, '')), false);
  for (const f of readdirSync(dir).filter((x) => /_labels_.*\.sql$/.test(x) && x > FILE)) { const t = readFileSync(new URL(f, dir), 'utf8'); for (const k of KEYS) assert.equal(new RegExp(`\\('${k}','[a-z]{2}'`).test(t), false, `${f} rewrites ${k} after this migration`); }
});
test('F5. the old advice literals are gone from the Market Read source', () => {
  for (const f of ['lib/marketRead.ts', 'lib/marketReadText.ts']) { const s = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); for (const old of ['Good time to trade', 'Decent conditions - be selective', 'Weak setup - better to wait', 'Be picky with entries', 'A description of the market, not advice']) assert.equal(s.includes(old), false, `${f} still carries "${old}"`); }
});
test('F6. the bands are unchanged: 70 and up good, 45 up to 69 mid, below 45 weak, over a sweep of inputs that reaches the edges', (t) => {
  pinClock(t); const seen = new Set<number>(); let bad = '';
  for (let fng = 0; fng <= 100; fng += 5) for (const fr of [null, 0.0004, -0.0004, 0.001, -0.001, 0, 0.0001, -0.0001, 0.0002, -0.0002]) for (const walls of [0, 1]) {
    const c = coin({ fundingRate: fr, orderBidWalls: walls ? ([{ price: 99.9, size: 100 }] as never) : null, orderAskWalls: walls ? ([{ price: 100.1, size: 100 }] as never) : null }); const r = computeMarketRead(store(fng, c));
    if (r.score == null) continue; seen.add(r.score); const want = r.score >= 70 ? 'good' : r.score >= 45 ? 'mid' : 'weak'; if (r.band !== want) bad = `score ${r.score} banded ${r.band}, expected ${want}`;
    const wantV = want === 'good' ? 'Most signals agree' : want === 'mid' ? 'Signals are mixed' : 'Few signals agree'; if (r.verdict !== wantV) bad = `score ${r.score} reads "${r.verdict}", expected "${wantV}"`;
  }
  assert.equal(bad, '', bad); const sorted = [...seen].sort((a, b) => a - b); console.log(`[MR] scores seen: ${sorted.join(' ')}`);
  assert.ok(sorted.some((s) => s >= 70) && sorted.some((s) => s >= 45 && s < 70) && sorted.some((s) => s < 45), 'CONTROL: the sweep must reach all three bands');
  assert.ok(sorted.some((s) => s >= 45 && s <= 52) || sorted.some((s) => s >= 66 && s <= 72), 'CONTROL: the sweep must come near an edge');
});
