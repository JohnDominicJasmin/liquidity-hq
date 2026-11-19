import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

/* #2680 (#1185 audit A1-A25 + C20/C21, owner's feature-freeze order of 2026-11-19): WHERE DATA IS MISSING THE PAGE SHOWS NOTHING, NOT A FAILURE SENTENCE, AND TRIES AGAIN BY ITSELF. Written rule (PR body):
 *   F  no component renders the retired failure/placeholder sentences (feed failed, drawdown error/empty, liquidation clusters building / no OI / delta warming up / unavailable, feed connect failed, accuracy load error)
 *   D  Drawdown card: skeleton while the ATH read or the prices are still coming; left out (null) when the read failed with no copy or prices settled and no row; the last good ATH map is kept in the browser (ATH + date only, never the stored drawdown) and storage failures are harmless; retries 4 s / 12 s / 30 s / 60 s
 *   M  Markets table is left out only when the socket is ready, no coin has a price and the price read has failed
 *   T  Landing ticker: after the read a tile with no figure is left out, on mobile a tile with no change is left out; while pending nothing is dropped
 *   C  Correlation: the alt-season card only with a reading or while loading; every-coin failure retries by itself every 30 s without blanking the page
 *   R  Funding history retries 5 s / 15 s / 45 s / 120 s while no coin has history
 * The REAL expressions and the real cache functions are cut out of the components. NOT covered (browser cells): layout when a card is left out, the empty-height placeholders. */
const rd = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\}/g, '{}');
const must = (s: string, re: RegExp, what: string) => { const m = re.exec(s); assert.ok(m, `CONTROL: ${what} not found`); return m![1]; };
const ev = (expr: string, v: Record<string, unknown>) => new Function(...Object.keys(v), `return (${expr});`)(...Object.values(v));
const bools = [false, true];

