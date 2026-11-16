/* #2454: wrong-number fixes in /correlation and the economic calendar, on the REAL libs (lib/correlationMath.ts, lib/econActual.ts).
 *   P1-P6   pearson: right-aligned (the most recent overlap), exact on known series, null for a non-finite term / a flat series / fewer than 20 returns; the result is clamped to [-1, 1]
 *   R1-R2   pctReturns: a bad or zero close makes the series unusable (empty), never NaN; closedCloses drops the still-forming newest bar
 *   A1-A2   btcAltAverage needs at least half of the alts; weakestPairs ranks by DISTANCE FROM ZERO (a -0.8 pair is not "least correlated")
 *   F1-F6   fredActual: a row is accepted ONLY for the release's own reference period (month before, quarter before for GDP): on release day before FRED has the month there is NO actual, never the previous month's; formats; unknown type
 *   F7      the FRED series ids (real GDP growth, PCEPI, PPIFIS), and scheduledImpact (FOMC/CPI/NFP high, the rest med)
 *   W1      the call sites: the route uses fredActual and scheduledImpact, the page keys its border by econImpactKey (the raw feed value is lowercase and never matched 'HIGH'), the component uses the maths
 * WHAT IT CANNOT PROVE: that the named FRED series exist and have these units (the PR says it checked them; a live read is not a unit test). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closedCloses, pctReturns, pearson, btcAltAverage, weakestPairs, MIN_RETURNS } from '../lib/correlationMath.ts';
import { fredActual, referencePeriodStart, scheduledImpact, FRED_CFG } from '../lib/econActual.ts';

const seq = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));
const A = seq(30, (i) => Math.sin(i / 3)), NEG = A.map((v) => -v);

test('P1. pearson is exact on known series: identical = 1, opposite = -1, scaled and shifted = 1', () => {
  assert.equal(pearson(A, A), 1); assert.ok(Math.abs((pearson(A, NEG) as number) + 1) < 1e-12);
  assert.ok(Math.abs((pearson(A, A.map((v) => 3 * v + 7)) as number) - 1) < 1e-12);
});
test('P2. THE DEFECT: the series are RIGHT-ALIGNED, so a shorter history is paired with the matching newest dates (oldest-aligned would pair different dates)', () => {
  const long = seq(60, (i) => Math.sin(i / 2)), short = long.slice(-30);                // the short series IS the newest 30 of the long one
  assert.ok(Math.abs((pearson(long, short) as number) - 1) < 1e-12, 'the newest overlap is not paired with itself: the series were aligned from the OLDEST bar');
  assert.ok(Math.abs((pearson(short, long) as number) - 1) < 1e-12, 'alignment depends on argument order');
  const oldestAligned = pearson(long.slice(0, 30), short) as number;
  assert.ok(oldestAligned < 0.95, 'CONTROL: aligning from the oldest bar must give a visibly different (wrong) answer, or this cell measures nothing');
});
test('P3. a non-finite term anywhere in the overlap gives null (it used to print NaN on the red "Alts Lockstep" panel)', () => {
  for (const bad of [Number.NaN, Infinity, -Infinity]) { const x = [...A]; x[10] = bad; assert.equal(pearson(x, A), null, String(bad)); assert.equal(pearson(A, x), null); }
});
test('P4. a flat series (no variance) is null, not NaN or 0', () => {
  assert.equal(pearson(seq(30, () => 0.01), A), null); assert.equal(pearson(A, seq(30, () => 0)), null);
});
test('P5. fewer than 20 returns is null (five used to print r to two decimals); exactly 20 is stated', () => {
  assert.equal(MIN_RETURNS, 20); assert.equal(pearson(A.slice(0, 19), A.slice(0, 19)), null); assert.equal(pearson(A.slice(0, 20), A.slice(0, 20)), 1);
  assert.equal(pearson(seq(100, (i) => Math.sin(i)), seq(19, (i) => Math.sin(i))), null, 'the shorter series decides');
});
test('P6. r is always within [-1, 1]', () => {
  for (let k = 1; k < 20; k++) { const r = pearson(seq(40, (i) => Math.sin(i * k)), seq(40, (i) => Math.cos(i / k))); assert.ok(r === null || (r >= -1 && r <= 1), `k=${k} r=${r}`); }
});

test('R1. pctReturns: simple returns; a NaN, Infinity or zero previous close makes the whole series unusable (empty)', () => {
  assert.deepEqual(pctReturns([100, 110, 99]), [0.1, -0.1]);
  for (const bad of [[100, Number.NaN, 90], [100, Infinity, 90], [0, 5, 6], [100, 90, 0, 5]]) assert.deepEqual(pctReturns(bad), [], JSON.stringify(bad));
});
test('R2. closedCloses drops the newest (forming) bar and nothing else', () => {
  assert.deepEqual(closedCloses([1, 2, 3, 4]), [1, 2, 3]); assert.deepEqual(closedCloses([5]), []); assert.deepEqual(closedCloses([]), []);
});

test('A1. btcAltAverage: needs at least half of the alts to have a usable value, ignores nulls and non-finite, else null', () => {
  assert.equal(btcAltAverage([0.5, 0.7, null, null], 4), 0.6);                       // exactly half: allowed
  assert.equal(btcAltAverage([0.5, null, null, null], 4), null, 'fewer than half of the alts still produced an alt-season signal');
  assert.equal(btcAltAverage([], 4), null); assert.equal(btcAltAverage([null, null], 2), null);
  assert.equal(btcAltAverage([0.4, Number.NaN, 0.6], 3), 0.5);
});
test('A2. THE DEFECT: weakestPairs ranks by distance from zero: a -0.8 pair is strong, 0.02 is the least correlated', () => {
  const pairs = [{ r: -0.8 }, { r: 0.02 }, { r: 0.5 }, { r: -0.05 }, { r: 0.9 }];
  assert.deepEqual(weakestPairs(pairs, 3).map((p) => p.r), [0.02, -0.05, 0.5]);
  assert.deepEqual(pairs.map((p) => p.r), [-0.8, 0.02, 0.5, -0.05, 0.9], 'the input array was reordered');
});

const D = (y: number, m: number, d = 1, h = 0) => Date.UTC(y, m - 1, d, h);
test('F1. THE DEFECT: on release day, before FRED holds the new month, there is NO actual (it used to show the PREVIOUS month\'s figure)', () => {
  const rows: [number, number][] = [[D(2026, 8), 300], [D(2026, 9), 301], [D(2026, 10), 302]];   // CPI reference months Aug, Sep, Oct; the Nov release is for OCT: present
  assert.equal(fredActual(rows, D(2026, 11, 13, 13), 'CPI'), '+0.3%');
  const oldRows = rows.slice(0, 2);                                                  // FRED has not published October yet
  assert.equal(fredActual(oldRows, D(2026, 11, 13, 13), 'CPI'), undefined, 'the previous month\'s change was shown as this release\'s actual');
});
test('F2. the reference period: monthly = the month BEFORE the release (January release -> December of last year); quarterly = the quarter before (Jan 2027 -> Q4 2026; Jul 2026 -> Q2 2026)', () => {
  assert.equal(referencePeriodStart('month', D(2026, 11, 13)), D(2026, 10, 1, 0)); assert.equal(referencePeriodStart('month', D(2027, 1, 14)), D(2026, 12, 1, 0));
  assert.equal(referencePeriodStart('quarter', D(2027, 1, 28)), D(2026, 10, 1, 0)); assert.equal(referencePeriodStart('quarter', D(2026, 7, 30)), D(2026, 4, 1, 0));
  assert.equal(referencePeriodStart('quarter', D(2026, 4, 29)), D(2026, 1, 1, 0)); assert.equal(referencePeriodStart('daily', D(2026, 11, 13)), null);
});
test('F3. formats: NFP is the payroll change in K with a sign, CPI/PPI/PCE/RETAIL month-on-month percent with a sign, GDP the quarter\'s annualised percent as published', () => {
  const m = (v: number[], first = 1) => v.map((x, i) => [D(2026, first + i), x] as [number, number]);
  assert.equal(fredActual(m([159000, 159150]), D(2026, 3, 6), 'NFP'), '+150K');          // Mar release -> Feb row; the row before is Jan
  assert.equal(fredActual(m([159000, 158900]), D(2026, 3, 6), 'NFP'), '-100K');
  assert.equal(fredActual(m([200, 199]), D(2026, 3, 12), 'PPI'), '-0.5%');
  assert.equal(fredActual([[D(2026, 4), 3.2]], D(2026, 7, 30), 'GDP'), '+3.2%'); assert.equal(fredActual([[D(2026, 4), -0.5]], D(2026, 7, 30), 'GDP'), '-0.5%');
});
test('F4. the previous row is needed for a change: the first row alone gives no actual; a zero previous value gives none (no divide by zero)', () => {
  assert.equal(fredActual([[D(2026, 2), 100]], D(2026, 3, 12), 'CPI'), undefined);
  assert.equal(fredActual([[D(2026, 1), 0], [D(2026, 2), 5]], D(2026, 3, 12), 'CPI'), undefined);
});
test('F5. FOMC (daily series) is the newest rate at or before the event time, and none after it', () => {
  const rows: [number, number][] = [[D(2026, 9, 17, 0), 4.5], [D(2026, 10, 29, 0), 4.25], [D(2026, 12, 10, 0), 4.0]];
  assert.equal(fredActual(rows, D(2026, 11, 5), 'FOMC'), '4.25%'); assert.equal(fredActual(rows, D(2026, 9, 1), 'FOMC'), undefined);
});
test('F6. an unknown event type or no rows gives no actual', () => {
  assert.equal(fredActual([[D(2026, 1), 1]], D(2026, 2, 12), 'XYZ'), undefined); assert.equal(fredActual([], D(2026, 2, 12), 'CPI'), undefined);
});
test('F7. the series: real GDP growth (A191RL1Q225SBEA), PCEPI, PPIFIS, not nominal GDP / nominal spending / all commodities; impact: FOMC, CPI, NFP high, the rest med', () => {
  assert.equal(FRED_CFG.GDP.id, 'A191RL1Q225SBEA'); assert.equal(FRED_CFG.PCE.id, 'PCEPI'); assert.equal(FRED_CFG.PPI.id, 'PPIFIS');
  assert.deepEqual(Object.keys(FRED_CFG).sort(), ['CPI', 'FOMC', 'GDP', 'NFP', 'PCE', 'PPI', 'RETAIL']);
  for (const t of ['FOMC', 'CPI', 'NFP']) assert.equal(scheduledImpact(t), 'high'); for (const t of ['PPI', 'PCE', 'GDP', 'RETAIL', 'XYZ']) assert.equal(scheduledImpact(t), 'med');
});

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
test('W1. the call sites use the libs: the route (fredActual, scheduledImpact), the page (impact keyed by econImpactKey, never the raw lowercase value), the correlation component (the maths)', () => {
  const route = read('app/api/econ-calendar/route.ts');
  assert.ok(route.includes('fredActual(data[cfg.id], new Date(e.isoDate).getTime(), e.type)') && route.includes('impact: scheduledImpact(r.type)'), 'the route is back to its own actual / impact logic');
  assert.ok(read('app/(main)/econ-calendar/page.tsx').includes('IMPACT_CFG[econImpactKey(next.impact)]'), 'the page keys the impact by the raw feed string again (the red border never rendered)');
  const c = read('components/CorrelationTerminal.tsx');
  assert.ok(c.includes('pctReturns(closedCloses(await fetchCloses(id, interval, limit)))') && c.includes('return pearson(ra, rb);') && c.includes('btcAltAverage(matrix[0].slice(1), COINS.length - 1)') && c.includes('weakestPairs(pairs, 3)'), 'the component computes correlation itself again');
});
