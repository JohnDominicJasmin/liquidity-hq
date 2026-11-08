/* The Funding Rate row's three states (#1651, PR #2062).
 *
 * THE DEFECT: the row printed "Funding unavailable" the instant `fundingRate` was null, and null
 * means "has not arrived yet" on 49 of the 50 coins. `components/MarketProvider.tsx:367` is the
 * only writer of `fundingRate`, it writes from the Bybit ticker list, and it runs client-side after
 * mount - so null is the normal state for the first moments of every page load, and a settled word
 * was wrong for it. This is #1613's rule on the one surface #1613 missed.
 *
 * ── WHY THIS TESTS A MODULE AND NOT THE HOOK, which is the whole reason the module exists ───────
 *
 * `useEMAStrategy` only produces `conditions` once candles are cached. A test that renders the hook
 * without stubbing the candle fetch asserts against `STRATEGY_LOADING`'s EMPTY `conditions` array -
 * and an assertion over an empty array passes whether the rule is right or wrong. Dev extracted
 * `lib/fundingDetail.ts` for exactly that reason, and it is the right call: 0 of the files in
 * `__tests__/` render a hook and `@testing-library/react` is not a dependency.
 *
 * ── THE CONTROL THAT MATTERS, because the majority of rows agree with the bug ───────────────────
 *
 * A rule that simply returned 'Funding unavailable' for every input still satisfies three of the
 * six states. So F5 and F7 assert what the text must NOT be, not only what it must be: a collapse
 * back to two states has to fail rather than pass on the majority.
 *
 * NO NETWORK, NO REACT: the function under test imports the coin registry and nothing else.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fundingDetail, coinHasFundingSource, FUNDING_UNAVAILABLE, FUNDING_LOADING,
} from '../lib/fundingDetail.ts';
import { COINS, BYBIT_SYMS } from '../lib/coins.ts';
import { BYBIT_SYMS as BYBIT_SYMS_VIA_STORE } from '../lib/marketStore.ts';

const coinIds = (COINS as readonly unknown[]).map((c) => (typeof c === 'string' ? c : (c as { id: string }).id));
/* SOURCED FROM THE REGISTRY, not hardcoded as 'fet', so the expectation follows the registry if a
   coin is added to or removed from Bybit. Dev offered either; this one cannot go stale silently. */
const sourceless = coinIds.filter((c) => !(c in BYBIT_SYMS));
/* A coin id that is definitely absent, so the no-source branch is covered even if every real coin
   gains a Bybit symbol one day - at which point `sourceless` is empty and the rows below that use
   it would otherwise quietly stop testing anything. */
const SYNTHETIC_ABSENT = 'zzz-not-a-listed-coin';

test('F0. CONTROL: the fixtures and the registry are in the shape the rest of this file assumes', () => {
  assert.notEqual(FUNDING_LOADING, FUNDING_UNAVAILABLE,
    'the loading and unavailable strings are identical, so every assertion below passes vacuously - the whole point is that these two states are distinguishable');
  assert.ok(coinIds.length > 0, 'COINS parsed as empty - the registry import is broken, so nothing below means anything');
  assert.ok(!(SYNTHETIC_ABSENT in BYBIT_SYMS), 'the synthetic id is unexpectedly a real Bybit symbol');
  assert.equal(coinHasFundingSource('btc'), true, 'btc must have a funding source - if this is false the helper is inverted and F5/F6 would be measuring the wrong branch');
  assert.equal(coinHasFundingSource(SYNTHETIC_ABSENT), false, 'the helper claims a source for a coin that does not exist');
  console.log(`F0: ${coinIds.length} coins, ${Object.keys(BYBIT_SYMS).length} with a Bybit symbol, sourceless = ${JSON.stringify(sourceless)}`);
});

test('F1. a live rate reads as a percentage with the safe verdict', () => {
  assert.equal(fundingDetail('btc', 0.0001, true, false), '0.0100% - safe, proceed');
  assert.equal(fundingDetail('btc', 0.0001, true, true), '0.0100% - safe, proceed',
    'the grace flag must be irrelevant once a rate has arrived - a live value is a live value');
});

test('F2. a live rate reads as a percentage with the excessive verdict', () => {
  assert.equal(
    fundingDetail('btc', 0.0025, false, true),
    '0.2500% - excessive, skip entry (bleed/squeeze risk)',
  );
});

