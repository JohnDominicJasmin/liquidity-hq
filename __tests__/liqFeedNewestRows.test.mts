/* LiqFeed's 24 h history must read the NEWEST rows, and all of the window it claims (#2408 hotfix; re-pointed for #2767).
 *
 * THE FACTS THIS RESTS ON: (1) #2408: the history query used `.order('ts', ascending).limit(5000)`, which kept the OLDEST rows of the window. (2) QA on production, 2026-11-22: the app asked `limit=5000` and the API answered `content-range 0-999` with exactly 1000 rows on every page: the project API answers at most 1000 rows per request, so the "newest 5000" was really the newest 1000 rows of ALL coins (PEPE showed 3 of its 39 stored events, BONK 0 of 6, and the Liq chip was absent for coins whose events were older than the newest 1000 rows).
 * THE WRITTEN RULE (#2767): the history is read in newest-first PAGES of at most 1000 rows with `.range()`, a bounded number of them (the all-coins read up to 5 pages, the selected coin's own read up to 3, once per coin per mount), put back in time order; the selected coin is read by its stored names so a busy coin cannot push a quiet coin out; the in-memory history is trimmed by age with a safety ceiling, never by a count that drops a quiet coin's older events.
 *   N1  THE SOURCE: no `.limit(5000)` and no ascending order anywhere in LiqFeed; the page size is 1000 (the API's cap) with 5 / 3 pages; readStored orders newest first, pages with .range(page * SB_PAGE, ...), stops on a short page or an error, and reverses to time order; the in-memory history is capped by HISTORY_MAX (20,000), not `slice(-5000)`
 *   N2  THE REAL readStored RUN against a stand-in API that, like production, answers at most 1000 rows per request: 2,500 rows where busy coins fill the newest 1000: every row arrives, oldest first, in 3 requests; a 12,000-row day yields exactly the newest 5,000 in 5 requests; the selected coin's read brings ALL of a quiet coin's older rows in at most 3 requests
 *   N3  CONTROL: the OLD shape (one query, limit 5000) run against the same capped stand-in returns 1,000 rows and misses the quiet coin: the stand-in reproduces the production defect, so N2 going green means something
 *   N4  storedCoinNames: the coin id and the base of each venue's symbol (1000PEPEUSDT -> PEPE, 10000SATSUSDT -> SATS), upper case, de-duplicated, for every coin of the universe
 *   N5  THE MERGE is still the old merge: dedupe key, the per-token conversion of stored raw prices (liqPerTokenFactor), a coin read sets the one-venue note and the all-coins read leaves it alone, the coin read runs once per coin
 * WHAT THIS CANNOT PROVE: the component mounted (it cannot be mounted headless here). The live proof is on a build with it: PEPE's 39 stored events in the Arena and a Liq chip for BONK / sats / tag / toshi / turbo when they have events. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { venueSymbols, UNIVERSE_COINS } from '../lib/coins.ts';

const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (code: string) => string }).stripTypeScriptTypes;
const src = readFileSync(new URL('../components/LiqFeed.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
function cut(re: RegExp, what: string): string { const m = re.exec(code); assert.ok(m, `not found: ${what}`); let i = code.indexOf('{', m!.index + m![0].length - 1), d = 0; for (; i < code.length; i++) { if (code[i] === '{') d++; else if (code[i] === '}') { d--; if (d === 0) break; } } return code.slice(m!.index, i + 1); }
const num = (name: string): number => { const m = new RegExp(`const ${name}\\s*=\\s*([\\d_]+)`).exec(code); assert.ok(m, `${name} not found`); return Number(m![1].replace(/_/g, '')); };

type Row = { coin: string; side: string; usd: number; price: number; source: string; ts: number };
/* a stand-in of the project API: filters like PostgREST, answers AT MOST `cap` rows per request (production: 1000) and counts requests */
function fakeSb(table: Row[], cap: number) {
  const stats = { requests: 0 };
  const from = () => { const q = { _since: 0, _in: null as string[] | null, _asc: true };
    const chain = { select: () => chain, gte: (_c: string, v: number) => { q._since = v; return chain; }, order: (_c: string, o: { ascending: boolean }) => { q._asc = o.ascending; return chain; }, in: (_c: string, v: string[]) => { q._in = v; return chain; },
      range: async (a: number, b: number) => { stats.requests++; const rows = table.filter((r) => r.ts >= q._since && (!q._in || q._in.includes(r.coin))).sort((x, y) => (q._asc ? x.ts - y.ts : y.ts - x.ts)); return { data: rows.slice(a, Math.min(b, a + cap - 1) + 1), error: null }; },
      limit: async (n: number) => { stats.requests++; const rows = table.filter((r) => r.ts >= q._since && (!q._in || q._in.includes(r.coin))).sort((x, y) => (q._asc ? x.ts - y.ts : y.ts - x.ts)); return { data: rows.slice(0, Math.min(n, cap)), error: null }; } };
    return chain; };
  return { sb: { from } as unknown, stats };
}
const SB_PAGE = num('SB_PAGE'), SB_PAGES_ALL = num('SB_PAGES_ALL'), SB_PAGES_COIN = num('SB_PAGES_COIN');
const readStored = new Function('T', `const SB_PAGE = ${SB_PAGE}; ${stripTypeScriptTypes(cut(/async function readStored\(/, 'readStored'))}\nreturn readStored;`)({ liq_events: 'lhq_liq_events' }) as (sb: unknown, since: number, coins: string[] | null, maxPages: number) => Promise<Row[]>;
const mk = (n: number, coin: (i: number) => string, t0 = 1_000_000): Row[] => Array.from({ length: n }, (_, i) => ({ coin: coin(i), side: 'LONG', usd: 20_000, price: 1, source: 'BB', ts: t0 + i * 1000 }));   // ts ascending with the index

