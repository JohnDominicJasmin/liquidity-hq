/* QA: PR #2845 (#1651 owner item 95 follow-up): when Binance refuses with 418 or 429, the Bybit-only coins are still asked. The real fan-out runs against stand-in venues. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { BYBIT_SYMS, COINS } from '../lib/coins.ts';
import { rsiGroups, mergeRsiGroups } from '../lib/marketRsi.ts';

const FIELDS = ['rsi5m', 'rsi1h', 'rsi4h', 'rsiDaily', 'rsiWeekly', 'rsiMonthly'];
const world = { status: 429, bybit: [] as string[] };
const realFetch = globalThis.fetch, realNow = Date.now;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.pathname.endsWith('/ping')) return ok({});
  if (url.host.includes('binance')) return new Response('refused', { status: world.status });
  if (url.host !== 'api.bybit.com') return new Response('stand-in: no such host', { status: 500 });
  const symbol = url.searchParams.get('symbol') ?? '', n = Number(url.searchParams.get('limit') ?? 120);
  world.bybit.push(`${symbol} ${url.searchParams.get('interval')}`);
  const start = Date.now() - 400 * 86_400_000;
  return ok({ retCode: 0, result: { list: Array.from({ length: n }, (_, i) => [String(start + i * 60_000), '1', '1', '1', String(100 + (i % 7) + i / 50), '1', '1']).reverse() } });
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; Date.now = realNow; });

for (const [i, status] of [429, 418].entries()) {
  test(`Binance ${status}: every coin with a Bybit market keeps all six timeframes, pepe, bonk and xau among them`, async () => {
    world.status = status; world.bybit = [];
    Date.now = () => realNow() + (i + 1) * 40 * 86_400_000;
    const m = mergeRsiGroups(await rsiGroups(), true);
    assert.ok(m.ok, 'the merge failed');
    const rsi = (m as { rsi: Record<string, Record<string, number>> }).rsi;
    for (const coin of COINS.filter((c) => BYBIT_SYMS[c])) for (const f of FIELDS) assert.ok(Number.isFinite(rsi[coin]?.[f]), `${coin} ${f} is missing`);
    for (const c of ['pepe', 'bonk', 'xau'] as const) assert.equal(new Set(world.bybit.filter((r) => r.startsWith(`${BYBIT_SYMS[c]} `))).size, 6, c);
    assert.equal(world.bybit.length, new Set(world.bybit).size, 'the same candles were asked twice');
  });
}
