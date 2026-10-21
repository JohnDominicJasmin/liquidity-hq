/* #1626 part 2, A (#1645) and B (#1646): a closed-candle klines answer is keyed by the candle it was fetched in, and a polled answer is never
 * reused by the browser.
 *
 * WHAT THIS PINS: closedCandleKey is the open time of the current UTC candle as of CLOSE_SKEW_MS ago (so the key keeps the old candle for the first
 * 3 s after a close and flips after), for 1h, 4h and 1d at both sides of a close; a non-positive or NaN interval keys as 0; weekly and monthly
 * intervals have no fixed length (intervalToMs null), so the route keys them as before. The klines route builds its closed tag from the key and
 * keeps an entry for at least a whole candle. polledCacheControl says max-age=0, must-revalidate and no stale-while-revalidate, and all 13 polled
 * routes use it.
 *
 * WHAT IT CANNOT PROVE: what an exchange returns in the first seconds after a close, or what a real browser does with the header (Dev measured
 * transferSize in Chrome; my live check after promotion repeats it). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closedCandleKey, intervalToMs, CLOSE_SKEW_MS } from '../lib/candles.ts';
import { polledCacheControl } from '../lib/cacheHeaders.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const T = (iso: string) => Date.parse(iso);
const H = 3_600_000;

test('A1. the skew is 3 s and the key keeps the CLOSED candle for exactly that long after a close (1h)', () => {
  assert.equal(CLOSE_SKEW_MS, 3000);
  const close = T('2026-10-21T05:00:00Z');
  assert.equal(closedCandleKey(H, close - 1), T('2026-10-21T04:00:00Z'), 'just before the close');
  assert.equal(closedCandleKey(H, close + CLOSE_SKEW_MS - 1), T('2026-10-21T04:00:00Z'), 'inside the skew after the close');
  assert.equal(closedCandleKey(H, close + CLOSE_SKEW_MS), T('2026-10-21T05:00:00Z'), 'the skew has passed: a new key');
  assert.equal(closedCandleKey(H, close + 30 * 60_000), T('2026-10-21T05:00:00Z'));
});

test('A2. 4h and 1d keys follow the exchanges\' UTC candles (4h at 00/04/08/..., 1d at midnight UTC)', () => {
  const h4 = intervalToMs('4h')!; const d1 = intervalToMs('1d')!;
  assert.equal(h4, 4 * H); assert.equal(d1, 24 * H);
  assert.equal(closedCandleKey(h4, T('2026-10-21T07:59:59Z')), T('2026-10-21T04:00:00Z'));
  assert.equal(closedCandleKey(h4, T('2026-10-21T08:00:02Z')), T('2026-10-21T04:00:00Z'), 'inside the skew');
  assert.equal(closedCandleKey(h4, T('2026-10-21T08:00:03Z')), T('2026-10-21T08:00:00Z'));
  assert.equal(closedCandleKey(d1, T('2026-10-21T23:59:59Z')), T('2026-10-21T00:00:00Z'));
  assert.equal(closedCandleKey(d1, T('2026-10-22T00:00:03Z')), T('2026-10-22T00:00:00Z'), 'the next morning is a different key (the 16-hour-old daily of #1626)');
});

test('A3. a non-positive or NaN interval keys as 0; weekly and monthly have no fixed length and get no candle key', () => {
  for (const iv of [0, -60_000, Number.NaN]) assert.equal(closedCandleKey(iv, Date.now()), 0);
  for (const iv of ['1w', '1W', '1M']) assert.equal(intervalToMs(iv), null, `${iv} must not be keyed by epoch arithmetic`);
});

test('A4. the klines route keys a closed request by the candle and keeps it at least a whole candle; a live request stays a different key', () => {
  const src = stripTsComments(read('app/api/market/klines/route.ts'));
  assert.ok(/const closedTag = ivMs != null \? `:closed:\$\{closedCandleKey\(ivMs, Date\.now\(\)\)\}` : '';/.test(src), 'the closed tag is not built from the candle key');
  assert.ok(/const ttl = ivMs != null \? Math\.max\(ivMs \+ CLOSE_SKEW_MS, ttlFor\(interval\)\) : ttlFor\(interval\);/.test(src), 'the closed-candle TTL is not at least a whole candle');
  assert.ok(/const closedOnly = q\.get\('closed'\) === '1';\s*const ivMs = closedOnly \? intervalToMs\(interval\) : null;/.test(src), 'closed keying is no longer opt-in (closed=1)');
  assert.ok(!/closedCandleTtl\(/.test(src), 'the old read-timed TTL (the bug) is back');
});

test('B1. the polled header: max-age=0, must-revalidate, s-maxage for a shared cache, and no stale-while-revalidate', () => {
  assert.equal(polledCacheControl(300), 'public, max-age=0, must-revalidate, s-maxage=300');
  assert.equal(polledCacheControl(59.9), 'public, max-age=0, must-revalidate, s-maxage=59');
  assert.equal(polledCacheControl(-5), 'public, max-age=0, must-revalidate, s-maxage=0');
  assert.ok(!/stale-while-revalidate/.test(polledCacheControl(60)));
});

test('B2. the 13 polled routes send the polled header and none of them keeps a stale-while-revalidate header', () => {
  const routes = ['app/api/cmc/route.ts', 'app/api/cycle/route.ts', 'app/api/econ-calendar/route.ts', 'app/api/forex/jpy/route.ts', 'app/api/funding/route.ts', 'app/api/macro/route.ts',
    'app/api/market/account-ratio/route.ts', 'app/api/market/agg-trades/route.ts', 'app/api/market/funding-rate/route.ts', 'app/api/market/klines/route.ts', 'app/api/market/open-interest/route.ts',
    'app/api/market/snapshot/route.ts', 'app/api/proxy/route.ts'];
  for (const r of routes) {
    const src = stripTsComments(read(r));
    assert.ok(/'Cache-Control':\s*polledCacheControl\(/.test(src), `${r} does not send polledCacheControl as its Cache-Control`);
    assert.ok(!/stale-while-revalidate/.test(src), `${r} still sends stale-while-revalidate: the browser can hand back the previous poll`);
  }
});
