/* One RSI pane per user, always (#1559, fixed by #1560; owner decision 2026-10-08).
 *
 * THE BUG. The chart creates the RSI-14 pane on init. Selecting the RSI chip then ran the generic indicator sync, which added a SECOND
 * RSI pane (18 chart canvases with the chip on, 14 with it off). The fix keeps the chip a real choice (it still puts RSI in the
 * verdict) but the chart sync skips every id in DEFAULT_PANE_INDICATORS, and the RSI entry lost the Length setting that only
 * configured the second pane.
 *
 * WHAT THIS PINS. BEHAVIOUR (RP1-RP3) on lib/strategyRegistry.ts, which is pure; STRUCTURE (RP4) as a source anchor on the chart sync,
 * which is JSX-adjacent chart code with no DOM harness here. The rendered proof is QA's chart-instance read (RSI panes 1 -> 1 -> 1 on
 * qa 315de642). A source anchor shows the guard is still wired; it does not show the chart draws one pane.
 *
 * Mutations run when this was written (each must turn the named test red): remove 'RSI' from DEFAULT_PANE_INDICATORS -> RP1;
 * give RSI a paramSchema back -> RP2; drop the `!DEFAULT_PANE_INDICATORS.has(id)` guard in the chart -> RP4; make RSI unselectable
 * (drop it from the registry) -> RP3. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INDICATORS, DEFAULT_PANE_INDICATORS, findIndicator, slottedIds } from '../lib/strategyRegistry.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CHART = code(read('components/KLineProChart.tsx'));

test('RP1. RSI is a default pane, and every default pane is a real builtin indicator', () => {
  assert.equal(DEFAULT_PANE_INDICATORS.has('RSI'), true, 'RSI left DEFAULT_PANE_INDICATORS: the chip would draw a second pane again');
  assert.equal(DEFAULT_PANE_INDICATORS.size >= 1, true, 'CONTROL: the set is empty');
  for (const id of DEFAULT_PANE_INDICATORS) {
    const e = findIndicator(id);
    assert.ok(e, `${id} is a default pane but not in the registry`);
    assert.equal(e.source, 'builtin', `${id} is a default pane but its source is ${e.source}, not builtin`);
  }
});

test('RP2. a default-pane indicator has no settings, because its only pane is the always-on one at its fixed default', () => {
  for (const id of DEFAULT_PANE_INDICATORS) {
    const e = findIndicator(id);
    assert.ok(e);
    assert.equal(e.paramSchema.length, 0, `${id} has settings again (${e.paramSchema.map((p) => p.key).join(',')}): they would configure a pane that is never created`);
  }
  assert.equal(INDICATORS.filter((i) => i.source === 'builtin' && !DEFAULT_PANE_INDICATORS.has(i.id)).every((i) => i.paramSchema.length > 0), true, 'CONTROL: expected the other builtins (SMA, PSAR, MACD, Bollinger) to keep settings');
});

test('RP3. the RSI chip stays a real, counted choice: it takes a plan slot, because it still changes the verdict', () => {
  assert.deepEqual(slottedIds(['RSI']), ['RSI']);
  assert.equal(findIndicator('RSI')?.id, 'RSI');
});

test('RP4. the chart indicator sync skips default-pane ids, so selecting the chip creates no pane', () => {
  const guard = "entry.source === 'builtin' && !DEFAULT_PANE_INDICATORS.has(id)";
  const n = CHART.split(guard).length - 1;
  assert.equal(n, 1, `the sync guard occurs ${n} time(s), expected exactly 1 - re-read components/KLineProChart.tsx`);
  assert.match(CHART, /import \{[^}]*\bDEFAULT_PANE_INDICATORS\b[^}]*\} from '@\/lib\/strategyRegistry'/, 'the chart no longer imports DEFAULT_PANE_INDICATORS');
});
