/* #1626 C (#1647, owner: "Standard RSI"): lib/rsi.ts against an INDEPENDENT oracle, not against itself.
 *
 * THE ORACLE: the published worked example of Wilder's RSI(14) (StockCharts ChartSchool, 33 closes, first RSI on the 15th close). The expected
 * sequence below was reproduced by QA with a separate 6-line implementation before it was written here, so a typo in either would have shown.
 *
 * WHAT THIS PINS: wilderRsiSeries matches the published values to 0.01 on every bar; it is NaN before the 15th close; wilderRsi/computeRSI14 return
 * the last value unrounded and null under 15 closes; a series with no losses reads 100; formatRsi shows one decimal and "-" for nothing (a 29.6 reads
 * "29.6", where a whole-number display read "30"); the RSI route keeps closed candles only (Binance by close time, Bybit without its forming row)
 * and fetches 120 candles; computeKlineMetrics takes its RSI from every CLOSED kline it is given while its other metrics keep the newest 100; the
 * Wilder formula exists in lib/rsi.ts only and the four named helpers elsewhere hand off to it; both RSI badges (Arena scanner, Setup Scanner) compare
 * the unrounded value and round only the text; the four timeframe label rows have five locales, English equal to the build default, placeholders kept.
 *
 * WHAT IT CANNOT PROVE: that an exchange's candles equal TradingView's (the owner's live check on qa: 5 coins x 1h/4h/1D/1W within 0.5), or what a
 * screen draws (checked on the page). A 29.96 still DISPLAYS "30.0" next to the oversold badge, because the badge compares the value (<= 30). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { wilderRsiSeries, wilderRsi, computeRSI14, formatRsi } from '../lib/rsi.ts';
import { computeKlineMetrics, METRIC_WINDOW } from '../lib/klineMetrics.ts';
import { appPath } from './_appPath.mts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CLOSES = [44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931, 46.0328, 45.6140, 46.2820, 46.2820, 46.0028,
  46.0328, 46.4116, 46.2222, 45.6439, 46.2122, 46.2521, 45.7137, 46.4515, 45.7835, 45.3548, 44.0288, 44.1783, 44.2181, 44.5672, 43.4205, 42.6628, 43.1314];
const PUBLISHED = [70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93, 63.26, 56.06, 62.38, 54.71, 50.42, 39.99, 41.46, 41.87, 45.46, 37.30, 33.08, 37.77];

test('O1. the series matches the published Wilder example on every bar (to 0.01), from the 15th close on', () => {
  const s = wilderRsiSeries(CLOSES);
  assert.equal(s.length, CLOSES.length);
  for (let i = 0; i < 14; i++) assert.ok(Number.isNaN(s[i]), `bar ${i} should be undefined (NaN), got ${s[i]}`);
  PUBLISHED.forEach((want, k) => { const got = s[14 + k]; assert.ok(Math.abs(got - want) < 0.01, `bar ${14 + k}: want ${want}, got ${got.toFixed(4)}`); });
});

test('O2. the latest value is the last bar, unrounded; fewer than 15 closes give null; computeRSI14 is the same function', () => {
  const v = wilderRsi(CLOSES)!;
  assert.ok(Math.abs(v - 37.77) < 0.01); assert.equal(Number.isInteger(v), false, 'rounded before use');
  assert.equal(wilderRsi(CLOSES.slice(0, 14)), null); assert.ok(wilderRsi(CLOSES.slice(0, 15)) !== null);
  assert.equal(computeRSI14(CLOSES), v);
});

test('O3. no losses at all reads 100; a one-step series reads its seed', () => {
  assert.equal(wilderRsi(Array.from({ length: 30 }, (_, i) => 100 + i)), 100);
  assert.ok(Math.abs(wilderRsi(CLOSES.slice(0, 15))! - 70.53) < 0.01);
});

test('O4. display: one decimal, "-" for nothing; 29.6 is not shown as "30"; 29.96 still rounds to "30.0"', () => {
  assert.equal(formatRsi(29.6), '29.6'); assert.equal(formatRsi(29.96), '30.0'); assert.equal(formatRsi(37.7712), '37.8');
  assert.equal(formatRsi(null), '-'); assert.equal(formatRsi(Number.NaN), '-');
});

test('S1. the RSI route keeps CLOSED candles only and fetches 120 of them', () => {
  const src = stripTsComments(read(appPath('app/api/market/rsi/route.ts')));
  assert.ok(/const RSI_HISTORY = 120;/.test(src));
  assert.ok(/return \[\.\.\.list\]\.slice\(1\)\.reverse\(\)\.map\(/.test(src), 'the Bybit forming row is not dropped');
  assert.ok(/body\.filter\(\(k: \(string \| number\)\[\]\) => Number\(k\[6\]\) < now\)/.test(src), 'Binance rows are not filtered by their close time');
});

test('K1. computeKlineMetrics: RSI from every CLOSED kline given, while the other metrics keep the newest 100', () => {
  /* 121 klines in Binance's string-array shape. The first 21 fall by 1,000,000 a step and carry a huge quote volume; 99 small steps follow; the 121st is
     the forming candle and jumps by 1e9. An RSI over the newest-100 window, or one that took the forming candle, reads tens of points away from the RSI
     of the 120 closed klines, and a volume ratio averaged over all 121 would read near 0 instead of 1. */
  const closes: number[] = [];
  for (let i = 0; i <= 20; i++) closes.push(1e8 - i * 1e6);
  for (let i = 21; i < 120; i++) closes.push(closes[i - 1] + (i % 3 === 0 ? -1 : 2));
  closes.push(closes[119] + 1e9);
  const klines = closes.map((c, i) => [String(i * 900_000), String(c), String(c * 1.0001), String(c * 0.9999), String(c), '10', String(i * 900_000 + 899_999), String(i <= 20 ? 1e12 : 1000), '5', '5', '500', '0']);
  const m = computeKlineMetrics(klines)!;
  const closed = computeRSI14(closes.slice(0, 120))!; const newest100 = computeRSI14(closes.slice(21, 120))!; const withForming = computeRSI14(closes)!;
  assert.ok(Math.abs(closed - newest100) > 10 && Math.abs(closed - withForming) > 10, `precondition: the fixture must separate the cases (${closed} / ${newest100} / ${withForming})`);
  assert.equal(m.rsi14, closed, 'the RSI is not the one of the 120 closed klines');
  assert.ok(m.volRatio > 0.5 && m.volRatio < 2, `volRatio ${m.volRatio}: the other metrics did not keep the newest ${METRIC_WINDOW}`);
});

