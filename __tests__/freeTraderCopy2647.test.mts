/* FREE-TRADER AUDIT LEFTOVERS (#2647, #1185 "PM production audit 2026-11-17 (Free trader POV)"). Owner rule: describe what the data shows, never advise or forecast; the product is five languages; a Free trader sees which timeframes are Pro before clicking.
 *   F1  oi1hSignal: the four new words, one label key per state, the English the Arena AI reads equals the label the screen shows, nothing stale in 5 locales' landing dictionaries
 *   F2  Dashboard and coin snapshot show the LABEL (so ru/ko/zh/ar are not English), the Arena AI keeps the English
 *   F3  Market Read: the crowd line states positioning (4 cases, real function), the 4 strings are translatable, the weekday tile shows its score share out of 15 on every weekday
 *   F4  Arena EMA checklist hover text and the AI yen line: facts and the level, no "wait for", "confirmed", "eligible", "DANGER", "Safe"
 *   F5  /markets one-line A to F legend, same as /dashboard's
 *   F6  chart toolbar: lock on 1m/5m/15m only for a confirmed Free account, not while the plan loads, not for Pro or an unknown read; the badge sits over the corner
 *   F7  News: "presidential" alone is not a TRUMP/TARIFF tag; real Trump/tariff headlines keep it
 *   F8  Learn glossary: RSI, VWAP, Contrarian say how traders read them
 *   F9  /hours: browser title, page title, quiet segment; the nav label is untouched
 *   F10 held migration 20261122a: 17 keys x 5 locales, PROD = DEV, en = default, placeholders, script, newest row, disjoint from 20261122b
 * WHAT THIS CANNOT PROVE: where the lock badge and the legend sit at 390 / 768 / 1280 in both themes, that "Weekday effect" fits its tile, or that ko/zh/ru/ar read well (a browser and PM's visual pass). */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { computeContrarian, computeMarketRead } from '../lib/marketRead.ts';
import { trText } from '../lib/marketReadText.ts';
import { GEO_KEYWORDS, hasAnyKeyword } from '../lib/classify.ts';
import { GLOSSARY_FLAT } from '../lib/glossary.ts';
import { GATED_TFS, isGatedTf } from '../lib/limits.ts';
import * as dict from '../lib/i18n/dictionaries.ts';

const rd = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const RAW = rd('lib/labelDefaults.en.json'); const DEF = JSON.parse(RAW) as Record<string, string>; const KEYS = rd('lib/labelKeys.ts');
const MIG = '20261122a_labels_free_trader_copy.sql';
const rowRe = /\(\s*'((?:[^']|'')*)'\s*,\s*'(en|ko|zh|ru|ar)'\s*,\s*'((?:[^']|'')*)'\s*\)/g;
function migRows(file: string) {
  const sql = rd('supabase/migrations/' + file); const i = sql.search(/insert into lhq_dev_labels/i); assert.ok(i > 0, 'DEV block missing');
  assert.match(sql.slice(0, i), /insert into lhq_labels\b/i, 'PROD block must insert into lhq_labels');
  const rows = (s: string) => [...s.matchAll(rowRe)].map((m) => [m[1], m[2], m[3].replace(/''/g, "'")] as [string, string, string]);
  return { prod: rows(sql.slice(0, i)), dev: rows(sql.slice(i)) };
}
const nocomment = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const between = (s: string, a: string, b: string) => { const i = s.indexOf(a); const j = s.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, `anchor not found: ${a} .. ${b}`); return s.slice(i, j); };
const interp = (s: string, v: Record<string, string | number> = {}) => s.replace(/\{(\w+)\}/g, (w, n) => (n in v ? String(v[n]) : w));

/* ---- F1: oi1hSignal, run for real (its file cannot be imported: it imports a type as a value) ---- */
const ts = createRequire(import.meta.url)('typescript');
function loadOi1h() {
  const src = rd('lib/useOI1h.ts'); const body = src.slice(src.indexOf('const OI_TREND_TXT'));
  const js = ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} as Record<string, unknown> }; runInNewContext(js, { exports: m.exports });   /* the PR's own function text, no input from outside the repo */
  return m.exports.oi1hSignal as (pct: number | null, trend?: string | null) => { txt: string; col: string; key: string | null };
}
const OI_WORDS: Record<string, [string, string]> = {
  OI_1H_SIGNAL_NEW_LONGS: ['New longs opening \u25B2', 'newLongs'], OI_1H_SIGNAL_NEW_SHORTS: ['New shorts opening \u25BC', 'newShorts'], OI_1H_SIGNAL_SHORT_COVER: ['Short covering', 'shortCover'], OI_1H_SIGNAL_LONG_EXITS: ['Long exits', 'longExits'],
  OI_1H_SIGNAL_SPIKE_UP: ['OI spike - rising', 'spikeUp'], OI_1H_SIGNAL_SPIKE_DOWN: ['OI spike - unwinding', 'spikeDown'], OI_1H_SIGNAL_STABLE: ['Stable', 'stable'], OI_1H_SIGNAL_RISING: ['Rising', 'rising'], OI_1H_SIGNAL_UNWINDING: ['Unwinding', 'unwinding'],
};

