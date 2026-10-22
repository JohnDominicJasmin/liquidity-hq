/* #1651 layer 4: "OI Trend vs Price" is over ONE fixed 60-minute window, OI and price compared at the SAME two moments (#1617, #1613).
 *
 * THE ORACLE is the rule as lib/oiTrendWindow.ts and lib/oiTrend1h.ts state it, written out here as literals and a separate classifier:
 *   - the label: OI up + price up = strong_up (new buyers), OI up + price down = strong_down (new shorts), OI down + price up = weak_up
 *     (short covering), both down = weak_down (long exits); BOTH moves must reach their floor (OI 0.3%, price 0.2%) or there is no label (null);
 *   - the window: a baseline must be 60 minutes old, give or take 10; with none there is no answer, and the store keeps what it had;
 *   - the first load: the newest 5-minute OI point and the one exactly 60 minutes before it, each paired with the OPEN of the candle that
 *     starts at that moment; anything that does not line up is unknown (null), never a shorter window.
 * W3 drives the live path with 8-minute polls over random markets and checks every answer against the classifier, from the same two
 * readings, with the baseline's age inside 50-70 minutes.
 *
 * W7 IS A TODO, a finding for Dev (2026-10-21): the Distribution alert (app/api/telegram/alert/route.ts) still computes its own OI trend
 * over 24 hourly points with 2% / 0.5% floors, under a comment saying "same semantics as the client store's oiTrend". Since #1617 they are
 * not, so the alert's distribution score and the on-screen tracker can disagree for the same coin. Whether the alert should move to the
 * 60-minute rule is a product decision; the todo comes off when it is made.
 *
 * WHAT IT CANNOT PROVE: that Bybit's and Binance's OI points really are 60 minutes apart in production, or what each panel draws. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { oiTrend1h, OI_MOVE_MIN_PCT, PRICE_MOVE_MIN_PCT } from '../lib/oiTrend1h.ts';
import { liveOiTrend, pickBaseline, pushReading, bootstrapReadings, OI_TREND_WINDOW_MS, WINDOW_TOLERANCE_MS, type OiReading } from '../lib/oiTrendWindow.ts';

const MIN = 60_000;

/** The oracle classifier, from the rule text above. */
function label(oiPct: number, pxPct: number): string | null {
  if (!(Math.abs(oiPct) >= 0.3) || !(Math.abs(pxPct) >= 0.2)) return null;
  return oiPct > 0 ? (pxPct > 0 ? 'strong_up' : 'strong_down') : (pxPct > 0 ? 'weak_up' : 'weak_down');
}

test('W1. the four labels, the two floors (both required, each inclusive), and unknown in = no label out', () => {
  assert.equal(OI_MOVE_MIN_PCT, 0.3); assert.equal(PRICE_MOVE_MIN_PCT, 0.2);
  const table: Array<[number | null, number | null, string | null]> = [
    [0.5, 0.3, 'strong_up'], [0.5, -0.3, 'strong_down'], [-0.5, 0.3, 'weak_up'], [-0.5, -0.3, 'weak_down'],
    [0.3, 0.2, 'strong_up'], [-0.3, -0.2, 'weak_down'],          // exactly on both floors counts
    [0.29, 5, null], [5, 0.19, null], [-0.29, -5, null], [0, 0, null],
    [null, 1, null], [1, null, null], [NaN, 1, null], [1, Infinity, null],
  ];
  for (const [oi, px, want] of table) assert.equal(oiTrend1h(oi, px), want, `OI ${oi}% / price ${px}%`);
});