test('S2. one RSI: the Wilder formula appears in lib/rsi.ts only, and the four named helpers hand off to it', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
    }
  };
  for (const d of ['app', 'components', 'lib']) walk(d);
  assert.ok(files.length > 100, `precondition: only ${files.length} source files found`);
  const formula = /100\s*-\s*\(?\s*100\s*\/\s*\(\s*1\s*\+/;
  assert.ok(formula.test(stripTsComments(read('lib/rsi.ts'))), 'precondition: the pattern matches the one real implementation');
  assert.deepEqual(files.filter((f) => f !== 'lib/rsi.ts' && formula.test(read(f))), [], 'a second RSI calculation exists');
  const handOffs: [string, RegExp][] = [
    ['lib/orderFlowCore.ts', /export function simpleRSI14\(closes: number\[\]\): number \| null \{\s*return wilderRsi\(closes, 14\);\s*\}/],
    ['lib/divergence.ts', /export function rsiArr\(closes: number\[\], period = 14\): number\[\] \{\s*return wilderRsiSeries\(closes, period\);\s*\}/],
    ['lib/grok.ts', /export function calcRSI\(closes: number\[\], period = 14\): \(number \| null\)\[\] \{\s*return wilderRsiSeries\(closes, period\)\.map\(/],
    ['app/api/telegram/alert/route.ts', /function computeRSI\(closes: number\[\], period = 14\): number \{\s*return wilderRsi\(closes, period\) \?\? 50;\s*\}/],
  ];
  for (const [f, re] of handOffs) assert.ok(re.test(read(f)), `${f}: the helper no longer hands off to lib/rsi.ts`);
});

test('S3. both RSI badges compare the unrounded value; only the text is rounded', () => {
  const arena = read(appPath('app/arena/page.tsx'));
  assert.ok(/const rsi\s*=\s*coin\?\.rsi14 \?\? null;[\s\S]{0,300}?if \(rsi != null && rsi >= 70\)[^\n]*OVERBOUGHT[\s\S]{0,120}?if \(rsi != null && rsi <= 30\)[^\n]*OVERSOLD/.test(arena), 'Arena scanner: the badge does not compare the raw rsi14');
  const setup = read('components/SetupScanner.tsx');
  assert.ok(/const v = formatRsi\(rsi\);\s*if \(rsi >= 70\)[\s\S]{0,200}?if \(rsi <= 30\)/.test(setup), 'Setup Scanner: the badge compares something other than the value');
  assert.ok(/<RsiBadge\s+rsi=\{cd\.rsi14\} \/>/.test(setup), 'Setup Scanner: the badge is not given the raw rsi14');
});

/* L1 used to read one migration by name, `20261021f`. That made it a test about a FILE rather than about the rows, and the owner's #1673
   item 1 rewrote three of these four labels in a later migration - so the named file stopped being what ships, and the test went red on
   wording the owner had deliberately changed. It now finds, per key, the LAST migration that writes that key (the migrations are named in
   date order, which is what makes a filename sort the apply order) and holds that one to the build default. Nothing else about it moved:
   five locales, English equal to the default, and the same placeholders in every language, which is the drift this test exists to catch. */
test('L1. the four RSI timeframe labels: five locales each, English equal to the build default, placeholders kept in every language', () => {
  const keys = ['ALERTS_RSI_DESC', 'BRIEFING_TAG_RSI', 'MARKET_CONDITIONS_WIDGET_RSI_LABEL', 'SETUP_SCANNER_RSI_VAL'];
  const migrations = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort();
  /* Every ('KEY','locale','value') row in one migration. Other migrations in this folder open a line with (' and are not label rows at
     all - two columns, or a different table - so a row is kept only when it has all three parts; a tolerant parse here, because this test
     now reads the whole folder rather than one known file. */
  const rowsIn = (file: string) => read(`supabase/migrations/${file}`).split('\n').filter((l) => l.startsWith("('"))
    .map((l) => l.replace(/^\('/, '').replace(/'\)[,;]?\s*$/, '').split("','"))
    .filter((parts) => parts.length === 3 && parts.every((p) => typeof p === 'string'))
    .map(([key, locale, value]) => ({ key, locale, value: value.split("''").join("'") }));
  /* A MIGRATION MARKED HELD IS NOT THE ANSWER TO "WHAT SHIPS".
     #1673 item 1 split the work: 20261022b carries the English rows and will be applied; 20261022d carries all five locales for the same
     keys and says "HELD: DO NOT APPLY" until a speaker of each language has read them (the owner's decision, told they were machine
     translations). The first version of this test took the LAST migration writing each key by filename, which is the held file - so it
     checked translations that are not going to run and reported success about the shipping state without measuring it. Green for the wrong
     reason, which is worse than red. Held files are excluded from "latest" and checked separately below. */
  const isHeld = (file: string) => /HELD:\s*DO NOT APPLY/i.test(read(`supabase/migrations/${file}`));
  const latest = new Map<string, { file: string; rows: { key: string; locale: string; value: string }[] }>();
  const heldRows = new Map<string, { file: string; locales: string[]; rows: { key: string; locale: string; value: string }[] }>();
  for (const file of migrations) {
    const rows = rowsIn(file);
    for (const k of keys) {
      const mine = rows.filter((r) => r.key === k);
      if (!mine.length) continue;
      if (isHeld(file)) heldRows.set(k, { file, locales: mine.map((r) => r.locale).sort(), rows: mine });
      else latest.set(k, { file, rows: mine });
    }
  }
  assert.deepEqual([...latest.keys()].sort(), keys, 'a label is written by no migration that will be applied: it would ship as the English default in every language');
  const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
  const placeholders = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(',');
  for (const k of keys) {
    const { file, rows } = latest.get(k)!;
    const locales = rows.map((r) => r.locale).sort();
    /* English must always match the build default: that is the row that ships, and a mismatch means the page shows one string and the
       database another. */
    const en = rows.find((r) => r.locale === 'en');
    assert.ok(en, `${k}: ${file} writes no English row, so the default and the database cannot be compared`);
    assert.equal(en.value, defaults[k], `${k}: the English row in ${file} differs from lib/labelDefaults.en.json`);
    for (const r of rows) assert.equal(placeholders(r.value), placeholders(defaults[k]), `${k} ${r.locale}: placeholders changed in "${r.value}" (${file})`);
    if (locales.length === 5) {
      assert.deepEqual(locales, ['ar', 'en', 'ko', 'ru', 'zh'], `${k}: ${file} writes five rows but not the five locales`);
      continue;
    }
    /* ENGLISH-ONLY IS ALLOWED, BUT ONLY WHEN THE REST IS WRITTEN DOWN SOMEWHERE. The owner chose "English now, the rest later", and
       "later" has to be a file that exists, not an intention: otherwise the four other languages silently keep the old shorthand forever
       and nothing in the repo remembers they were meant to change. */
    assert.deepEqual(locales, ['en'], `${k}: ${file} writes ${locales.join('/')} - neither all five locales nor English alone`);
    const held = heldRows.get(k);
    assert.ok(held, `${k}: ${file} ships English only and NO held migration carries the other four locales - the translations are lost, `
      + 'not deferred. Write them in a file marked "HELD: DO NOT APPLY" so the debt is in the repo.');
    assert.deepEqual(held.locales, ['ar', 'en', 'ko', 'ru', 'zh'], `${k}: the held file ${held.file} does not cover all five locales`);
    /* The held rows are checked for placeholder drift too, not only for coverage. A deferred translation that has lost its {value} is
       still broken - it just breaks later, on the day someone applies it, with the number missing from the sentence and no test having
       ever looked. Found by mutating a placeholder out of the held file and watching this test pass. */
    for (const r of held.rows) assert.equal(placeholders(r.value), placeholders(defaults[k]),
      `${k} ${r.locale}: placeholders changed in the HELD file ${held.file} ("${r.value}") - it would ship broken whenever it is applied`);
  }
  /* The wording the owner chose for #1673 item 1: plain "15-minute", not the trader shorthand "15m" or the bare period "(14, 15m)".
     ALERTS_RSI_DESC was left as it was, so it still has to read "1h RSI". These are the strings, not a shape: the point of item 1 is that
     a first-time reader can tell what the number is of, so a later tidy back to "RSI 15m" has to be a decision. */
  assert.equal(defaults.MARKET_CONDITIONS_WIDGET_RSI_LABEL, 'BTC RSI (15-minute chart)');
  assert.match(defaults.SETUP_SCANNER_RSI_VAL, /^15-minute RSI /);
  assert.match(defaults.BRIEFING_TAG_RSI, /^15-minute RSI /);
  assert.match(defaults.ALERTS_RSI_DESC, /^1h RSI /);
});
