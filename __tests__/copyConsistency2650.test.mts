import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { oiTrend1h } from '../lib/oiTrend1h.ts';

/* #2650 (#1185, PM page-by-page review 2026-11-17). Written rules (PR body):
 *   H1 /scanner heatmap: prices below one cent print THREE SIGNIFICANT DIGITS (BONK 0.00000388, not 0.000002), like /markets; the bands above are unchanged
 *   H2 ONE HOUR FOR BOTH OI READINGS: when the 1h samples carry the OI change AND the price change, the dashboard card and the landing row take their word from oiTrend1h on those samples (price up + OI up = new buyers; price up + OI down = short covering; price down + OI up = new sellers; both down = long exits; a move inside the noise = no word); the store's own trend is only the fallback
 *   H3 the dashboard market read's Smart money cell shows its word only (no "+1/10")
 *   H4 /funding heading reads "Funding" (default), same as the top bar; the held migration stores the same en and, for ko/zh/ru/ar, the words THE NAV USES for that page (the PR's own claim)
 *   H5 the proxy label fixture the browser suite serves carries the new title */
const root = new URL('../', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), 'utf8').replace(/\r\n/g, '\n');
const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;

/* the heatmap's own formatter, taken from the source (it is not exported) */
const heat = read('components/CoinHeatmap.tsx');
const fm = /function fmtPrice\(p: number\): string \{\n([\s\S]*?)\n\}\n/.exec(heat); assert.ok(fm, 'CONTROL: fmtPrice not found in CoinHeatmap.tsx');
const fmtPrice = new Function('p', fm![1]) as (p: number) => string;

