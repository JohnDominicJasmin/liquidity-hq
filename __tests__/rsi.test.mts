import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRSI14 } from '../lib/rsi.ts';

/* computeRSI14 was moved out of MarketProvider so app/api/market/rsi could
   share it. These lock the exact numbers the client produced before the move -
   the risk of the refactor is not a crash, it is the value shifting by a point
   and silently moving coins across the 30/70 badge thresholds.

   CHANGED WITH #1626 C (owner, 2026-10-21: "Standard RSI"; Dev, intentionally): computeRSI14 is now the standard Wilder RSI, unrounded. Three
   cases pinned the OLD simple windowed mean and were rewritten to the new rule: "alternating" (Wilder lands near 50, not on it), "history
   counts" (was "reads only the last 14 changes": Wilder remembers the whole series, which is what TradingView shows), and "unrounded" (was
   "rounded integer": rounding before a 30/70 comparison is what the owner ruled out). The 0/100/15-close/30/70 cases are unchanged: with
   exactly 15 closes Wilder's value IS its seed, the simple mean.

   CHANGED WITH #2015 (Dev's fix, QA's cells): a FLAT series now has no RSI and returns null rather than 100. Two cells moved - the flat case
   itself, and the close-count case whose fixtures were flat and so returned null for the wrong reason. A third was added asserting the pair,
   since each half alone is satisfied by a fix that breaks the other.

   WHAT THE MUTATION RUNS ACTUALLY SHOWED, including the part that did not go my way. Reverting the one changed expression in lib/rsi.ts turns
   the flat cell and the pair control RED (3 fail with the parent suite, 9 pass) and leaves the close-count cell green - correct, since that cell
   no longer depends on the flat rule. But breaking the close-count guard does NOT turn the close-count cell red either, so de-conflating its
   fixture did not make it a guard test; only its `notEqual` half discriminates, and the cell says so. An assertion that cannot fail is worth
   keeping as documentation and worth labelling as documentation.

   The flat 100 was never observed on live data - Dev measured 235 readings across 47 coins and 5 timeframes, plus ~1000 real 1m closes on five
   symbols, longest flat run 2-4 closes - so this is degenerate-input hardening justified by the direction of the failure rather than a sighting.
   The argument for taking it anyway is in the flat cell: the old cell's own comment named the consumer hazard, and `checkRSI` turned out to have
   it. */
