/* #1494 / PR #1496: on a cold load the dashboard's Market Read gave a real-looking verdict before its
 * inputs existed - QA captured "Weak setup - better to wait", 40/100, on a just-deployed `qa`. Cause, in
 * lib/marketRead.ts before the fix: `store.fng ?? 50` scored a missing Fear & Greed as Neutral (12 of 25)
 * and a missing funding rate fell back to 'neu' (8 of 30, the LOWEST funding score). On a weekday off-session
 * that is 10 time + 10 day + 12 + 8 = 40 of 100, which bands as "weak". A visitor was told to wait on data
 * the page did not have. Defect class: "unknown reads as no".
 *
 * The fix: `computeMarketRead` returns `pending: true`, `missing: ['fng' | 'funding']`, `score: null` and
 * `band: null` until both have loaded, with the verdict "Reading the market…". A manual funding override
 * counts as the funding input (the visitor supplied it). components/MarketRead.tsx renders "-" for the
 * score, an empty gauge, no glow, `data-band="pending"` and `aria-busy` while pending.
 *
 * BEHAVIOURAL for the decision: `computeMarketRead` is a pure export, so M1-M8 call it with the inputs
 * missing, partly loaded and fully loaded. The clock is pinned (the time and day factors read `new Date()`)
 * to a Wednesday 12:00 UTC - an instant where no session window fires, i.e. exactly the 10 + 10 the
 * cold-load 40 was built from. M0 checks that premise against lib/session.ts rather than assuming it.
 *
 * STRUCTURAL for the render (C1): the pending presentation lives inside the component, and there is no
 * DOM test library in this repo, so C1 pins the source with exactly-once anchors.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeMarketRead } from '../lib/marketRead.ts';
import { defaultStore, type CoinData, type MarketStore } from '../lib/marketStore.ts';
import { isGodTier, isPrime, isMonEvening, isLondon, isDead } from '../lib/session.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function anchorOnce(src: string, needle: string, label: string): number {
  const n = src.split(needle).length - 1;
  assert.equal(n, 1, `${label}: anchor occurs ${n} time(s), expected exactly 1 - re-read the current source`);
  return src.indexOf(needle);
}

/* Wednesday 2026-09-30 12:00 UTC: weekday, outside God Tier (Sun), Prime (18-21), Mon Evening (Mon),
   London (07-10) and Dead (04-07). timeScore 10, dayScore[3] 10 - the same 20 the cold-load 40 had. */
const WED_NOON_UTC = Date.UTC(2026, 8, 30, 12, 0, 0);
const pinClock = (t: TestContext) => t.mock.timers.enable({ apis: ['Date'], now: WED_NOON_UTC });

const BANDED_VERDICTS = ['Good time to trade', 'Decent conditions - be selective', 'Weak setup - better to wait'];

function coin(overrides: Partial<CoinData> = {}): CoinData {
  return {
    price: 100, change: 0, high: 100, low: 100,
    fundingRate: null, oi: null, vol24: null, volRatio: null,
    longRatio: null, shortRatio: null,
    bnLongRatio: null, bnShortRatio: null,
    bnWhaleLongRatio: null, bnWhaleShortRatio: null,
    rsi14: null, ma20: null, perpPrice: null,
    rsi5m: null, rsi1h: null, rsi4h: null, rsiDaily: null, rsiWeekly: null, rsiMonthly: null,
    cvd: null, cvdDivergence: null,
    poc: null, vah: null, val: null,
    orderBidWalls: null, orderAskWalls: null,
    vwap: null, oiTrend: null,
    takerBuyRatio: null, chartPattern: null,
    nextFrEstimate: null, nextFundingTime: null,
    liqDelta: null, liqLongUsd: null, liqShortUsd: null,
    ...overrides,
  };
}

/* A store built on the provider's real initial state, with only what a case sets changed. Walls stay null,
   so the maximum is 100 and the score is the raw sum. */
function store(fng: number | null, btc: CoinData | undefined): MarketStore {
  return { ...defaultStore, selectedCoin: 'btc', fng, coins: btc ? { btc } : {} };
}

