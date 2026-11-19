import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* #2627 A MISSING PRICE OR BUY-PRESSURE CELL ON /markets IS BLANK, NOT "No data" (owner, 2026-11-19: no failing data). Rule from the PR text: while the first read of the universe is coming the cell shows the ellipsis; once it is not coming a row with no price (or no takerBuyRatio) shows an
 * EMPTY cell; a row that has the value still shows it ("$" + price; "NN% buy" through MARKETS_BUY_PCT_SUFFIX). Prod, measured: bonk, pepe and xau carry no takerBuyRatio in /api/market/snapshot klines.
 * The two cell expressions are sliced out of components/MarketsTerminal.tsx and RUN with a table of inputs, so a change of wording or a revert to t('ARENA_SCANNER_UNAVAILABLE_NARROW') fails here.
 *   B1 price cell   B2 buy-pressure cell   B3 the source no longer prints the "No data" key in either cell   B4 a failed feed is still said once, on the page (pricesFailed banner), not by blank cells alone */
const src = readFileSync(new URL('../components/MarketsTerminal.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const lines = src.split('\n');
const exprOf = (needle: string): string => {
  const hits = lines.filter((l) => l.includes(needle) && l.trim().startsWith('{')); assert.equal(hits.length, 1, `CONTROL: expected exactly one cell line containing ${needle}, found ${hits.length}`);
  const l = hits[0].trim(); return l.slice(1, l.lastIndexOf('}'));
};
const priceExpr = exprOf("d?.price ? '$' + fmtPrice(d.price, dec)"), buyExpr = exprOf('tbp == null ?');
const price = new Function('d', 'dec', 'store', 'fmtPrice', 't', `return ${priceExpr};`) as (d: unknown, dec: number, store: unknown, f: (p: number, dec: number) => string, t: (k: string, v?: Record<string, unknown>) => string) => string;
const buy = new Function('tbp', 'store', 't', `return ${buyExpr};`) as (tbp: number | null, store: unknown, t: (k: string, v?: Record<string, unknown>) => string) => string;
const t = (k: string, v?: Record<string, unknown>) => (k === 'MARKETS_BUY_PCT_SUFFIX' ? `${v?.pct}% buy` : k === 'ARENA_SCANNER_UNAVAILABLE_NARROW' ? 'No data' : `<<${k}>>`);
const fmt = (p: number, dec: number) => p.toFixed(dec);
const store = (universe: string) => ({ scannerFeed: { universe, binanceOnly: universe } });

test('B1. price cell: a price shows; no price is an ellipsis while pending and EMPTY once loaded, never "No data"', () => {
  assert.equal(price({ price: 64000 }, 2, store('ok'), fmt, t), '$64000.00'); assert.equal(price({ price: 64000 }, 2, store('pending'), fmt, t), '$64000.00', 'a price wins over a pending feed');
  assert.equal(price({}, 2, store('pending'), fmt, t), '…'); assert.equal(price(undefined, 2, store('pending'), fmt, t), '…');
  for (const d of [{}, undefined, { price: 0 }, { price: null }]) { const out = price(d, 2, store('ok'), fmt, t); assert.equal(out.trim(), '', `loaded, no price (${JSON.stringify(d)}) must be empty, got "${out}"`); assert.ok(!/No data|<<|—|-$/.test(out), out); }
});
test('B2. buy-pressure cell: "NN% buy" with a ratio; ellipsis while pending; EMPTY once loaded (bonk, pepe, xau); 0 is a real ratio', () => {
  assert.equal(buy(61, store('ok'), t), '61% buy'); assert.equal(buy(0, store('ok'), t), '0% buy', 'a ratio of 0 is a value, not a missing one'); assert.equal(buy(100, store('pending'), t), '100% buy');
  assert.equal(buy(null, store('pending'), t), '…');
  const out = buy(null, store('ok'), t); assert.equal(out.trim(), '', `loaded, no ratio must be empty, got "${out}"`); assert.ok(!/No data/.test(out));
  assert.equal(buy(null, store('failed'), t).trim(), '', 'a failed universe read also shows no "No data" (the page says it once, B4)');
});
test('B3. neither cell expression names the "No data" key any more (the key stays registered for the scanner)', () => {
  assert.ok(!priceExpr.includes('ARENA_SCANNER_UNAVAILABLE_NARROW') && !buyExpr.includes('ARENA_SCANNER_UNAVAILABLE_NARROW'), 'a cell still prints the scanner\'s "No data" key');
  assert.ok(!/ARENA_SCANNER_UNAVAILABLE_NARROW/.test(src.split('\n').filter((l) => /tbp == null|d\?\.price \?/.test(l)).join('\n')));
});
test('B4. a failed price feed is still said ONCE on the page, so a blank column is never the only sign: the pricesFailed state is read by the terminal', () => {
  assert.ok(/pricesFailed/.test(src), 'MarketsTerminal no longer reads pricesFailed: a dead feed would be a silent blank table');
});