test('N1. the source: pages of the API cap, newest first, bounded, reversed to time order, trimmed by age', () => {
  assert.ok(!/\.limit\(\s*5000\s*\)/.test(code), 'a limit(5000) read is back (the API would answer 1000 rows)'); assert.ok(!/ascending:\s*true/.test(code), 'an ascending order is back on a LiqFeed query'); assert.ok(!/\.slice\(\s*-5000\s*\)/.test(code), 'the history is trimmed by a count of 5000 again');
  assert.deepEqual([SB_PAGE, SB_PAGES_ALL, SB_PAGES_COIN], [1000, 5, 3]); assert.ok(SB_PAGE <= 1000, 'a page larger than the API cap would be cut');
  const fn = cut(/async function readStored\(/, 'readStored'); assert.match(fn, /\.order\('ts',\s*\{\s*ascending:\s*false\s*\}\)/); assert.match(fn, /\.range\(\s*page \* SB_PAGE,\s*page \* SB_PAGE \+ SB_PAGE - 1\s*\)/); assert.match(fn, /if \(error \|\| !data\) break;/); assert.match(fn, /if \(data\.length < SB_PAGE\) break;/); assert.match(fn, /return rows\.reverse\(\);/); assert.ok(!/\.limit\(/.test(fn));
  assert.equal(num('HISTORY_MAX'), 20_000); assert.ok((code.match(/\.slice\(-HISTORY_MAX\)/g) ?? []).length >= 2, 'both history trims must use HISTORY_MAX'); assert.match(code, /readStored\(sb, since, null, SB_PAGES_ALL\)/); assert.match(code, /readStored\(sb, Date\.now\(\) - SB_WIN_MS, storedCoinNames\(cf\), SB_PAGES_COIN\)/);
});

test('N2. readStored against an API that answers at most 1000 rows per request', async () => {
  const day = mk(2500, (i) => (i >= 1500 ? (i % 2 ? 'BTC' : 'ETH') : i % 7 === 0 ? 'PEPE' : i % 5 === 0 ? 'BONK' : 'SOL'));   // the newest 1000 rows are BTC / ETH only
  const a = fakeSb(day, 1000); const all = await readStored(a.sb, 0, null, SB_PAGES_ALL); assert.equal(all.length, 2500, 'rows missing'); assert.ok(all.every((r, i) => i === 0 || all[i - 1].ts < r.ts), 'not oldest first'); assert.equal(a.stats.requests, 3, `${a.stats.requests} requests for 2,500 rows`);
  const big = fakeSb(mk(12_000, () => 'BTC'), 1000); const five = await readStored(big.sb, 0, null, SB_PAGES_ALL); assert.equal(five.length, 5000); assert.equal(big.stats.requests, 5); assert.equal(five[five.length - 1].ts, 1_000_000 + 11_999 * 1000, 'the newest row is missing'); assert.equal(five[0].ts, 1_000_000 + 7_000 * 1000, 'not the newest 5,000');
  const pepeOnly = day.filter((r) => r.coin === 'PEPE').length; const c = fakeSb(day, 1000); const coin = await readStored(c.sb, 0, ['PEPE'], SB_PAGES_COIN); assert.equal(coin.length, pepeOnly, 'a quiet coin lost rows to the busy ones'); assert.ok(coin.every((r) => r.coin === 'PEPE')); assert.ok(c.stats.requests <= 3);
  const bad = { from: () => { const ch: Record<string, unknown> = { select: () => ch, gte: () => ch, order: () => ch, in: () => ch, range: async () => ({ data: null, error: { message: 'x' } }) }; return ch; } }; assert.deepEqual(await readStored(bad, 0, null, 5), [], 'an error must give an empty read, not a throw');
});

test('N3. CONTROL: the old single limit(5000) read, on the same capped API, returns 1000 rows and misses the quiet coin', async () => {
  const day = mk(2500, (i) => (i >= 1500 ? (i % 2 ? 'BTC' : 'ETH') : i % 7 === 0 ? 'PEPE' : 'SOL')); const { sb } = fakeSb(day, 1000);
  const old = await ((sb as { from: () => { select: () => { gte: (c: string, v: number) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: Row[] }> } } } } }).from().select().gte('ts', 0).order('ts', { ascending: false }).limit(5000));
  assert.equal(old.data.length, 1000, 'the capped stand-in must answer 1000 rows'); assert.equal(old.data.filter((r) => r.coin === 'PEPE').length, 0, 'the quiet coin must be missing from the old read: that is the production defect');
});