test('F1a. oi1hSignal: each state returns the PR\'s word and its own label key, and the AI English equals the screen label', () => {
  const f = loadOi1h();
  const cases: Array<[number | null, string | null, string | null, string]> = [
    [null, null, null, '-'],
    [1.9, null, 'OI_1H_SIGNAL_STABLE', 'Stable'], [-1.9, null, 'OI_1H_SIGNAL_STABLE', 'Stable'], [2, null, 'OI_1H_SIGNAL_RISING', 'Rising'], [-2, null, 'OI_1H_SIGNAL_UNWINDING', 'Unwinding'],
    [10, null, 'OI_1H_SIGNAL_SPIKE_UP', 'OI spike - rising'], [-10, null, 'OI_1H_SIGNAL_SPIKE_DOWN', 'OI spike - unwinding'],
    [3, 'strong_up', 'OI_1H_SIGNAL_NEW_LONGS', 'New longs opening \u25B2'], [-3, 'strong_down', 'OI_1H_SIGNAL_NEW_SHORTS', 'New shorts opening \u25BC'],
    [3, 'weak_up', 'OI_1H_SIGNAL_SHORT_COVER', 'Short covering'], [-3, 'weak_down', 'OI_1H_SIGNAL_LONG_EXITS', 'Long exits'],
    [15, 'strong_up', 'OI_1H_SIGNAL_NEW_LONGS', 'New longs opening \u25B2'], [-15, 'weak_down', 'OI_1H_SIGNAL_LONG_EXITS', 'Long exits'],
    [1, 'strong_up', 'OI_1H_SIGNAL_NEW_LONGS', 'New longs opening \u25B2'],
  ];
  for (const [pct, trend, key, txt] of cases) { const r = f(pct, trend); assert.equal(r.key, key, `pct ${pct} trend ${trend}: key`); assert.equal(r.txt, txt, `pct ${pct} trend ${trend}: txt`); if (key) assert.equal(DEF[key], r.txt, `${key}: the screen label differs from what the Arena AI is told`); }
  assert.equal(f(5, 'unheard_of').key, 'OI_1H_SIGNAL_RISING', 'an unknown trend falls back to the plain Rising/Unwinding words');
});