test('computeRSI14', async (t) => {
  await t.test('needs 15 closes to produce 14 changes', () => {
    /* THE FIXTURES MUST NOT BE FLAT, AND THEY USED TO BE. Before #2015 this cell read
       `Array(14).fill(100)` and `Array(15).fill(100)`, which was fine while a flat series
       returned 100 - the only way to get null was to be short of closes. Now a flat series
       returns null on its own merits, so a flat fixture returns null for a reason that has
       nothing to do with the close count.

       So both fixtures alternate up and down: they carry a gain AND a loss, which means null
       cannot come from the flat rule.

       BE PRECISE ABOUT WHAT THAT BOUGHT, BECAUSE I FIRST CLAIMED MORE THAN IT DID. Mutation
       testing both halves against the real guard:

         `notEqual(moving(15), null)`  IS load-bearing. Requiring 16 closes instead of 15
                                      (`< period + 2`) turns it red with this message.
         `equal(moving(14), null)`     CANNOT be driven red by breaking the close-count guard,
                                      and the non-flat fixture does not change that. Deleting
                                      the guard entirely still returns null, because
                                      `wilderRsiSeries` assigns from `out[period]` upward and
                                      so never writes `out[13]` - the last element of any
                                      14-close series is NaN whatever the guard says.

       So the first line documents the contract and would catch a rewrite of the indexing; it
       is NOT a test of the length guard, and reading it as one would be the same mistake in a
       new place. The guard is tested by the line below it. */
    const moving = (n: number) => Array.from({ length: n }, (_, i) => 100 + (i % 2));
    assert.equal(computeRSI14([]), null);
    assert.equal(computeRSI14(moving(14)), null, '14 closes give 13 changes - one short, so there is no RSI yet');
    assert.notEqual(computeRSI14(moving(15)), null, '15 closes give exactly 14 changes, which is enough');
  });

  await t.test('a strictly rising series is 100', () => {
    // No losses at all, so avgLoss is 0 and the divide-by-zero branch applies.
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    assert.equal(computeRSI14(closes), 100);
  });

  await t.test('a flat series has NO rsi, and must not read 100 (#2015)', () => {
    /* THIS CELL USED TO ASSERT 100, AND ITS OWN COMMENT ARGUED AGAINST ITSELF: "Documenting
       rather than endorsing: a flat market reading as maximally overbought is a quirk of this
       formula, and anything consuming rsi === 100 as a sell signal inherits it."

       That caveat named the consumer hazard exactly, and then the hazard turned out to be
       real: `checkRSI` compares `rsi >= loosestOb` - the loosest overbought threshold across
       all current recipients - so a false 100 clears every threshold a user can set and fires
       an exhaustion alert on a coin that has not moved. The comment is now the rule instead of
       the warning.

       WHY 0/0 IS NOT 100: avgGain and avgLoss are both 0, and `l === 0` alone cannot tell
       "only up closes" (genuinely overbought) from "nothing moved at all" (undefined). The
       formula returns NaN for the second, which `wilderRsi` turns into null via its
       Number.isFinite guard, `formatRsi` renders as "-", and series consumers skip. */
    assert.equal(computeRSI14(Array(20).fill(100)), null);
  });

  await t.test('CONTROL: flat is null WHILE gains-with-no-losses is still 100', () => {
    /* THE PAIR IS THE CHANGE, AND EITHER HALF ALONE IS SATISFIED BY A WRONG FIX. Asserting
       only that flat is null would pass against a naive `l === 0 ? NaN`, which would also
       destroy genuine overbought - the reading this function exists to produce. Asserting only
       that a rising series is 100 is what the cell above already does and is what let the flat
       case read 100 for as long as it did.

       So the two live in one cell, next to each other, because the property is the DISTINCTION
       rather than either value. */
    assert.equal(computeRSI14(Array(20).fill(100)), null, 'nothing moved: no RSI');

    /* 19 flat closes then one up tick: 18 zero changes and a single gain, so avgLoss is 0 and
       avgGain is not - the `g === 0` guard must NOT catch this one. */
    const oneUpClose = [...Array(19).fill(100), 101];
    assert.equal(computeRSI14(oneUpClose), 100, 'gains with zero losses: genuinely overbought, still 100');
  });

  await t.test('a strictly falling series is 0', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i);
    assert.equal(computeRSI14(closes), 0);
  });

  await t.test('alternating equal gains and losses stays near 50 (Wilder: the last change tilts it slightly)', () => {
    const closes = [100];
    for (let i = 0; i < 20; i++) closes.push(closes[closes.length - 1] + (i % 2 ? -1 : 1));
    const v = computeRSI14(closes)!;
    assert.ok(Math.abs(v - 50) < 1, `expected about 50, got ${v}`);
  });

  await t.test('history counts (standard Wilder): a long crash followed by 14 small up-bars still reads oversold, not 100', () => {
    /* The old simple mean read only the last 14 changes and said 100 here. Wilder's average carries the crash forward, which is what
       TradingView and the exchanges show (measured: 15.4). */
    const crash = Array.from({ length: 40 }, (_, i) => 500 - i * 10);   // ends at 110
    const recovery = Array.from({ length: 14 }, (_, i) => 111 + i);
    const v = computeRSI14([...crash, ...recovery])!;
    assert.ok(v < 30, `expected the crash to still weigh (about 15.4), got ${v}`);
  });

  await t.test('returns the unrounded value (one decimal is for display only, never before a comparison)', () => {
    const closes = [100, 102, 101, 104, 103, 107, 105, 110, 108, 113,
                    111, 116, 114, 119, 117, 122];
    const rsi = computeRSI14(closes);
    assert.ok(rsi !== null);
    assert.equal(Number.isInteger(rsi!), false, 'the value was rounded');
    assert.ok(Math.abs(rsi! - 74.129) < 0.01, `expected about 74.13, got ${rsi}`);
  });

  /* TEST_GAPS.md §1: "RSI thresholds ... have fixtures but no spec asserts
     against them." The tests above pin 0/50/100 and the window mechanics but
     never land exactly on the 30/70 badge cutoffs themselves - these do,
     since the fixture (a fixed production snapshot) can't be relied on to
     contain a coin sitting on the exact boundary. */
  await t.test('the overbought boundary (70) is reached exactly, not approximately', () => {
    // avgGain:avgLoss = 7:3 over the 14-change window -> 100 - 100/(1+7/3) = 70.
    const closes = [100, 107, 104, ...Array(12).fill(104)];
    assert.equal(closes.length, 15);
    assert.equal(computeRSI14(closes), 70);
  });

  await t.test('the oversold boundary (30) is reached exactly, not approximately', () => {
    // avgGain:avgLoss = 3:7 -> 100 - 100/(1+3/7) = 30.
    const closes = [100, 93, 96, ...Array(12).fill(96)];
    assert.equal(closes.length, 15);
    assert.equal(computeRSI14(closes), 30);
  });

  await t.test('one tick past each boundary still reads as the extreme, not neutral', () => {
    // avgGain:avgLoss = 9:3 (ratio 3) -> 100 - 100/4 = 75, clear of 70.
    const overClose = [100, 109, 106, ...Array(12).fill(106)];
    assert.equal(overClose.length, 15);
    assert.ok(computeRSI14(overClose)! > 70);

    // avgGain:avgLoss = 2:7 (ratio 2/7) -> 100 - 100/(9/7) = 22.2, clear of 30.
    const underClose = [100, 102, 95, ...Array(12).fill(95)];
    assert.equal(underClose.length, 15);
    assert.ok(computeRSI14(underClose)! < 30);
  });
});
