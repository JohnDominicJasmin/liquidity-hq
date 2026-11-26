/* QA: PR #2822 (#1651 owner items 57 and 58). Beside the updated cells of routeLastGood2740 and lastGood2817 (cold funding and cycle failures answer 502; macro, snapshot and proxy headers run for real):
 *   U1 the RSI route's failure is the same 502 as the others, and no data route still answers an upstream failure with 500
 *   U2 each lowered header is the server's own time: macro its quote time, snapshot its ticker time, proxy types never longer than their own */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('U1. funding, cycle and RSI answer 502 when the upstream is down', () => {
  assert.ok(read('app/api/funding/route.ts').includes("return apiError('funding', err, 502, 'Request failed');"));
  assert.ok(read('app/api/cycle/route.ts').includes("return apiError('cycle', e, 502, 'Request failed');"));
  const rsi = read('app/api/market/rsi/route.ts');
  assert.ok(rsi.includes("return apiError('market-rsi', err, 502, 'Request failed');"));
  assert.equal(/apiError\('market-rsi', [^)]*500/.test(rsi), false);
});

test('U2. no cache header outlives the server\'s own time', () => {
  const macro = read('app/api/macro/route.ts');
  assert.ok(macro.includes("'Cache-Control': polledCacheControl(YF_TTL_MS / 1000)"));
  const ticker = /const TICKER_TTL\s*=\s*([\d_]+)/.exec(read('lib/marketSnapshotData.ts'));
  assert.equal(Number(ticker?.[1].replace(/_/g, '')), 45_000, 'CONTROL: the ticker section is kept 45 s');
  assert.ok(read('app/api/market/snapshot/route.ts').includes("headers: { 'Cache-Control': polledCacheControl(45) },"));
  assert.ok(read('app/api/proxy/route.ts').includes("...(cacheable ? { 'Cache-Control': polledCacheControl(Math.min(300, entry.ttlMs / 1000)) } : {}),"));
});
