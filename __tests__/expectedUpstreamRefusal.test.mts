import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isExpectedUpstreamRefusal, dropExpectedThenScrub, scrubEvent, monitoringOptions } from '../lib/monitoring.ts';

/* QA's cells for #2331 (P1, GlitchTip over its free limit): an expected upstream refusal is dropped, everything else still goes through scrubEvent exactly as before. Expectations are the PR text: a drop needs EVERY exception value to be
 * a guard message (`<exchange>: cooling down` / `request budget spent`) or an HttpStatusError naming 403, 418 or 429. */
const ev = (...values: Array<{ type?: string; value?: string }>) => ({ exception: { values } });

test('U1. the PR\'s TRUE list: the two guard messages and rate-limit HttpStatusErrors are expected', () => {
  for (const e of [ev({ type: 'HttpStatusError', value: 'bybit: cooling down' }), ev({ type: 'HttpStatusError', value: 'binance: request budget spent this minute (used weight 2300)' }), ev({ type: 'HttpStatusError', value: 'BTCUSDT 403' }), ev({ type: 'HttpStatusError', value: 'Binance 429' }), ev({ type: 'HttpStatusError', value: 'bybit 418' }), ev({ type: 'Error', value: 'okx: cooling down' }), ev({ type: 'Error', value: 'hyperliquid: request budget spent' })])
    assert.equal(isExpectedUpstreamRefusal(e), true, JSON.stringify(e));
});
test('U2. the PR\'s FALSE list: a real error, a 500, a non-HttpStatusError that merely mentions 403, no exception, and a mixed event', () => {
  for (const e of [ev({ type: 'Error', value: 'duplicate key' }), ev({ type: 'HttpStatusError', value: 'BTCUSDT 500' }), ev({ type: 'Error', value: 'fetch failed 403' }), {}, { exception: {} }, { exception: { values: [] } }, ev({ type: 'HttpStatusError', value: 'bybit: cooling down' }, { type: 'Error', value: 'duplicate key' })])
    assert.equal(isExpectedUpstreamRefusal(e), false, JSON.stringify(e));
});
test('U3. the guard message is anchored and limited to the known exchanges: a message that only CONTAINS the phrase, or names another venue, is not dropped', () => {
  for (const m of ['error talking to binance: cooling down', 'coinbase: cooling down', 'binance:cooling down', 'binance: cooling', 'our cooling down notes']) assert.equal(isExpectedUpstreamRefusal(ev({ type: 'Error', value: m })), false, m);
});
test('U4. status numbers need word boundaries: 4290, 14030 and 429x are not 429/403; a bare status in a longer status line is', () => {
  for (const m of ['BTCUSDT 4290', 'BTCUSDT 14030', 'BTCUSDT 429x']) assert.equal(isExpectedUpstreamRefusal(ev({ type: 'HttpStatusError', value: m })), false, m);
  assert.equal(isExpectedUpstreamRefusal(ev({ type: 'HttpStatusError', value: 'bybit klines BTCUSDT: HTTP 429 Too Many Requests' })), true);
});
test('U5. an event is dropped only when EVERY value is expected: two expected values drop, one expected plus one other does not', () => {
  assert.equal(isExpectedUpstreamRefusal(ev({ type: 'HttpStatusError', value: 'bybit: cooling down' }, { type: 'HttpStatusError', value: 'ETHUSDT 429' })), true);
  assert.equal(isExpectedUpstreamRefusal(ev({ type: 'HttpStatusError', value: 'bybit: cooling down' }, { type: 'HttpStatusError', value: 'ETHUSDT 500' })), false);
});
test('U6. dropExpectedThenScrub: null for an expected refusal; otherwise EXACTLY scrubEvent\'s result (the scrub still runs)', () => {
  assert.equal(dropExpectedThenScrub(ev({ type: 'HttpStatusError', value: 'bybit: cooling down' })), null);
  const mk = () => ({ exception: { values: [{ type: 'Error', value: 'duplicate key' }] }, request: { headers: { cookie: 'x=1', authorization: 'Bearer abc' }, url: 'https://x.test/a?token=zzz' }, user: { email: 'a@b.test', ip_address: '1.2.3.4' } });
  assert.deepEqual(dropExpectedThenScrub(mk()), scrubEvent(mk()));
  const out = JSON.stringify(dropExpectedThenScrub(mk())); assert.equal(/Bearer abc|a@b\.test|1\.2\.3\.4/.test(out), false, 'the scrub did not run on an event that goes through');
});
test('U7. the SDK hook is dropExpectedThenScrub (and transactions still only scrub)', () => {
  const o = monitoringOptions() as { beforeSend: unknown; beforeSendTransaction: unknown };
  assert.equal(o.beforeSend, dropExpectedThenScrub); assert.equal(o.beforeSendTransaction, scrubEvent);
});
test('U8. (source guard) the breaker\'s refusal message has no cool-down end time (so repeats group into one issue), while the stats and the health row keep it', () => {
  const g = readFileSync(new URL('../lib/exchangeGuard.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal((g.match(/`\$\{ex\}: cooling down`/g) || []).length, 2, 'both refusal sites say only "cooling down"');
  assert.doesNotMatch(g, /cooling down until/); assert.doesNotMatch(g, /toISOString\(\)\}`\);/, 'a timestamp is back in a thrown message');
  assert.match(g, /_exchangeGuardStats/);
});