const OLD_WORDS = ['New longs - real trend', 'New shorts - real dump', 'Short covering - weak pump', 'Long exits - no panic', '\uC2E0\uADDC \uB871 - \uC2E4\uC81C \uCD94\uC138', '\uC2E0\uADDC \uC20F - \uC2E4\uC81C \uD558\uB77D', '\uC20F \uCEE4\uBC84\uB9C1 - \uC57D\uD55C \uC0C1\uC2B9', '\uB871 \uCCAD\uC0B0 - \uD328\uB2C9 \uC544\uB2D8', '\u65B0\u589E\u591A\u5934 - \u771F\u5B9E\u8D8B\u52BF', '\u65B0\u589E\u7A7A\u5934 - \u771F\u5B9E\u4E0B\u8DCC', '\u7A7A\u5934\u56DE\u8865 - \u5F31\u52BF\u4E0A\u6DA8', '\u591A\u5934\u79BB\u573A - \u65E0\u6050\u614C', '\u0645\u0631\u0627\u0643\u0632 \u0634\u0631\u0627\u0621 \u062C\u062F\u064A\u062F\u0629 - \u0627\u062A\u062C\u0627\u0647 \u062D\u0642\u064A\u0642\u064A', '\u0645\u0631\u0627\u0643\u0632 \u0628\u064A\u0639 \u062C\u062F\u064A\u062F\u0629 - \u0647\u0628\u0648\u0637 \u062D\u0642\u064A\u0642\u064A', '\u062A\u063A\u0637\u064A\u0629 \u0645\u0631\u0627\u0643\u0632 \u0628\u064A\u0639 - \u0635\u0639\u0648\u062F \u0636\u0639\u064A\u0641', '\u062E\u0631\u0648\u062C \u0645\u0646 \u0627\u0644\u0634\u0631\u0627\u0621 - \u0628\u0644\u0627 \u0630\u0639\u0631', '\u041D\u043E\u0432\u044B\u0435 \u043B\u043E\u043D\u0433\u0438 - \u0440\u0435\u0430\u043B\u044C\u043D\u044B\u0439 \u0442\u0440\u0435\u043D\u0434', '\u041D\u043E\u0432\u044B\u0435 \u0448\u043E\u0440\u0442\u044B - \u0440\u0435\u0430\u043B\u044C\u043D\u043E\u0435 \u043F\u0430\u0434\u0435\u043D\u0438\u0435', '\u0417\u0430\u043A\u0440\u044B\u0442\u0438\u0435 \u0448\u043E\u0440\u0442\u043E\u0432 - \u0441\u043B\u0430\u0431\u044B\u0439 \u0440\u043E\u0441\u0442', '\u0412\u044B\u0445\u043E\u0434 \u0438\u0437 \u043B\u043E\u043D\u0433\u043E\u0432 - \u0431\u0435\u0437 \u043F\u0430\u043D\u0438\u043A\u0438'];
function oiLines() {
  const out: Array<{ loc: string; line: string }> = []; let loc = '';
  for (const l of rd('lib/i18n/dictionaries.ts').split(/\r?\n/)) { const m = /^export const (\w+): LandingDict/.exec(l); if (m) loc = m[1]; if (loc && /^\s*oi1h:\s*\{.*newLongs: '/.test(l)) out.push({ loc, line: l }); }
  return out;
}

test('F1b. no stale OI wording ("real trend", "real dump", "weak pump", "no panic") in the defaults or any of the five landing dictionaries', () => {
  const STALE = /real trend|real dump|weak pump|no panic/i;
  const bad: string[] = [];
  for (const [k, [w]] of Object.entries(OI_WORDS)) if (DEF[k] !== w || STALE.test(DEF[k])) bad.push(`${k}: "${DEF[k]}"`);
  for (const loc of ['en', 'ko', 'zh', 'ru', 'ar'] as const) { const oi = (dict as unknown as Record<string, { live?: unknown }>)[loc]; assert.ok(oi, `dictionary ${loc} missing`); }
  const lines = oiLines(); assert.deepEqual(lines.map((x) => x.loc).sort(), ['ar', 'en', 'ko', 'ru', 'zh'], 'expected one oi1h line in each of the 5 dictionaries');
  for (const x of lines) if (STALE.test(x.line)) bad.push(`dictionaries.ts ${x.loc}: ` + x.line.trim().slice(0, 110));
  /* the exact words the four states had before this PR, per locale (dev, before #2647): none may survive in a dictionary or in the migration */
  const OLD = OLD_WORDS; const all = oiLines().map((x) => x.line).join('\n') + '\n' + migRows(MIG).prod.map((r) => r[2]).join('\n');
  for (const w of OLD) if (all.includes(w)) bad.push(`old wording still present: ${w}`);
  assert.deepEqual(bad, [], bad.join(' | '));
});

test('F1c. the landing dictionaries say the same words as the dashboard labels (en = default, ko/zh/ru/ar = the migration rows)', () => {
  const lines = oiLines(); assert.equal(lines.length, 5);
  const { prod } = migRows(MIG); const bad: string[] = [];
  lines.forEach(({ loc, line }) => {
    for (const [key, [, dk]] of Object.entries(OI_WORDS)) {
      const m = new RegExp(`\\b${dk}:\\s*'([^']*)'`).exec(line); if (!m) { bad.push(`${loc}.oi1h.${dk} missing`); continue; }
      const want = loc === 'en' ? DEF[key] : prod.find((r) => r[0] === key && r[1] === loc)?.[2];
      if (m[1] !== want) bad.push(`${loc} ${dk}: dictionary "${m[1]}" vs label "${want}"`);
    }
  });
  assert.deepEqual(bad, [], bad.join(' | '));
});

test('F2. Dashboard and coin snapshot show the translated label; the Arena prompt keeps the English', () => {
  const dash = nocomment(rd('components/DashboardTerminal.tsx')); const snap = nocomment(rd('components/CoinMarketSnapshot.tsx')); const arena = rd('app/(main)/arena/page.tsx');
  assert.match(dash, /\{ key: oi1hKey, col: oi1hCol \} = oi1hSignal\(/); assert.match(dash, /oi1hKey == null \? null : t\(oi1hKey\)/, 'the dashboard card must show t(key)');
  assert.doesNotMatch(dash, /oi1hTxt/, 'the dashboard still reads the English txt'); assert.doesNotMatch(snap, /oi1hTxt/, 'the snapshot still reads the English txt');
  assert.match(snap, /txt: oi1hKey \? t\(oi1hKey\) : ''/, 'the snapshot must show t(key)');
  assert.match(arena, /const \{ txt \} = oi1hSignal\(oi1h\.pct, oiTrend1h/, 'the Arena prompt must keep reading the English txt');
});

/* ---- F3: Market Read ---- */
function fakeStore(over: { fng: number; fr: number; lr: number }) {
  return { selectedCoin: 'btc', fng: over.fng, coins: { btc: { price: 100, fundingRate: over.fr / 100, longRatio: over.lr / 100, oiTrend: null, orderBidWalls: null, orderAskWalls: null } }, cbPremiumPct: null, btcExchangeNetFlow: null } as never;
}
test('F3a. the crowd line states positioning: 4 cases through the real function, equal to the label default, no advice', () => {
  const cases: Array<[string, never, string]> = [
    ['all 3 long', fakeStore({ fng: 80, fr: 0.05, lr: 65 }), 'MARKET_READ_TXT_CROWD_ALL3_BEAR'], ['2 of 3 long', fakeStore({ fng: 80, fr: 0.05, lr: 50 }), 'MARKET_READ_TXT_CROWD_LEAN_LONG'],
    ['all 3 short', fakeStore({ fng: 20, fr: -0.03, lr: 35 }), 'MARKET_READ_TXT_CROWD_ALL3_BULL'], ['2 of 3 short', fakeStore({ fng: 20, fr: -0.03, lr: 50 }), 'MARKET_READ_TXT_CROWD_LEAN_SHORT'],
  ];
  const ADVICE = /tighten|avoid|wait|buy|sell|reversal|risk|potential|flush|squeeze|stops|chase|chasing|watch for|expect/i;
  for (const [name, store, key] of cases) {
    const c = computeContrarian(store); assert.ok(c, `${name}: no flag`);
    assert.equal(c!.desc, DEF[key], `${name}: the code string differs from ${key}`); assert.doesNotMatch(c!.desc, ADVICE, `${name}: advice wording: ${c!.desc}`);
    assert.equal(trText((k) => `TR:${k}`, c!.desc), `TR:${key}`, `${name}: the string is not mapped to ${key}, so ru/ko/zh/ar would read English`);
  }
  assert.match(DEF.MARKET_READ_TXT_CROWD_ALL3_BEAR, /^All 3 crowd signals show heavy long positioning\.$/); assert.match(DEF.MARKET_READ_TXT_CROWD_LEAN_SHORT, /^2 of 3 crowd signals show heavy short positioning\.$/);
});

test('F3b. the weekday tile is "Weekday effect" and shows its score share out of 15, on every weekday', () => {
  assert.equal(DEF.MARKET_READ_TXT_DAY, 'Weekday effect'); assert.equal(trText((k) => `TR:${k}`, 'Day'), 'TR:MARKET_READ_TXT_DAY', 'the tile label is no longer translated');
  const SHARE = [15, 14, 11, 10, 9, 4, 12];   /* Sunday..Saturday: the scoring table that was already in the code; this PR only displays it */
  for (let d = 0; d < 7; d++) {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 15 + d, 12, 0, 0) });   /* 2026-11-15 is a Sunday */
    try {
      const day = new Date().getUTCDay(); const r = computeMarketRead(fakeStore({ fng: 50, fr: 0, lr: 50 }));
      const f = r.factors.find((x) => x.key === 'day')!; assert.equal(f.sub, `${SHARE[day]}/15`, `weekday ${day}`); assert.equal(f.label, 'Day');
    } finally { mock.timers.reset(); }
  }
});

/* ---- F4 ---- */
test('F4a. Arena EMA checklist rows say what the data is, not what to wait for', () => {
  const src = rd('lib/useEMAStrategy.ts'); const rows = between(src, "label: 'Trend Signal (fast/slow cross)'", "label: 'Funding Rate'");
  assert.doesNotMatch(rows, /wait|waiting|confirmed|eligible|entry|pullback|candle close/i, 'advice wording is back in the EMA rows');
  for (const s of ['bullish cross`', 'no bullish cross yet`', 'bearish cross`', 'no bearish cross yet`', 'above EMA50 ${cur}${fmt(ema50)}`', 'below EMA50 ${cur}${fmt(ema50)}`', 'Price in EMA9\u2013EMA20 zone`', 'Price not in EMA9\u2013EMA20 zone`']) assert.ok(rows.includes(s), `missing the factual line ending: ${s}`);
});

test('F4b. the AI yen line states the level, three bands, nothing else but the level (DANGER / WARNING / Safe gone)', () => {
  const src = rd('app/(main)/arena/page.tsx'); const y = between(src, 'yenWatch: jpyUsd == null', 'The card\'s own sentence');
  assert.doesNotMatch(y, /DANGER|WARNING|Safe|risk|stable|intervention|liquidation/i, 'advice or risk wording in the yen line'); assert.ok(y.includes('jpyUsd >= 160') && y.includes('jpyUsd >= 158'), 'the 160 / 158 cuts moved');
  assert.match(y, /- at or above 160\./); assert.match(y, /- between 158 and 160`/); assert.match(y, /- below 158`/);
  assert.ok(y.indexOf('jpyUsd >= 160') < y.indexOf('jpyUsd >= 158'), 'the 160 test must come first or 160+ reads as 158 to 160');
});

/* ---- F5 ---- */
test('F5. /markets carries the same one-line A to F legend as /dashboard', () => {
  const mk = rd('components/MarketsTerminal.tsx'); const db = rd('components/DashboardTerminal.tsx'); const css = rd('app/globals.css');
  const grab = (s: string) => /\(\['A', 'B', 'C', 'D', 'F'\] as const\)\.map\(\(g, i\) => <span key=\{g\}>\{i > 0 \? ' · ' : ''\}<strong style=\{\{ color: 'var\(--txt2\)' \}\}>\{g\}<\/strong> \{t\(`COIN_HEALTH_GRADE_\$\{g\}` as const\)\}<\/span>\)/.exec(s);
  assert.ok(grab(mk), 'MarketsTerminal legend is not the dashboard\'s legend'); assert.ok(grab(db), 'control: the dashboard legend was not found');
  assert.match(mk, /className="csb2-grade-legend" data-testid="mkt-grade-legend"/); assert.match(css, /\.csb2-grade-legend\s*\{[^}]*font-size/, 'legend style missing');
  for (const g of ['A', 'B', 'C', 'D', 'F']) { const k = `COIN_HEALTH_GRADE_${g}`; assert.ok(DEF[k] && KEYS.includes(`'${k}'`), `${k} missing`); }
  assert.ok(mk.indexOf('mkt-grade-legend') < mk.indexOf('mkt-hdr-row'), 'the legend must sit above the table header');
});

/* ---- F6 ---- */
test('F6a. chart toolbar lock: only 1m/5m/15m, only a confirmed Free account, never while the plan loads', () => {
  assert.deepEqual([...GATED_TFS], ['1m', '5m', '15m']); for (const t of ['30m', '1h', '4h', '1d']) assert.equal(isGatedTf(t), false, `${t} must not be locked`);
  const src = rd('components/KLineProChart.tsx'); const blk = between(src, '{TFS.map(t => {', '<div className="klc-sep" />');
  assert.match(blk, /const locked = isGatedTf\(t\) && entitlementStatus === 'not_entitled' && !entitlementsLoading;/, 'the lock condition changed');
  assert.match(blk, /\{locked && \(\s*<span aria-hidden="true" style=\{\{ position: 'absolute'/, 'the badge must be an absolutely positioned decoration (no width change)');
  assert.match(blk, /'aria-label': `\$\{t\} \$\{tl\('DRAW_STRUCTURE_PRO_TAG'\)\}`, title: `\$\{t\} \$\{tl\('DRAW_STRUCTURE_PRO_TAG'\)\}`/, 'the accessible name and tooltip must say the timeframe and Pro');
  assert.match(blk, /onClick=\{\(\) => onTfChange\?\.\(t\)\}/, 'the click must still go through onTfChange (the upgrade gate)');
  assert.doesNotMatch(blk, /disabled/, 'a locked timeframe must stay clickable: the click opens the upgrade modal');
  assert.match(src, /import \{ isGatedTf \} from '@\/lib\/limits';/); assert.equal(DEF.DRAW_STRUCTURE_PRO_TAG, 'Pro');
});

test('F6b. the lock follows the same gate the click does (Arena handleTfChange blocks exactly GATED_TFS for a non-entitled plan)', () => {
  const arena = rd('app/(main)/arena/page.tsx'); assert.match(arena, /entitlementStatus !== 'entitled' && GATED_TFS\.includes\(tf\)/, 'the click gate moved: the lock could now promise something the click does not do');
});

/* ---- F7 ---- */
test('F7. News: "presidential" alone is not a TRUMP/TARIFF headline; real Trump and tariff headlines keep the tag', () => {
  const tag = (h: string) => GEO_KEYWORDS.find((g) => hasAnyKeyword(h, g.kw))?.tag ?? null;
  for (const h of ['JD Vance says he has not decided on a 2028 presidential run', 'Presidential hopeful tours Iowa ahead of 2028 primary', 'Presidential race heats up as fundraising totals land']) assert.notEqual(tag(h), 'TRUMP/TARIFF', `wrongly tagged: ${h}`);
  for (const h of ['Trump announces new tariffs on Chinese imports', 'White House signs executive order on crypto', 'US and EU close to a trade deal, officials say', 'Trump says trade war will not end soon', 'Presidential candidate promises tariffs on steel']) assert.equal(tag(h), 'TRUMP/TARIFF', `lost the tag: ${h}`);
  assert.ok(!GEO_KEYWORDS.some((g) => g.kw.includes('presidential')), 'presidential is still a keyword somewhere');
});

/* ---- F8 ---- */
test('F8. glossary: RSI, VWAP, Contrarian say how traders read them, not what will happen', () => {
  const g = (slug: string) => GLOSSARY_FLAT.find((e) => e.slug === slug)!.definition;
  const FORECAST = /more likely|becomes? more likely|bullish tell|is bearish|will (?:rise|fall|drop|reverse|bounce|dump|pump)|reversal down|a bounce/i;
  for (const s of ['rsi', 'vwap', 'contrarian-signal']) { assert.ok(GLOSSARY_FLAT.some((e) => e.slug === s), `${s} missing`); assert.doesNotMatch(g(s), FORECAST, `${s} forecasts: ${g(s)}`); }
  assert.match(g('rsi'), /Traders often read above roughly 70 as overbought/); assert.match(g('rsi'), /It measures how stretched a move is, not where price is headed next/);
  assert.match(g('vwap'), /Traders often read price above VWAP as buyers being in control/); assert.match(g('contrarian-signal'), /traders watch for the opposite move/);
});

/* ---- F9 ---- */
test('F9. /hours: browser title, page title, quiet segment; the nav label is untouched', () => {
  assert.match(rd('app/(main)/hours/layout.tsx'), /title: 'Crypto Trading Sessions',/); assert.doesNotMatch(rd('app/(main)/hours/layout.tsx'), /Best Hours to Trade/);
  assert.equal(DEF.HOURS_TITLE, 'Trading Sessions'); assert.equal(DEF.HOURS_HINT_TITLE, 'Trading Sessions'); assert.equal(DEF.HOURS_SEG_DEAD, 'Quiet');
  assert.equal(DEF.NAV_BEST_HOURS, 'Best Hours', 'the nav label must not change (PR)'); assert.equal(DEF.TNAV_HOURS_LABEL, 'Best Hours');
  const page = rd('app/(main)/hours/page.tsx'); assert.match(page, /labelKey: 'HOURS_SEG_DEAD'/); assert.match(page, /\{t\('HOURS_TITLE'\)\}/); assert.doesNotMatch(page, />\s*DEAD\s*</);
});

/* ---- F10 ---- */
const NEW9 = Object.keys(OI_WORDS);
const CHANGED = ['MARKET_READ_TXT_CROWD_ALL3_BEAR', 'MARKET_READ_TXT_CROWD_LEAN_LONG', 'MARKET_READ_TXT_CROWD_ALL3_BULL', 'MARKET_READ_TXT_CROWD_LEAN_SHORT', 'MARKET_READ_TXT_DAY', 'HOURS_TITLE', 'HOURS_HINT_TITLE', 'HOURS_SEG_DEAD'];
const ALL17 = [...NEW9, ...CHANGED];
const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const SCRIPT: Record<string, RegExp> = { ko: /[\uAC00-\uD7AF]/, zh: /[\u4E00-\u9FFF]/, ru: /[\u0400-\u04FF]/, ar: /[\u0600-\u06FF]/ };

test('F10a. keys: 9 new ones registered once with one default each; the 8 changed ones still registered', () => {
  const bad: string[] = [];
  for (const k of ALL17) { const reg = (KEYS.match(new RegExp(`'${k}'`, 'g')) || []).length; if (reg !== 1) bad.push(`${k}: registered ${reg}x`); const n = (RAW.match(new RegExp(`^\\s*"${k}":`, 'gm')) || []).length; if (n !== 1) bad.push(`${k}: ${n} defaults in the JSON`); }
  assert.deepEqual(bad, [], bad.join(' | '));
});

test('F10b. migration: 17 keys x 5 locales, PROD = DEV, en = default, placeholders and script right, no AI vendor', () => {
  const { prod, dev } = migRows(MIG); assert.equal(prod.length, 85, `PROD rows ${prod.length}`); assert.deepEqual(prod, dev, 'PROD and DEV blocks differ');
  const bad: string[] = []; const vendor = /\b(?:claude|anthropic|openai|chatgpt|gpt-?\d|gemini|grok|xai|deepseek)\b/i;
  for (const k of ALL17) { for (const l of ['en', 'ko', 'zh', 'ru', 'ar']) if (prod.filter((r) => r[0] === k && r[1] === l).length !== 1) bad.push(`${k}/${l} not exactly once`); }
  for (const [k, l, v] of prod) {
    if (l === 'en' && v !== DEF[k]) bad.push(`${k}: stored en "${v}" differs from default "${DEF[k]}"`);
    if (ph(v) !== ph(DEF[k])) bad.push(`${k}/${l}: placeholders differ`); if (l !== 'en' && !SCRIPT[l].test(v)) bad.push(`${k}/${l}: not in its script: ${v}`); if (vendor.test(v)) bad.push(`${k}/${l}: AI vendor named`); if (!v || v.trim() !== v) bad.push(`${k}/${l}: empty or padded`);
  }
  assert.deepEqual([...new Set(prod.map((r) => r[0]))].sort(), [...ALL17].sort(), 'keys outside the 17 are touched'); assert.deepEqual(bad, [], bad.join(' | '));
});

test('F10c. migration is the newest row of its 17 keys and shares no key with #2646\'s 20261122b', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url); const later: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql') && n > MIG && n !== '20261122b_labels_english_on_main_screens.sql')) { const sql = readFileSync(new URL(f, dir), 'utf8'); const d = sql.search(/insert into lhq_dev_labels/i); const prod = d > 0 ? sql.slice(0, d) : sql; for (const m of prod.matchAll(rowRe)) if (ALL17.includes(m[1])) later.push(`${m[1]}/${m[2]} in ${f}`); }
  assert.deepEqual(later, [], `a later migration overwrites these rows: ${later.join(', ')}`);
  const b = migRows('20261122b_labels_english_on_main_screens.sql').prod.map((r) => r[0]); const shared = [...new Set(b)].filter((k) => ALL17.includes(k)); assert.deepEqual(shared, [], `both PRs write ${shared.join(', ')}: the later file name wins`);
});

test('F10d. the OI words still read "New longs opening", not an advice or forecast phrase, in all five locales of the migration', () => {
  const { prod } = migRows(MIG); const text = prod.filter((r) => /^OI_1H_SIGNAL_(NEW|SHORT|LONG)/.test(r[0])).map((r) => r[2]).join(' | ');
  assert.doesNotMatch(text, /real|weak|panic/i); assert.equal(interp(DEF.OI_1H_SIGNAL_NEW_LONGS), 'New longs opening \u25B2');
});