const factor = (r: ReturnType<typeof computeMarketRead>, key: string) => {
  const f = r.factors.find((x) => x.key === key);
  assert.ok(f, `no "${key}" factor in the read`);
  return f;
};

/* ══ Premises ═══════════════════════════════════════════════════════════════════════════════════════ */

test('M0. CONTROL: the pinned instant fires no session window, so time + day really is 10 + 10 - if lib/session.ts moves a window over Wednesday noon, the exact scores below fail with this reason instead of an unexplained number', () => {
  const d = new Date(WED_NOON_UTC);
  assert.equal(d.getUTCDay(), 3, 'the pinned instant is not a Wednesday');
  assert.deepEqual(
    [isGodTier(d), isPrime(d), isMonEvening(d), isLondon(d), isDead(d)],
    [false, false, false, false, false],
    'a session window now covers Wednesday 12:00 UTC - re-derive timeScore before trusting M4/M6',
  );
});

test('M0b. CONTROL: the store the dashboard starts with (MarketProvider\'s useState(defaultStore)) has no Fear & Greed and no coin data - so M1 below IS the cold load, not a hand-built approximation of it', () => {
  anchorOnce(stripComments(read('components/MarketProvider.tsx')), 'useState<MarketStore>(defaultStore)', 'the provider\'s initial store');
  assert.equal(defaultStore.fng, null, 'defaultStore now carries a Fear & Greed value - a cold load is no longer missing it');
  assert.equal(defaultStore.coins[defaultStore.selectedCoin], undefined, 'defaultStore now carries data for the selected coin');
});

/* ══ The decision: no verdict until both inputs exist ════════════════════════════════════════════════ */

test('M1. cold load (the provider\'s real initial store): pending, both inputs named as missing, NO score and NO band - this exact store at this exact instant read "Weak setup - better to wait", 40/100 before the fix', (t) => {
  pinClock(t);
  const r = computeMarketRead(defaultStore);
  assert.equal(r.pending, true);
  assert.deepEqual(r.missing, ['fng', 'funding']);
  assert.equal(r.score, null, 'a score exists while nothing has loaded - 0 would render "0/100", a number is the bug');
  assert.equal(r.band, null);
  assert.equal(r.verdict, 'Reading the market…');
  assert.ok(!BANDED_VERDICTS.includes(r.verdict), `the cold read gave a banded verdict: "${r.verdict}"`);
  assert.match(r.sub, /Fear & Greed/, 'the sub-line does not say it is waiting for Fear & Greed');
  assert.match(r.sub, /funding/, 'the sub-line does not say it is waiting for funding');
});

test('M2. Fear & Greed loaded, coin loaded (price streaming) but funding rate still null: still pending on funding alone - one input is not enough for a verdict', (t) => {
  pinClock(t);
  const r = computeMarketRead(store(62, coin({ fundingRate: null })));
  assert.equal(r.pending, true);
  assert.deepEqual(r.missing, ['funding']);
  assert.equal(r.score, null);
  assert.equal(r.band, null);
  assert.ok(!BANDED_VERDICTS.includes(r.verdict));
  assert.equal(factor(r, 'fund').value, 'Reading…', 'the Funding cell names a side ("Neutral") for a rate that has not loaded');
  assert.equal(factor(r, 'fng').sub, '62', 'the Fear & Greed that DID load is not shown');
});

test('M3. funding loaded, Fear & Greed still null: pending on Fear & Greed alone, and the Fear & Greed cell shows no number - before the fix it showed the invented "50"', (t) => {
  pinClock(t);
  const r = computeMarketRead(store(null, coin({ fundingRate: 0.0003 })));
  assert.equal(r.pending, true);
  assert.deepEqual(r.missing, ['fng']);
  assert.equal(r.score, null);
  assert.equal(r.band, null);
  assert.ok(!BANDED_VERDICTS.includes(r.verdict));
  const fng = factor(r, 'fng');
  assert.equal(fng.value, 'Reading…');
  assert.equal(fng.sub, undefined, `the Fear & Greed cell shows "${fng.sub}" for a value that has not loaded`);
});

