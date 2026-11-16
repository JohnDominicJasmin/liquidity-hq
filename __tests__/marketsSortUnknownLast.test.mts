/* #2444: the markets table sorts the useful way first, and an unknown (no volume / no change read) sorts LAST in both directions (S5, S6); the header counts only coins that have a price read.
 *   S1-S2  the volume / change comparator runs as the REAL code (SLICED out of components/MarketsTerminal.tsx, type-stripped): unknowns (null, undefined, NaN) are last ascending AND descending, known values order correctly, two unknowns tie
 *   S3     the first click on a column: name, grade and signal start ascending in their own order, volume and change start with the largest; a second click flips
 *   S4     the header counts: liveCount = coins with a finite price; Neutral = live minus bull minus bear, never negative
 *   S5     FINDING (todo): the PR's test steps say Grade reversed keeps no-data last, but the grade comparator has no unknown handling: reversed, grade F / no-data sorts FIRST
 * The comparator is a slice of OUR OWN checked-in source, never input. WHAT IT CANNOT PROVE: the rendered table. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { computeCoinHealth } from '../lib/marketStore.ts';

/* Cast rather than a named import: stripTypeScriptTypes is experimental and this repo's @types/node does not declare it (TS2305), though it exists at runtime (same pattern as libStrippable.test.mts). */
const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (source: string) => string }).stripTypeScriptTypes;
const SRC = readFileSync(new URL('../components/MarketsTerminal.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const a = SRC.indexOf("if (sort === 'volume' || sort === 'change') {"); assert.ok(a > 0, 'CONTROL: the volume/change block was not found');
const block = SRC.slice(a, SRC.indexOf("if (sort === 'name')", a));
const compile = (): ((sort: string, da: unknown, db: unknown, asc: boolean) => number) => new Function(`return (${stripTypeScriptTypes(`function f(sort: string, da: any, db: any, sortAsc: boolean) {\n let cmp = 0;\n${block}\n return sortAsc ? cmp : -cmp;\n}`)});`)();
const cmp = compile();
type Row = { id: string; vol24?: number | null; change?: number | null };
const sorted = (rows: Row[], key: 'volume' | 'change', asc: boolean) => [...rows].sort((x, y) => cmp(key, x, y, asc)).map((r) => r.id);
const ROWS: Row[] = [
  { id: 'A', vol24: 5, change: -2 }, { id: 'U1', vol24: null, change: null }, { id: 'B', vol24: 9, change: 3 }, { id: 'U2' }, { id: 'N', vol24: Number.NaN, change: Number.NaN }, { id: 'C', vol24: 7, change: 1 },
];

test('S1. unknown sorts LAST in both directions, for volume and for change (null, undefined and NaN are all unknown)', () => {
  for (const key of ['volume', 'change'] as const) for (const asc of [true, false]) {
    const order = sorted(ROWS, key, asc); const known = order.filter((id) => !id.startsWith('U') && id !== 'N');
    assert.deepEqual(order.slice(0, 3), known, `${key} ${asc ? 'asc' : 'desc'}: an unknown coin sorted among the known ones: ${order.join(',')}`);
    assert.deepEqual(new Set(order.slice(3)), new Set(['U1', 'U2', 'N']), `${key} ${asc ? 'asc' : 'desc'}: the unknowns are not the last three`);
  }
});
test('S2. the known values order correctly (volume asc 5,7,9 / desc 9,7,5; change asc -2,1,3), and two unknowns tie', () => {
  assert.deepEqual(sorted(ROWS, 'volume', true).slice(0, 3), ['A', 'C', 'B']); assert.deepEqual(sorted(ROWS, 'volume', false).slice(0, 3), ['B', 'C', 'A']);
  assert.deepEqual(sorted(ROWS, 'change', true).slice(0, 3), ['A', 'C', 'B']); assert.deepEqual(sorted(ROWS, 'change', false).slice(0, 3), ['B', 'C', 'A']);
  assert.equal(cmp('volume', { vol24: null }, { vol24: undefined }, false), 0);
});
test('S3. the first click on a new column: name, grade and signal start ascending; volume and change with the largest; a second click flips', () => {
  assert.ok(SRC.includes("else { setSort(key); setSortAsc(key === 'name' || key === 'grade' || key === 'signal'); }"), 'the first-click direction changed');
  assert.ok(SRC.includes('if (sort === key) setSortAsc(v => !v);'), 'a second click no longer flips');
  assert.ok(SRC.includes("const GRADE_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, F: 4, '-': 5 };"), 'the grade order changed: ascending would not be best-first');
  assert.ok(SRC.includes("const [sort, setSort]     = useState<SortKey>('volume');") && SRC.includes('const [sortAsc, setSortAsc] = useState(false);'), 'the initial sort is not volume descending');
});
test('S4. the header counts only coins that have a price read, and Neutral is never negative', () => {
  assert.ok(SRC.includes('const liveCount = COINS.filter(id => Number.isFinite(store.coins[id]?.price)).length;'), 'liveCount changed');
  assert.ok(SRC.includes("t('MARKETS_COINS_LIVE_SUFFIX', { count: liveCount })"), 'the header counts every listed coin again');
  assert.ok(SRC.includes("t('MARKETS_NEUTRAL_COUNT', { count: Math.max(0, liveCount - bullCount - bearCount) })"), 'Neutral counts coins with no data again, or can go negative');
});
const gradeBlock = SRC.slice(SRC.indexOf("if (sort === 'grade') {"), SRC.indexOf("if (sort === 'signal') {"));
const GRADE_ORDER = { A: 0, B: 1, C: 2, D: 3, F: 4, '-': 5 } as Record<string, number>;
const gradeCmp = new Function('computeCoinHealth', 'GRADE_ORDER', `return (${stripTypeScriptTypes(`function f(da: any, db: any, sortAsc: boolean) {
 let cmp = 0;
 const sort = 'grade';
${gradeBlock}
 return sortAsc ? cmp : -cmp;
}`)});`)(computeCoinHealth, GRADE_ORDER) as (da: unknown, db: unknown, asc: boolean) => number;
test('S5. the Grade column keeps coins with NO PRICE last in both directions (real grade branch sliced from the component, real computeCoinHealth), and priced coins order best-first / worst-first', () => {
  const C = { price: 1, rsi14: 75, oiTrend: 'strong_up', cvdDivergence: true }, D = { price: 1, rsi14: 75, oiTrend: 'weak_up' }, F = { price: 1 };
  assert.deepEqual([C, D, F].map((c) => computeCoinHealth(c as never).grade), ['C', 'D', 'F'], 'CONTROL: the fixtures no longer grade C, D, F, so the order below measures nothing');
  const rows: [string, unknown][] = [['U1', undefined], ['F', F], ['U2', {}], ['C', C], ['D', D]];
  for (const asc of [true, false]) {
    const order = [...rows].sort((x, y) => gradeCmp(x[1], y[1], asc)).map((r) => r[0]);
    assert.deepEqual(order.slice(3).sort(), ['U1', 'U2'], `grade ${asc ? 'ascending' : 'descending'}: a no-data coin is not last: ${order.join(',')}`);
    assert.deepEqual(order.slice(0, 3), asc ? ['C', 'D', 'F'] : ['F', 'D', 'C'], `grade ${asc ? 'ascending' : 'descending'}: the priced coins are mis-ordered: ${order.join(',')}`);
  }
  assert.equal(gradeCmp(undefined, {}, true), 0, 'two no-data coins must tie');
});