test('N4. storedCoinNames: the coin id and the base of each venue symbol, for every coin', () => {
  const fn = new Function('venueSymbols', `${stripTypeScriptTypes(cut(/function coinFromSym\(/, 'coinFromSym'))}\n${stripTypeScriptTypes(cut(/function storedCoinNames\(/, 'storedCoinNames'))}\nreturn { storedCoinNames, coinFromSym };`)(venueSymbols) as { storedCoinNames: (c: string) => string[]; coinFromSym: (s: string) => string };
  assert.ok(fn.storedCoinNames('PEPE').includes('PEPE')); assert.ok(fn.storedCoinNames('SATS').includes('SATS')); assert.deepEqual(fn.storedCoinNames('BTC'), ['BTC']);
  const empties: string[] = []; let n = 0; for (const c of UNIVERSE_COINS as string[]) { const names = fn.storedCoinNames(c.toUpperCase()); const v = venueSymbols(c); n++; assert.ok(names.includes(c.toUpperCase()), `${c}: own id missing`); assert.equal(new Set(names).size, names.length); assert.ok(names.every((x) => x === x.toUpperCase() && x.length > 0)); for (const s of [v.bybit, v.binance]) if (s) { const base = fn.coinFromSym(s); if (base === '') { empties.push(`${c}:${s}`); continue; } assert.ok(names.includes(base), `${c}: ${s}`); } }
  console.log(`[N4] ${n} coins; venue symbols whose base is empty after the digit strip (coinFromSym): ${JSON.stringify(empties)}`);
  assert.ok(n >= 50, `CONTROL: only ${n} coins checked`);
});

test('N5. the merge keeps the dedupe key, the per-token conversion and the one-venue rule', () => {
  const m = cut(/const mergeStored = useCallback\(/, 'mergeStored'); assert.match(m, /r\.price \* liqPerTokenFactor\(r\.coin, r\.source\)/, 'stored raw prices are no longer converted per token'); assert.match(m, /`\$\{e\.ts\}_\$\{e\.coin\}_\$\{e\.price\}_\$\{e\.side\}_\$\{e\.source\}`/); assert.match(m, /if \(perCoin \|\| !coinVenuesRef\.current\)/, 'the all-coins read may overwrite the coin read\'s one-venue note'); assert.match(m, /if \(perCoin\) coinVenuesRef\.current = true;/);
  assert.match(code, /loadedCoinsRef\.current\.has\(cf\)\) return;/, 'the coin read is no longer once per coin'); assert.match(code, /loadedCoinsRef\.current\.delete\(cf\)/, 'a failed coin read cannot be retried');
});
