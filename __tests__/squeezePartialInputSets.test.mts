/* Every partial input set returns a confident-looking zero. This is the premise any readiness gate
 * on the landing hero's Setup row rests on - and it is deliberately a property of the FUNCTION
 * rather than of a gate.
 *
 * WHY THAT DISTINCTION IS THE POINT. The sibling cell that asserted a specific gate
 * (`sqReady` naming four fields and joining them with `&&`) had to be parked when that gate was
 * reverted: #2144's conjunction left the Setup row permanently blank on the landing page, because the
 * hero receives the universe ticker pass plus funding and never receives `longRatio`, `shortRatio` or
 * `takerBuyRatio` at all. A cell asserting an implementation inherits that implementation's fate.
 * This one does not: whatever readiness rule is designed next, it exists BECAUSE of the behaviour
 * below, so the behaviour is worth pinning on its own.
 *
 * The three gates tried so far and why each failed:
 *   #2119  `d != null`                         - d arrives with price, every signal arrives later
 *   #2142  one input, joined with `||`         - funding first published a partial sum as final
 *   #2144  all four, joined with `&&`          - three of the four never arrive on that page
 * All three are the same mistake in different places: a readiness claim that does not match the data
 * the page actually gets.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSqueezeScore } from '../lib/marketStore.ts';

/** Price only - what the universe ticker pass delivers before any signal arrives. */
const withFields = (f: Record<string, number> = {}) => ({ price: 100, ...f }) as never;

test('S1. every partial input set scores 0 and labels "Balanced" - the premise a readiness gate rests on', () => {
  const stages: ReadonlyArray<readonly [string, never]> = [
    ['price only, no signals',       withFields()],
    ['volRatio only (the trap)',     withFields({ volRatio: 3.2 })],
    ['funding only, between bands',  withFields({ fundingRate: 0.00005 })],
    ['funding + volRatio',           withFields({ fundingRate: 0.00005, volRatio: 3.2 })],
  ];

  for (const [name, coin] of stages) {
    const r = computeSqueezeScore(coin);
    assert.equal(r.score, 0, `${name}: expected 0, got ${r.score} - if a partial set now scores, re-derive whether a readiness gate is still needed at all`);
    assert.equal(r.label, 'Balanced', `${name}: expected the "Balanced" label beside that zero, got "${r.label}"`);
    assert.equal(r.dir, 'NEUTRAL', `${name}: a partial set must not produce a direction`);
  }

  /* THE VOLRATIO STAGE IS THE ONE WORTH NOT LOSING. It is a bonus multiplier the function applies
     only once a direction already scores above 10, so volRatio alone leaves the row at 0 - which
     means a gate reading "any squeeze-ish field is present" would look fixed and still be broken for
     coins whose volume ratio lands first. */
  assert.equal(computeSqueezeScore(withFields({ volRatio: 99 })).score, 0,
    'an extreme volume ratio with no direction signal must still score 0 - it amplifies, it does not create');

  /* CONTROL: a COMPLETE set must score. Without this every assertion above holds for a function that
     always returns zero, and the file would read as coverage while proving nothing. */
  const complete = computeSqueezeScore(withFields({ fundingRate: 0.10, longRatio: 0.52, shortRatio: 0.1, takerBuyRatio: 0.62 }));
  assert.notEqual(complete.score, 0, 'control: a complete input set must produce a non-zero score');

  /* And the trailing zero that IS real: every input present, none firing. The row must be free to
     show this one - it is measured, and suppressing it would swap a false number for a false absence. */
  assert.equal(computeSqueezeScore(withFields({ fundingRate: 0.00005, longRatio: 0.5, shortRatio: 0.5, takerBuyRatio: 0.5 })).score, 0,
    'a complete set with nothing firing is a REAL zero and must still compute as 0');
});
