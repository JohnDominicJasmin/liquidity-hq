import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* PR #2583 - components/MarketProvider.tsx: the first Coinbase premium read is asked for the moment the BTC price lands, with the old 3 s timer kept
 * as the latest, and it is asked for ONCE. The first test RUNS the real `askCoinbasePremiumOnce` text (cut out of the source) against a fake timer and
 * a counting fetch. The rest are SOURCE PINS on the wiring a function test cannot see (effect order, dependency list, the guard, the interval, the math).
 * NOT COVERED: React mounting the provider (no DOM here) and the real /api/coinbase-price. A page-level check still has to watch the network. */
const src = readFileSync(new URL('../components/MarketProvider.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const landing = readFileSync(new URL('../components/LandingTerminal.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const dash = readFileSync(new URL('../components/DashboardTerminal.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const fetchFn = src.slice(src.indexOf('const fetchCoinbasePremium = useCallback'), src.indexOf('const cbAskedRef'));

const askText = (() => {
  const at = src.indexOf('const askCoinbasePremiumOnce = useCallback(');
  assert.ok(at >= 0, 'askCoinbasePremiumOnce not found');
  const end = src.indexOf('}, [fetchCoinbasePremium]);', at);
  assert.ok(end > at);
  return src.slice(at + 'const askCoinbasePremiumOnce = useCallback('.length, end + 1); // the arrow function text
})();
type Clock = { at: number; q: { t: number; f: () => void }[] };
const makeAsk = () => {
  const cbAskedRef = { current: false };
  let fetches = 0;
  const fetchCoinbasePremium = () => { fetches++; return Promise.resolve(); };
  const ask = new Function('cbAskedRef', 'fetchCoinbasePremium', 'return ' + askText)(cbAskedRef, fetchCoinbasePremium) as () => void;
  return { ask, cbAskedRef, count: () => fetches };
};
/* the mount effect, modelled from the pinned source lines: reset the flag, arm the 3 s timer; the price effect asks when the price is there. A tiny fake clock. */
const mount = (m: ReturnType<typeof makeAsk>, clock: Clock) => {
  m.cbAskedRef.current = false;
  const e = { t: clock.at + 3000, f: m.ask };
  clock.q.push(e);
  return () => { const i = clock.q.indexOf(e); if (i >= 0) clock.q.splice(i, 1); };   // the effect's cleanup: clearTimeout(cbFallbackTimer)
};
const advance = (clock: Clock, ms: number) => {
  const to = clock.at + ms;
  for (const e of [...clock.q].sort((a, b) => a.t - b.t)) if (e.t <= to) { clock.q.splice(clock.q.indexOf(e), 1); e.f(); }
  clock.at = to;
};

test('behaviour: asked once when the price lands, never again for the same mount, and the 3 s timer is the latest it can be asked', () => {
  // (a)+(b): price lands at 400 ms, then 500 price ticks, then the 3 s timer
  let m = makeAsk(); let clock: Clock = { at: 0, q: [] };
  mount(m, clock); advance(clock, 400);
  m.ask(); for (let i = 0; i < 500; i++) m.ask(); advance(clock, 5000);
  assert.equal(m.count(), 1, 'one request for one mount, however many price ticks and the timer after');
  // (c): the price never lands: the timer asks at 3 s, not before
  m = makeAsk(); clock = { at: 0, q: [] }; mount(m, clock);
  advance(clock, 2999); assert.equal(m.count(), 0, 'not before 3 s without a price');
  advance(clock, 1); assert.equal(m.count(), 1, 'at 3 s without a price');
  // price lands after the timer already asked: nothing more
  m.ask(); assert.equal(m.count(), 1);
  // a remount (enabled toggled) resets the flag and asks again once
  mount(m, clock); m.ask(); m.ask(); assert.equal(m.count(), 2);
  // unmounted before 3 s with no price ever: the cleanup cancels the timer, so NO request fires
  m = makeAsk(); clock = { at: 0, q: [] };
  const unmount = mount(m, clock); advance(clock, 1000); unmount(); advance(clock, 10_000);
  assert.equal(m.count(), 0, 'a provider unmounted within 3 s must not fire the read');
});

test('the mount effect resets the flag, then arms the 3 s timer on the ask-once function (not on the raw fetch)', () => {
  assert.match(src, /cbAskedRef\.current = false;\n\s*const cbFallbackTimer = setTimeout\(askCoinbasePremiumOnce, 3000\);/);
  assert.match(src, /offPriceOnline\(\);\n\s*clearTimeout\(cbFallbackTimer\);/, 'the 3 s timer is not cleared on unmount');
  assert.ok(!/setTimeout\(fetchCoinbasePremium, 3000\)/.test(src), 'the blind 3 s fetch is back');
});

test('the price effect: keyed on a BOOLEAN (price present), guarded by enabled, so a price tick never re-runs it; it comes AFTER the mount effect', () => {
  assert.match(src, /const btcPriced = Number\.isFinite\(store\.coins\.btc\?\.price\);/);
  // a NaN or missing price must not use up the single ask (it would store 'failed' until the 30 s refresh)
  for (const bad of [NaN, undefined, null as unknown as number, Infinity]) assert.equal(Number.isFinite(bad), false);
  assert.equal(Number.isFinite(64000), true);
  assert.match(src, /useEffect\(\(\) => \{\n\s*if \(enabled && btcPriced\) askCoinbasePremiumOnce\(\);\n\s*\}, \[enabled, btcPriced, askCoinbasePremiumOnce\]\);/);
  assert.ok(!/\[[^\]]*store\.coins\.btc[^\]]*\]\);/.test(src.slice(src.indexOf('const btcPriced'))), 'the raw price in a dependency list would re-run per tick');
  const mountEffect = src.indexOf('cbAskedRef.current = false;');
  const priceEffect = src.indexOf('if (enabled && btcPriced)');
  assert.ok(mountEffect > 0 && priceEffect > mountEffect, 'if the price effect ran first, the mount effect would reset the flag after the ask and the 3 s timer would ask a second time');
  assert.match(src, /const askCoinbasePremiumOnce = useCallback\(\(\) => \{[\s\S]*?\}, \[fetchCoinbasePremium\]\);/);
  assert.match(fetchFn, /\n  \}, \[\]\);\n\n/, 'fetchCoinbasePremium must stay dependency-free or ask-once changes identity every render');
});

