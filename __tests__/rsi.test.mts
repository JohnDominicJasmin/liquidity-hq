import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRSI14 } from '../lib/rsi.ts';

/* computeRSI14 was moved out of MarketProvider so app/api/market/rsi could
   share it. These lock the exact numbers the client produced before the move -
   the risk of the refactor is not a crash, it is the value shifting by a point
   and silently moving coins across the 30/70 badge thresholds. */
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

  await t.test('alternating equal gains and losses is 50', () => {
    // 14 changes of +1/-1 in equal number: avgGain === avgLoss, so RSI is 50.
    const closes = [100];
    for (let i = 0; i < 20; i++) closes.push(closes[closes.length - 1] + (i % 2 ? -1 : 1));
    assert.equal(computeRSI14(closes), 50);
  });

  await t.test('reads only the last 14 changes, not the whole array', () => {
    /* The window is what makes the client's limit=16 and limit=20 requests
       interchangeable, which the API route relies on. A long crash followed by
       14 clean up-bars must read 100, not something dragged down by history. */
    const crash = Array.from({ length: 40 }, (_, i) => 500 - i * 10);   // ends at 110
    // Continues up from where the crash ended, so all 14 trailing changes are
    // gains. Starting the recovery at a lower price instead would leave the
    // gap itself inside the window and correctly read ~57, not 100.
    const recovery = Array.from({ length: 14 }, (_, i) => 111 + i);
    assert.equal(computeRSI14([...crash, ...recovery]), 100);
  });

  await t.test('returns a rounded integer', () => {
    const closes = [100, 102, 101, 104, 103, 107, 105, 110, 108, 113,
                    111, 116, 114, 119, 117, 122];
    const rsi = computeRSI14(closes);
    assert.ok(rsi !== null);
    assert.equal(rsi, Math.round(rsi!));
    assert.ok(rsi! >= 0 && rsi! <= 100);
  });
});