test('W2. the window: a baseline 50-70 minutes old counts, the one closest to 60 wins, nothing else is an hour ago', () => {
  assert.equal(OI_TREND_WINDOW_MS, 60 * MIN); assert.equal(WINDOW_TOLERANCE_MS, 10 * MIN);
  const now = 1_800_000_000_000;
  const at = (ageMin: number, oi = 100): OiReading => ({ t: now - ageMin * MIN, oi, price: 10 });
  assert.equal(pickBaseline([at(45), at(30)], now), null, 'a 45-minute-old reading was used as "an hour ago"');
  assert.equal(pickBaseline([at(71)], now), null, 'a 71-minute-old reading was used as "an hour ago"');
  assert.deepEqual(pickBaseline([at(50)], now), at(50));
  assert.deepEqual(pickBaseline([at(70)], now), at(70));
  assert.deepEqual(pickBaseline([at(55, 1), at(62, 2), at(68, 3)], now), at(62, 2), 'not the reading closest to 60 minutes');
});

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('W3. the live path over 8-minute polls: every answer is the label of the SAME two readings, an hour apart; no answer before an hour exists', () => {
  let answered = 0, labelled = 0;
  for (let s = 1; s <= 40; s++) {
    const r = rng(s);
    let hist: OiReading[] = [];
    let oi = 1e9 * (0.5 + r()), price = 100 * (0.5 + r());
    const t0 = 1_800_000_000_000;
    for (let step = 0; step < 40; step++) {
      const now = t0 + step * 8 * MIN + Math.floor(r() * 30_000);       // polls drift by up to 30 s
      oi *= 1 + (r() - 0.5) * 0.01; price *= 1 + (r() - 0.5) * 0.008;
      const last = { t: now, oi, price };
      const prior = hist;
      const res = liveOiTrend(prior, last, now);
      hist = res.history;
      const candidates = prior.filter((h) => Math.abs(now - h.t - 60 * MIN) <= 10 * MIN);
      if (candidates.length === 0) { assert.equal(res.answered, false, `seed ${s} step ${step}: answered with no reading an hour old`); continue; }
      assert.equal(res.answered, true, `seed ${s} step ${step}: a reading ${Math.round((now - candidates[0].t) / MIN)} min old existed but nothing was answered`);
      const base = candidates.reduce((a, b) => (Math.abs(now - b.t - 60 * MIN) < Math.abs(now - a.t - 60 * MIN) ? b : a));
      const want = label(((oi - base.oi) / base.oi) * 100, ((price - base.price) / base.price) * 100);
      assert.equal(res.trend, want, `seed ${s} step ${step}: baseline ${Math.round((now - base.t) / MIN)} min old`);
      answered++; if (want) labelled++;
    }
  }
  assert.ok(answered >= 1000 && labelled >= 100, `the generator no longer exercises the rule (${answered} answers, ${labelled} labelled)`);
});

test('W4. an hour-old baseline with no strong move CLEARS an old label (answered, null); no baseline leaves the store alone', () => {
  const now = 1_800_000_000_000;
  const quiet = liveOiTrend([{ t: now - 60 * MIN, oi: 100, price: 10 }], { t: now, oi: 100.1, price: 10.01 }, now);
  assert.deepEqual([quiet.answered, quiet.trend], [true, null]);
  const early = liveOiTrend([{ t: now - 20 * MIN, oi: 100, price: 10 }], { t: now, oi: 150, price: 15 }, now);
  assert.deepEqual([early.answered, early.trend], [false, null], 'a 20-minute move was reported as the hour\'s trend');
});

test('W5. history keeps only usable readings young enough to be a baseline again (75 minutes)', () => {
  const now = 1_800_000_000_000;
  const h = pushReading([{ t: now - 76 * MIN, oi: 1, price: 1 }, { t: now - 74 * MIN, oi: 1, price: 1 }], { t: now, oi: NaN, price: 1 }, now);
  assert.deepEqual(h.map((x) => (now - x.t) / MIN), [74], 'a 76-minute reading was kept, or an unreadable OI was stored');
  for (const bad of [{ oi: 0, price: 1 }, { oi: 1, price: -1 }, { oi: 1, price: Infinity }]) {
    assert.equal(pushReading([], { t: now, ...bad }, now).length, 0, `stored ${JSON.stringify(bad)}`);
  }
});

test('W6. first load: the newest 5-minute OI point and the one 60 minutes before it, each with the OPEN of the candle that starts then', () => {
  const t1 = 1_800_000_000_000;
  const oi = Array.from({ length: 13 }, (_, i) => ({ timestamp: String(t1 - i * 5 * MIN), openInterest: String(1000 + i) }));   // newest first
  const kl = Array.from({ length: 13 }, (_, i) => [String(t1 - i * 5 * MIN), String(50 + i), '0', '0', String(99 + i)]);        // open, h, l, close
  const r = bootstrapReadings(oi, kl);
  assert.deepEqual(r, [{ t: t1 - 60 * MIN, oi: 1012, price: 62 }, { t: t1, oi: 1000, price: 50 }]);
  assert.equal(bootstrapReadings(oi.slice(0, 12), kl), null, 'no point 60 minutes back must be unknown, not a 55-minute window');
  assert.equal(bootstrapReadings(oi, kl.filter((k) => k[0] !== String(t1 - 60 * MIN))), null, 'a missing candle must be unknown, not a neighbour\'s price');
  assert.equal(bootstrapReadings(oi.map((p, i) => (i === 0 ? { ...p, openInterest: 'n/a' } : p)), kl), null);
});

test('W7. the Distribution alert reads OI trend by the same 60-minute rule as the screens', { todo: 'finding for Dev/PM 2026-10-21: the alert cron uses 24 hourly points and 2% / 0.5% floors' }, () => {
  const route = readFileSync(new URL('../app/api/telegram/alert/route.ts', import.meta.url), 'utf8');
  const block = route.slice(route.indexOf('OI trend vs price'), route.indexOf('Top-trader dollar-weighted'));
  assert.ok(block.length > 0, 'the alert\'s OI trend block moved - re-read the route');
  assert.match(block, /oiTrend1h\(|trendBetween\(|liveOiTrend\(/, 'the alert computes its own OI trend, over a different window and floors');
});