test('F. no component renders a retired failure sentence', () => {
  const keys = ['MARKET_FEED_FAILED', 'DRAWDOWN_CHART_ERROR', 'DRAWDOWN_CHART_EMPTY', 'LIQ_CLUSTERS_BUILDING', 'LIQ_NO_OI_DATA', 'LIQ_DELTA_WARMING_UP', 'LIQ_DELTA_UNAVAILABLE', 'LIQ_FEED_CONNECT_FAILED', 'WHALE_TRADES_FEED_CONNECT_FAILED', 'SIGNAL_ACCURACY_LOAD_ERROR'];
  const files: string[] = []; for (const d of ['components', 'app/(main)']) { const walk = (dir: string) => { for (const e of readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) { if (e.isDirectory()) walk(`${dir}/${e.name}`); else if (/\.tsx$/.test(e.name)) files.push(`${dir}/${e.name}`); } }; walk(d); }
  assert.ok(files.length > 50, 'CONTROL: the component walk found too few files'); assert.ok(files.includes('components/DrawdownChart.tsx'));
  for (const f of files) { const code = strip(rd(f)); for (const k of keys) assert.equal(code.includes(k), false, `${f} still renders ${k}`); }
  const fund = strip(rd('components/FundingTerminal.tsx')); assert.equal(/STATE_UNAVAILABLE/.test(fund), false, 'the funding detail block says Unavailable again');
});
test('D1. Drawdown card: skeleton while waiting, null when there is truly nothing; never a sentence', () => {
  const code = strip(rd('components/DrawdownChart.tsx')); const pending = must(code, /const pricesPending = (.+?);\n/, 'pricesPending'); const skel = must(code, /const showSkeleton = (.+?);\n/, 'showSkeleton'); const gone = must(code, /if \((\(failed && !ath\) \|\| .+?)\) return null;/, 'return-null rule');
  const COINS = ['btc', 'eth'];
  for (const ath of [null, {}]) for (const failed of bools) for (const rows of [0, 3]) for (const pricesFailed of bools) for (const priced of bools) {
    const store = { pricesFailed, coins: { btc: { price: priced ? 100 : null }, eth: {} } }; const pp = ev(pending, { store, COINS }) as boolean; assert.equal(pp, !pricesFailed && !priced, 'pricesPending');
    const v = { ath, failed, rows: { length: rows }, pricesPending: pp }; const s = ev(skel, v) as boolean, g = ev(gone, v) as boolean;
    assert.equal(s, (!ath && !failed) || (ath != null && rows === 0 && pp), `skeleton ${JSON.stringify({ ath, failed, rows, pp })}`); assert.equal(g, (failed && !ath) || (ath != null && rows === 0 && !pp), `null ${JSON.stringify({ ath, failed, rows, pp })}`);
    assert.equal(s && g, false, 'a skeleton and a hidden card at once'); if (ath != null && rows > 0) { assert.equal(g, false, 'a card with rows is never hidden'); assert.equal(s, false); }
  }
});
test('D2. the ATH copy in the browser: only ATH + date are stored, a stored copy is read back, corrupt or blocked storage is harmless; the retry waits are 4/12/30/60 s', () => {
  const src = rd('components/DrawdownChart.tsx'); const key = must(src, /const ATH_CACHE_KEY = '([^']+)';/, 'cache key'); assert.equal(key, 'lhq.ath.cache.v1');
  const waits = must(src, /const ATH_RETRY_MS = (\[[^\]]+\]);/, 'retry waits'); assert.deepEqual(ev(waits.replace(/_/g, ''), {}), [4000, 12000, 30000, 60000]);
  const rf = must(src, /(function readAthCache\(\)[\s\S]*?\n\})\n/, 'readAthCache'); const wf = must(src, /(function writeAthCache\(data[\s\S]*?\n\})\n/, 'writeAthCache');
  const mk = (store: Record<string, string>, throws = false) => ({ getItem: (k: string) => { if (throws) throw new Error('blocked'); return store[k] ?? null; }, setItem: (k: string, v: string) => { if (throws) throw new Error('blocked'); store[k] = v; } });
  const load = (ls: unknown) => new Function('localStorage', 'ATH_CACHE_KEY', 'Date', `${rf.replace(/: Record<string, AthEntry> \| null/, '').replace(/ as \{ data\?: Record<string, AthEntry> \} \| null/, '')}\n${wf.replace(/\(data: Record<string, AthEntry>\)/, '(data)').replace(/const slim: Record<string, AthEntry> = \{\};/, 'const slim = {};')}\nreturn { readAthCache, writeAthCache };`)(ls, key, Date) as { readAthCache: () => Record<string, { ath: number; athDate?: string }> | null; writeAthCache: (d: Record<string, unknown>) => void };
  const store: Record<string, string> = {}; const api = load(mk(store)); assert.equal(api.readAthCache(), null, 'empty storage reads null');
  api.writeAthCache({ btc: { ath: 126000, athDate: '2025-10-06', drawdownPct: -12.5, price: 110000 }, bad: { athDate: 'x' } as never, eth: { ath: 4950, athDate: '2025-08-24' } });
  const saved = JSON.parse(store[key]) as { data: Record<string, Record<string, unknown>> }; assert.deepEqual(saved.data, { btc: { ath: 126000, athDate: '2025-10-06' }, eth: { ath: 4950, athDate: '2025-08-24' } }, 'only ATH + date are stored, and entries without a number are dropped (a stored drawdown would be wrong after a reload)');
  assert.deepEqual(api.readAthCache(), saved.data, 'a stored copy reads back'); store[key] = '{not json'; assert.equal(api.readAthCache(), null, 'corrupt storage reads null'); store[key] = JSON.stringify({ data: 5 }); assert.equal(api.readAthCache(), null); store[key] = JSON.stringify({ nodata: 1 }); assert.equal(api.readAthCache(), null);
  const blocked = load(mk({}, true)); assert.equal(blocked.readAthCache(), null); assert.doesNotThrow(() => blocked.writeAthCache({ btc: { ath: 1 } }), 'blocked storage must not break the card');
});
test('M. the Markets table is left out only for: socket ready, no price anywhere, price read failed', () => {
  const expr = must(strip(rd('components/MarketsTerminal.tsx')), /const feedDown = (.+?);\n/, 'feedDown');
  for (const wsReady of bools) for (const anyPrice of bools) for (const pricesFailed of bools) assert.equal(ev(expr, { wsReady, anyPrice, store: { pricesFailed } }), wsReady && !anyPrice && pricesFailed, JSON.stringify({ wsReady, anyPrice, pricesFailed }));
  assert.equal(ev(expr, { wsReady: true, anyPrice: true, store: { pricesFailed: true } }), false, 'one price keeps the table');
});
test('T. Landing ticker: after the read a figure-less tile (or on mobile a change-less one) is dropped; while pending nothing is', () => {
  const expr = must(strip(rd('components/LandingTicker.tsx')), /if \((feed !== 'pending' && \(bothGone \|\| \(mobile && chg == null\)\))\) return null;/, 'tile drop rule');
  for (const feed of ['pending', 'live', 'failed']) for (const bothGone of bools) for (const mobile of bools) for (const chg of [null, 1.2]) assert.equal(ev(expr, { feed, bothGone, mobile, chg }), feed !== 'pending' && (bothGone || (mobile && chg == null)), JSON.stringify({ feed, bothGone, mobile, chg }));
  for (const bothGone of bools) for (const mobile of bools) assert.equal(ev(expr, { feed: 'pending', bothGone, mobile, chg: null }), false, 'a tile was dropped while the read is still pending');
});
test('C. Correlation: alt-season card needs a reading or loading; every-coin failure retries by itself every 30 s and keeps the page', () => {
  const src = rd('components/CorrelationTerminal.tsx'); const code = strip(src); const card = must(code, /\{(\(avgCorr != null \|\| loading\)) && <TPanel/, 'alt-season gate');
  for (const avgCorr of [null, 0.4]) for (const loading of bools) assert.equal(ev(card, { avgCorr, loading }), avgCorr != null || loading);
  assert.equal(must(code, /const allFailed = (.+?);\n/, 'allFailed'), '!loading && Object.keys(rets).length === 0');
  assert.match(code, /if \(!allFailed\) return;\s*const id = setTimeout\(\(\) => \{ retryRef\.current = true; setRetryTick\(n => n \+ 1\); \}, 30_000\);\s*return \(\) => clearTimeout\(id\);\s*\}, \[allFailed, retryTick\]\);/, 'the 30 s retry changed'); assert.match(code, /if \(!retryRef\.current\) \{ setDone\(new Set\(\)\); setRets\(\{\}\); \}\s*retryRef\.current = false;/, 'a retry blanks the page again (loading flash)'); assert.match(code, /\}, \[interval, limit, retryTick\]\);/);
});
test('R. Funding history: retries 5/15/45/120 s while no coin has any; a retry never blanks a coin that had history', () => {
  const code = strip(rd('components/FundingTerminal.tsx')); const waits = must(code, /const FR_RETRY_MS = (\[[^\]]+\]);/, 'FR_RETRY_MS'); assert.deepEqual(ev(waits.replace(/_/g, ''), {}), [5000, 15000, 45000, 120000]);
  assert.match(code, /if \(cancelled \|\| got > 0 \|\| attempt >= FR_RETRY_MS\.length\) return;/, 'the retry stop rule changed'); assert.match(code, /setHistory\(prev => \(\{ \.\.\.prev, \.\.\.first \}\)\);/, 'a retry replaces earlier history instead of merging');
});