test('H1. prices below a cent print three significant digits; the bands above are unchanged', () => {
  const cases: [number, string][] = [[0.00000388, '0.00000388'], [0.0000042, '0.00000420'], [0.00000421, '0.00000421'], [0.0000001234, '0.000000123'], [0.00123, '0.00123'], [0.00999, '0.00999'], [0.0099, '0.00990'], [0.000504, '0.000504'],
    [0.0123, '0.0123'], [0.5, '0.5000'], [1.5, '1.50'], [2999.6, '3,000'], [1234.4, '1,234']];
  for (const [p, want] of cases) assert.equal(fmtPrice(p), want, `price ${p}`);
  for (const p of [0, -1, Number.NaN]) assert.equal(fmtPrice(p), p === 0 || p < 0 || Number.isNaN(p) ? '0' : '', `a non-positive price must not throw or print NaN: ${p}`);
  /* a sweep: every price from 1e-8 up to a cent keeps three significant digits */
  let n = 0; for (let e = -8; e <= -3; e++) for (const m of [1, 1.0004, 1.37, 2.5, 3.88, 4.21, 5.55, 7.07, 9.6, 9.994]) { const p = m * 10 ** e; if (p >= 0.01) continue; const got = fmtPrice(p); n++;
    assert.ok(Math.abs(Number(got) - Number(p.toPrecision(3))) <= Math.abs(Number(p.toPrecision(3))) * 1e-9 || Number(got) === Number(p.toPrecision(4)) || Number(got) === Number((p * 1.0005).toPrecision(3)), `${p} printed as ${got} (3 significant digits are ${p.toPrecision(3)})`);
    assert.ok(/^0\.0*[1-9]\d{2,}/.test(got), `${p} printed as ${got}: fewer than three significant digits`); }
  assert.ok(n > 40, `CONTROL: ${n} sweep points`);
});
test('H2. the 1h truth table, and both OI surfaces use it when the 1h samples answered', () => {
  const T: [number | null, number | null, string | null][] = [[1, 1, 'strong_up'], [1, -1, 'strong_down'], [-1, 1, 'weak_up'], [-1, -1, 'weak_down'], [0.29, 1, null], [1, 0.19, null], [null, 1, null], [1, null, null], [0.3, 0.2, 'strong_up'], [-0.3, -0.2, 'weak_down']];
  for (const [o, p, want] of T) assert.equal(oiTrend1h(o, p), want, `oi ${o} price ${p}`);
  const dash = read('components/DashboardTerminal.tsx'), land = read('components/LandingTerminal.tsx');
  assert.ok(/const oi1hAnswered = oi1h\.pct != null && oi1h\.pricePct != null;\n\s*const oiTrendKey = oi1hAnswered \? oiTrend1h\(oi1h\.pct, oi1h\.pricePct\) : d\?\.oiTrend \?\? null;/.test(dash), 'the dashboard OI card no longer takes its word from the 1h samples when they answered (store trend only as fallback)');
  assert.ok(/const oiRow = oi1hBoth \? \(oiTrendFrom1h \? oiTrendTxt\[oiTrendFrom1h\] : null\) : \(d\?\.oiTrend \? oiTrendTxt\[d\.oiTrend\] : null\);/.test(land) && /oiTrendFrom1h = oi1hBoth \? oiTrend1h\(oi1h\.pct, oi1h\.pricePct\) : null/.test(land), 'the landing OI trend row no longer follows the 1h samples');
  /* the words the four states map to (dashboard labels): direction in the word agrees with the table */
  assert.match(defaults.OI_TREND_STRONG_UP_TXT, /New buyers/); assert.match(defaults.OI_TREND_STRONG_DOWN_TXT, /New sellers/); assert.match(defaults.OI_TREND_WEAK_UP_TXT, /Short covering/); assert.match(defaults.OI_TREND_WEAK_DOWN_TXT, /Long exits/);
});
test('H3. the Smart money cell is a word only', () => {
  const src = read('lib/marketRead.ts').replace(/\/\*[\s\S]*?\*\//g, '');
  const m = /factors\.push\(\{ key: 'sm'[^}]*\}\);/.exec(src); assert.ok(m, 'CONTROL: the sm factor push was not found');
  assert.equal(/sub\s*:/.test(m![0]), false, 'the Smart money factor carries a sub text again (the "+1/10")'); assert.ok(/label: 'Smart money', value: sm\.label/.test(m![0]));
  assert.equal(/\$\{sm\.total/.test(src), false, 'a "+n/m" template for the smart money score is back');
});
test('H4. the /funding heading is "Funding"; the held migration agrees with it and with the nav words', () => {
  assert.equal(defaults.FUNDING_PAGE_TITLE, 'Funding'); assert.equal(defaults.TNAV_FLOW_LABEL, 'Funding', 'the top bar tab says Funding; the heading must say the same');
  const f = readdirSync(new URL('supabase/migrations/', root)).find((x) => /^20261123a_labels_funding_page_title\.sql$/.test(x)); assert.ok(f, 'CONTROL: the held migration is missing');
  const sql = read(`supabase/migrations/${f}`); assert.ok(/NOT YET APPLIED TO ANY DATABASE/.test(sql), 'the migration header must say it is held');
  const p = sql.indexOf('===================== PROD'), d = sql.indexOf('===================== DEV'); assert.ok(p >= 0 && d > p);
  const rows = (s: string) => Object.fromEntries([...s.matchAll(/\('FUNDING_PAGE_TITLE','([a-z]{2})','((?:[^']|'')*)'\)/g)].map((m) => [m[1], m[2].replace(/''/g, "'")])) as Record<string, string>;
  const prod = rows(sql.slice(p, d)), dev = rows(sql.slice(d)); assert.deepEqual(Object.keys(prod).sort(), ['ar', 'en', 'ko', 'ru', 'zh']); assert.deepEqual(prod, dev, 'PROD and DEV differ');
  assert.equal(prod.en, defaults.FUNDING_PAGE_TITLE, 'the stored en row must equal the shipped default');
  /* the nav's own stored words for the same page: the PR says the new heading uses them */
  const nav: Record<string, string> = {};
  for (const mf of readdirSync(new URL('supabase/migrations/', root)).filter((x) => /_labels_.*\.sql$/.test(x)).sort()) { const t = read(`supabase/migrations/${mf}`); const pp = t.indexOf('insert into lhq_labels'); const dd = t.indexOf('insert into lhq_dev_labels'); const block = pp >= 0 ? t.slice(pp, dd > pp ? dd : undefined) : ''; for (const m of block.matchAll(/^\('TNAV_FLOW_LABEL','([a-z]{2})','((?:[^']|'')*)'\)/gm)) nav[m[1]] = m[2].replace(/''/g, "'"); }
  console.log(`[H4] nav words stored: ${JSON.stringify(nav)} · new heading rows: ${JSON.stringify(prod)}`);
  for (const l of ['ko', 'zh', 'ru', 'ar']) assert.equal(prod[l], nav[l], `${l}: the heading would read "${prod[l]}" while the nav tab reads "${nav[l]}"`);
});
test('H5. the browser suite\'s label fixture carries the new title', () => {
  const fx = JSON.parse(read('qa/fixtures/proxy/labels.json')) as Record<string, unknown>; const flat = JSON.stringify(fx);
  assert.ok(/"FUNDING_PAGE_TITLE":\s*"Funding"/.test(flat), 'qa/fixtures/proxy/labels.json still carries the old FUNDING_PAGE_TITLE');
});
