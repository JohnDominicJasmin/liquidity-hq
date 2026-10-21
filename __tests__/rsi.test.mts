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
   "rounded integer": rounding before a 30/70 comparison is what the owner ruled out). The 0/100/flat/15-close/30/70 cases are unchanged: with
   exactly 15 closes Wilder's value IS its seed, the simple mean. */
test('computeRSI14', async (t) => {
  await t.test('needs 15 closes to produce 14 changes', () => {
    assert.equal(computeRSI14([]), null);
    assert.equal(computeRSI14(Array(14).fill(100)), null);
    assert.notEqual(computeRSI14(Array(15).fill(100)), null);
  });

  await t.test('a strictly rising series is 100', () => {
    // No losses at all, so avgLoss is 0 and the divide-by-zero branch applies.
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    assert.equal(computeRSI14(closes), 100);
  });

  await t.test('a flat series is also 100', () => {
    /* Every change is 0, so avgGain and avgLoss are both 0 and avgLoss === 0
       wins. Documenting rather than endorsing: a flat market reading as
       maximally overbought is a quirk of this formula, and anything consuming
       rsi === 100 as a sell signal inherits it. */
    assert.equal(computeRSI14(Array(20).fill(100)), 100);
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