test('the 30 s refresh is untouched (the retry for a failed first read)', () => {
  assert.match(src, /\[fetchCoinbasePremium, 30 \* 1000\],  \/\/ every 30s/);
});

test('the premium math is unchanged: Coinbase USD minus exchange USDT price converted to USD, as a percent of that, no raw difference without the USDT rate', () => {
  assert.match(src, /if \(!bybitPrice \|\| !usdtUsd\) return \{ \.\.\.s, cbPremium: null, cbPremiumPct: null, cbPremiumStatus: s\.cbPremiumStatus === 'ok' \? 'ok' : 'failed' \};/);
  assert.match(src, /const bybitUsd   = bybitPrice \* usdtUsd;\n\s*const premium    = cbPrice - bybitUsd;\n\s*const premiumPct = \(premium \/ bybitUsd\) \* 100;/);
});

test('a failed read stores no figure and the landing hides the row; every failure path marks failed and keeps an earlier ok', () => {
  assert.equal((fetchFn.match(/markCb\('failed'\)/g) ?? []).length, 2, 'not ok / bad price');
  assert.match(fetchFn, /catch \{ setStore\(s => \(\{ \.\.\.s, cbPremiumStatus: s\.cbPremiumStatus === 'ok' \? 'ok' : 'failed' \}\)\); \}/);
  assert.match(landing, /state: cbPct != null \? undefined : \(store\.cbPremiumStatus === 'pending' \? 'loading' : 'unavailable'\)/);
  assert.match(landing, /evidence\.filter\(row => row\.state !== 'unavailable' && /);
});

test('the figure is formatted the same on the landing and the dashboard: signed, three decimals, percent', () => {
  const fmt = /\(cbPct >= 0 \? '\+' : ''\) \+ cbPct\.toFixed\(3\) \+ '%'/;
  assert.match(landing, fmt);
  assert.match(dash, fmt);
});