test('M4. both loaded (F&G 62, funding +0.03%, no walls): the read resolves with the unchanged formula - 10 time + 10 day + 18 Greed + 30 long-heavy = 68 of 100, "Decent conditions"', (t) => {
  pinClock(t);
  const r = computeMarketRead(store(62, coin({ fundingRate: 0.0003 })));
  assert.equal(r.pending, false);
  assert.deepEqual(r.missing, []);
  assert.equal(r.score, 68);
  assert.equal(r.band, 'mid');
  assert.equal(r.verdict, 'Decent conditions - be selective');
  assert.equal(factor(r, 'fund').value, 'Long-heavy');
});

test('M5. a manual funding override with no funding rate counts as the funding input - the visitor supplied it, so the read is not held back waiting for data it no longer needs', (t) => {
  pinClock(t);
  const r = computeMarketRead(store(62, coin({ fundingRate: null })), 'pos');
  assert.equal(r.pending, false);
  assert.ok(!r.missing.includes('funding'), 'the override was ignored and funding is still reported missing');
  assert.equal(r.score, 68, 'override "pos" should score funding at 30, same as a real long-heavy rate');
  assert.equal(factor(r, 'fund').value, 'Long-heavy');
});

test('M6. the override covers funding ONLY - with Fear & Greed missing the read still waits, rather than the override unlocking a verdict built on a guessed Fear & Greed', (t) => {
  pinClock(t);
  const r = computeMarketRead(store(null, coin({ fundingRate: null })), 'pos');
  assert.equal(r.pending, true);
  assert.deepEqual(r.missing, ['fng']);
  assert.equal(r.score, null);
});

test('M7. CONTROL: a REAL neutral market (F&G 50, funding exactly 0) still scores 40 and reads "Weak setup - better to wait" - the fix tells missing from neutral, it did not just move the weak verdict away', (t) => {
  pinClock(t);
  const r = computeMarketRead(store(50, coin({ fundingRate: 0 })));
  assert.equal(r.pending, false, 'a funding rate of 0 is a real reading and must not count as missing');
  assert.deepEqual(r.missing, []);
  assert.equal(r.score, 40);
  assert.equal(r.band, 'weak');
  assert.equal(r.verdict, 'Weak setup - better to wait');
});

test('M8. boundary: a Fear & Greed of 0 is a real reading (Extreme fear), not a missing one - the check is "== null", not falsy', (t) => {
  pinClock(t);
  const r = computeMarketRead(store(0, coin({ fundingRate: 0.0003 })));
  assert.equal(r.pending, false, 'F&G 0 was treated as not loaded');
  assert.deepEqual(r.missing, []);
  assert.equal(factor(r, 'fng').value, 'Extreme fear');
  assert.equal(r.score, 75, '10 + 10 + 25 extreme fear + 30 long-heavy');
});

/* ══ The render: no number, no gauge, no glow while pending ═══════════════════════════════════════════ */

test('C1. components/MarketRead.tsx never renders the score bare: "-" in the score cell, 0% gauge, no glow, data-band "pending" and aria-busy while the read has no score', () => {
  const src = stripComments(read('components/MarketRead.tsx'));
  anchorOnce(src, "{read.score ?? '-'}<small>/100</small>", 'the score cell');
  anchorOnce(src, "style={{ width: (read.score ?? 0) + '%' }}", 'the gauge fill width');
  anchorOnce(src, "document.body.dataset.rpmLevel = s == null ? '' : s >= 80 ? 'extreme' : s >= 65 ? 'high' : '';", 'the ambient glow level');
  anchorOnce(src, "data-band={read.band ?? 'pending'}", 'the band attribute');
  anchorOnce(src, 'aria-busy={read.pending || undefined}', 'the busy flag');
  /* Every use of read.score must be null-handled: `?? ...`, the `const s = read.score;` the glow guards,
     or the effect's dependency list. A bare `{read.score}` or `read.score >= 80` is the regression. */
  const uses = [...src.matchAll(/read\.score\b(.{0,4})/g)].map((m) => m[1]);
  assert.ok(uses.length >= 3, `only ${uses.length} use(s) of read.score found - re-read the component`);
  for (const after of uses) {
    assert.match(after, /^(\s*\?\?|;|\])/, `read.score is used without a null guard (followed by "${after}")`);
  }
});
