import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* Coverage for #2104 - a one-point cached history left the Fear & Greed sparkline blank.
 *
 * The defect: the cache accepted any non-empty array (`data.length`), but `Sparkline` needs more
 * than one point to draw anything. So a cached ONE-element history was a value the widget could
 * never render, and accepting it `return`ed before the fetch that would have replaced it - no
 * sparkline for the whole 6-hour TTL. A one-element response is exactly what the old `&?limit=30`
 * typo produced, so every browser that loaded the dashboard in that window cached an undrawable
 * history.
 *
 * WHY THIS IS A SOURCE TEST AND NOT A UNIT TEST. The acceptance check lives inside a React
 * effect in `components/MarketConditionsWidget.tsx` and is not exported, so `node --test` cannot
 * call it. Rather than re-implement the predicate here - a simulation I author twice cannot
 * disagree with me - these cells read the TWO numbers out of the file and require them to AGREE.
 * That is a cross-check between two independent places in the source, which is the invariant the
 * fix's own comment states: "The acceptance test now matches what the renderer actually requires,
 * rather than 'not empty'."
 */

const SRC = readFileSync('components/MarketConditionsWidget.tsx', 'utf8');

/** The `> N` threshold from a `<thing>.length > N` comparison, or null. */
function lengthThreshold(src: string, expr: string): number | null {
  const m = new RegExp(expr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*>\\s*(\\d+)').exec(src);
  return m ? Number(m[1]) : null;
}

test('S1. the cache accepts a history only when it has more than one point', () => {
  const cacheThreshold = lengthThreshold(SRC, 'data.length');
  assert.equal(cacheThreshold, 1,
    'the cache acceptance threshold is no longer `data.length > 1`. At `> 0` (or a bare '
    + '`data.length`) a one-point entry is accepted, the effect returns early, and the sparkline '
    + 'cannot draw for the whole TTL - which is the defect #2104 fixed');

  // The bare truthiness form is the pre-fix shape; it must be gone, not merely supplemented.
  assert.ok(!/HISTORY_CACHE_TTL\s*&&\s*data\.length\s*\)/.test(SRC),
    'the pre-fix `&& data.length)` acceptance is still present');
});

test('S2. the cache threshold and the renderer minimum are the SAME number', () => {
  /* This is the cell that actually protects the behaviour. Either number alone is arbitrary; what
     matters is that the cache never accepts a value the renderer cannot draw. Two independent
     reads of the file, required to agree. */
  const cacheThreshold    = lengthThreshold(SRC, 'data.length');
  const rendererThreshold = lengthThreshold(SRC, 'history.length');

  assert.notEqual(cacheThreshold, null, 'could not find the cache acceptance threshold in the source');
  assert.notEqual(rendererThreshold, null, 'could not find the renderer minimum in the source');
  assert.equal(cacheThreshold, rendererThreshold,
    `the cache accepts history.length > ${cacheThreshold} while the renderer draws only above `
    + `${rendererThreshold}. Any gap between these two is a cached value that can never render, `
    + 'and the early return means it is never refetched either');
});

test('S3. CONTROL: these cells reject the pre-fix source', () => {
  /* Quoted from #2104's own diff - the line as it was. If the guards above cannot tell this apart
     from the fixed version, they are not testing the fix. */
  const preFix = [
    'const HISTORY_CACHE_TTL = 6 * 60 * 60_000;',
    "if (Date.now() - ts < HISTORY_CACHE_TTL && data.length) { setPoints(data); return; }",
    '{history.length > 1 && (',
  ].join('\n');

  assert.equal(lengthThreshold(preFix, 'data.length'), null,
    'CONTROL FAILED: the pre-fix source has no `data.length > N` at all, so S1 must find nothing here');
  assert.ok(/HISTORY_CACHE_TTL\s*&&\s*data\.length\s*\)/.test(preFix),
    'CONTROL FAILED: S1 would not have recognised the pre-fix acceptance shape');

  /* And the gap S2 exists to catch is real in the pre-fix source: the renderer wanted > 1 while
     the cache wanted "not empty", which is the whole defect expressed as two disagreeing numbers. */
  assert.equal(lengthThreshold(preFix, 'history.length'), 1,
    'CONTROL FAILED: the pre-fix renderer minimum should still read 1');
});