test('F3. a rate of ZERO is a rate, not a missing value', () => {
  /* THE TRUTHINESS TRAP, and the reason this row exists. The rule is `fundingRate != null`. If
     anyone "simplifies" that to `if (fundingRate)`, zero becomes falsy and a real, known funding
     rate of exactly 0 would render as "loading…" and then "unavailable" - reporting a measured
     value as a missing one, which is the inverse of the bug this PR fixes and just as wrong. */
  assert.equal(fundingDetail('btc', 0, true, false), '0.0000% - safe, proceed');
  assert.notEqual(fundingDetail('btc', 0, true, false), FUNDING_LOADING);
  assert.notEqual(fundingDetail('btc', 0, true, true), FUNDING_UNAVAILABLE);
});

test('F4. a NEGATIVE rate is a rate - shorts paying longs is normal, not an error', () => {
  assert.equal(fundingDetail('btc', -0.0001, true, false), '-0.0100% - safe, proceed');
  assert.equal(
    fundingDetail('btc', -0.0031, false, true),
    '-0.3100% - excessive, skip entry (bleed/squeeze risk)',
  );
});

test('F5. null INSIDE the grace period reads as loading - and must NOT read as unavailable', () => {
  const got = fundingDetail('btc', null, null, false);
  assert.equal(got, FUNDING_LOADING);
  /* THE POSITIVE CONTROL. A rule that answered 'Funding unavailable' for everything satisfies F6,
     F7 and F8; this is the row that refuses it. If the three states ever collapse back to two,
     this fails first and says why. */
  assert.notEqual(got, FUNDING_UNAVAILABLE,
    'a funding rate that has not arrived yet is being reported as unavailable - this is the #1651 defect, and it is wrong on 49 of 50 coins');
});

test('F6. null AFTER the grace period reads as unavailable', () => {
  assert.equal(fundingDetail('btc', null, null, true), FUNDING_UNAVAILABLE);
});

test('F7. a coin with no funding source says so IMMEDIATELY, without waiting out the grace', () => {
  /* Null is final when nothing can ever write a rate, so sitting on "loading…" for 15 seconds
     would be a promise the app cannot keep. */
  const got = fundingDetail(SYNTHETIC_ABSENT, null, null, false);
  assert.equal(got, FUNDING_UNAVAILABLE);
  assert.notEqual(got, FUNDING_LOADING,
    'a coin nothing writes a funding rate for is showing "loading…" - it will never load');
});

test('F8. a coin with no funding source still says unavailable after the grace', () => {
  assert.equal(fundingDetail(SYNTHETIC_ABSENT, null, null, true), FUNDING_UNAVAILABLE);
});

test('F9. the real registry: every sourceless coin behaves like F7, and the branch is reachable', () => {
  if (sourceless.length === 0) {
    /* NOT a silent pass. If every coin gains a Bybit symbol the no-source branch becomes
       unreachable in production, and F7/F8 keep covering the LOGIC via the synthetic id while this
       row records that reality no longer exercises it. Stating it beats a green tick that hides it. */
    console.log('F9: no sourceless coin in the registry today - the no-source branch is unreachable in production, and only F7/F8 (synthetic) cover it');
    return;
  }
  for (const coin of sourceless) {
    assert.equal(coinHasFundingSource(coin), false, `${coin} is in COINS, absent from BYBIT_SYMS, yet the helper claims a source`);
    assert.equal(fundingDetail(coin, null, null, false), FUNDING_UNAVAILABLE,
      `${coin} has no writer for a funding rate, so it must not show "loading…" even inside the grace period`);
  }
  console.log(`F9: ${sourceless.length} sourceless coin(s) checked: ${JSON.stringify(sourceless)}`);
});

test('F10. the rule reads the SAME registry the writer iterates, not a second copy', () => {
  /* `lib/fundingDetail.ts` imports BYBIT_SYMS from `./coins.ts`; `lib/useEMAStrategy.ts` imports it
     from `./marketStore.ts`; and `components/MarketProvider.tsx` - the only writer of fundingRate -
     imports it from `./marketStore.ts` too and iterates `Object.keys(BYBIT_SYMS)` at :333.
     `marketStore.ts:8` re-exports it from `coins.ts`, so all three are one object today.
     If that ever becomes two maps, `coinHasFundingSource` could answer "no source" for a coin the
     writer does fill, or "has a source" for one it skips - and the row would be confidently wrong
     in a way no state-by-state test above would catch. */
  assert.equal(BYBIT_SYMS_VIA_STORE, BYBIT_SYMS,
    'marketStore no longer re-exports coins.ts BYBIT_SYMS - fundingDetail and the writer are now reading different registries, so coinHasFundingSource can disagree with what actually writes the rate');
});
