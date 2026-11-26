/* QA #1185 item 85: the "prices failed" warning turns on and off. The store updaters are lifted from components/MarketProvider.tsx and RUN against a stand-in state.
 *   F1 on: the backup price read answers something that is not a list, or cannot be reached
 *   F2 off: any path that puts a real price in the store (one coin, many, a seed, the backup read itself)
 *   F3 a patch without a real price leaves the warning as it was, on or off
 *   F4 the warning is what turns the feed chip to "delayed" */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { feedState } from '../lib/feedStatus.ts';

const src = readFileSync(new URL('../components/MarketProvider.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function lift(name: string) {
  const from = src.indexOf(`  const ${name} = useCallback(`); assert.ok(from >= 0, `${name} not found`);
  const end = src.indexOf('\n  }, [', from); const close = src.indexOf(']);', end); assert.ok(end > from && close > end, `${name}: no end`);
  return src.slice(from, close + 3);
}
type State = { pricesFailed: boolean; wsStatus: string; coins: Record<string, { price?: number; rsi?: number }> };
function world(start: Partial<State> = {}, answer: () => Promise<unknown> = async () => []) {
  const box = { state: { pricesFailed: false, wsStatus: 'Connecting...', coins: {}, ...start } as State };
  const code = ts.transpileModule(['updateCoin', 'updateCoins', 'seedPrices', 'restPoll'].map(lift).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const api = new Function('useCallback', 'setStore', 'fetch', 'BINANCE_SPOT_SYMS', 'SYM_MAP', 'deadlineSignal', 'REST_POLL_TIMEOUT_MS', `${code}\nreturn { updateCoin, updateCoins, seedPrices, restPoll };`)(
    (f: unknown) => f,
    (u: (s: State) => State) => { box.state = u(box.state); },
    async () => ({ json: answer }),
    { btc: 'BTCUSDT' }, { BTCUSDT: 'btc' }, () => undefined, 1000,
  ) as { updateCoin: (id: string, p: object) => void; updateCoins: (p: object) => void; seedPrices: (p: object) => void; restPoll: () => Promise<void> };
  return { box, api };
}
const row = (lastPrice: string) => [{ symbol: 'BTCUSDT', lastPrice, priceChangePercent: '1', highPrice: '2', lowPrice: '1' }];

test('F1. a failed backup read turns it on', async () => {
  for (const answer of [async () => ({ error: 'upstream' }), async () => null, async () => { throw new Error('unreachable'); }]) {
    const w = world({}, answer); await w.api.restPoll();
    assert.equal(w.box.state.pricesFailed, true);
    assert.equal(w.box.state.wsStatus, 'Connecting...', 'a failed read does not claim a live feed');
  }
});

test('F2. every path that brings a real price turns it off', async () => {
  const on = { pricesFailed: true };
  const paths: Array<[string, (w: ReturnType<typeof world>) => unknown]> = [
    ['one coin', (w) => w.api.updateCoin('btc', { price: 100 })],
    ['many coins, one priced', (w) => w.api.updateCoins({ btc: { rsi: 50 }, eth: { price: 5 } })],
    ['a seed for a coin with no price', (w) => w.api.seedPrices({ btc: { price: 100 } })],
    ['the backup read', (w) => w.api.restPoll()],
  ];
  for (const [name, go] of paths) {
    const w = world(on, async () => row('100')); await go(w);
    assert.equal(w.box.state.pricesFailed, false, name);
  }
});

test('F3. no real price, no change', async () => {
  for (const pricesFailed of [true, false]) {
    const w = world({ pricesFailed, coins: { btc: { price: 90 } } }, async () => []);
    w.api.updateCoin('btc', { rsi: 40 }); w.api.updateCoin('btc', { price: Number.NaN }); w.api.updateCoins({ btc: { rsi: 41 }, eth: { price: undefined } }); w.api.updateCoins({});
    w.api.seedPrices({ btc: { price: 95 } }); w.api.seedPrices({ eth: { rsi: 1 } }); await w.api.restPoll();
    assert.equal(w.box.state.pricesFailed, pricesFailed);
  }
  const unread = world({ pricesFailed: true }, async () => row('')); await unread.api.restPoll();
  assert.equal(unread.box.state.pricesFailed, true, 'a row whose price cannot be read brings no price');
});

test('F4. the chip', () => {
  assert.equal(feedState('Live', true, 0), 'delayed');
  assert.notEqual(feedState('Live', false, 0), 'delayed');
});
