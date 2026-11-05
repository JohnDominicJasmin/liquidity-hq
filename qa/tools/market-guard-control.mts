/* CONTROL MATRIX for marketDataUnavailable.
 *
 * The point is not that the new version returns a string. It is that the new version returns a
 * string for inputs where the OLD one returned null - so the old implementation is reproduced
 * here and run on the identical fakes. A control that only exercises the new code cannot show
 * that anything changed. */

const SHARED = 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/qa/e2e/_shared.ts';
const { marketDataUnavailable } = await import(SHARED) as {
  marketDataUnavailable: (r: unknown, b?: string) => Promise<string | null>;
};

/** Exactly the pre-fix body: status only. */
async function oldGuard(request: { get: (u: string) => Promise<{ status(): number }> }) {
  try {
    const res = await request.get('/api/market/klines?source=binance&symbol=BTCUSDT&interval=1h&limit=3');
    if (res.status() === 200) return null;
    return `returned ${res.status()}`;
  } catch (e) { return `unreachable ${String(e).slice(0, 20)}`; }
}

const CANDLES = [[1, '1', '2', '0', '1'], [2, '1', '2', '0', '1'], [3, '1', '2', '0', '1']];
const TICKER_OK = { ticker: { btc: { price: 80668.4 }, eth: { price: 3000 } } };

type Case = { name: string; klines: { status: number; body: unknown } | 'throw';
              snap: { status: number; body: unknown } | 'throw'; expectBlocked: boolean };

const CASES: Case[] = [
  { name: 'HEALTHY: candles + btc price',
    klines: { status: 200, body: CANDLES }, snap: { status: 200, body: TICKER_OK }, expectBlocked: false },
  { name: 'THE RUN 41935796786 CASE: 200 with ZERO candles',
    klines: { status: 200, body: [] }, snap: { status: 200, body: TICKER_OK }, expectBlocked: true },
  { name: '200 with a non-array body',
    klines: { status: 200, body: { error: 'nope' } }, snap: { status: 200, body: TICKER_OK }, expectBlocked: true },
  { name: 'klines fine, snapshot has NO btc price',
    klines: { status: 200, body: CANDLES }, snap: { status: 200, body: { ticker: {} } }, expectBlocked: true },
  { name: 'klines fine, btc.price is zero',
    klines: { status: 200, body: CANDLES }, snap: { status: 200, body: { ticker: { btc: { price: 0 } } } }, expectBlocked: true },
  { name: 'klines fine, snapshot 503',
    klines: { status: 200, body: CANDLES }, snap: { status: 503, body: {} }, expectBlocked: true },
  { name: 'klines 418 (the case the old guard DID catch)',
    klines: { status: 418, body: {} }, snap: { status: 200, body: TICKER_OK }, expectBlocked: true },
  { name: 'klines throws',
    klines: 'throw', snap: { status: 200, body: TICKER_OK }, expectBlocked: true },
];

const fake = (c: Case) => ({
  get: async (url: string) => {
    const pick = url.includes('/snapshot') ? c.snap : c.klines;
    if (pick === 'throw') throw new Error('ECONNREFUSED');
    return { status: () => pick.status, json: async () => pick.body };
  },
});

let pass = 0, fail = 0, divergences = 0;
for (const c of CASES) {
  const got = await marketDataUnavailable(fake(c));
  const old = await oldGuard(fake(c) as never).catch((e) => `threw ${String(e).slice(0, 20)}`);
  const blocked = got !== null;
  const ok = blocked === c.expectBlocked;
  ok ? pass++ : fail++;
  const diverged = (old !== null) !== blocked;
  if (diverged) divergences++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  console.log(`      new: ${blocked ? 'BLOCKED' : 'allowed'}   old: ${old !== null ? 'BLOCKED' : 'allowed'}${diverged ? '   <-- OLD GUARD MISSED THIS' : ''}`);
  if (blocked) console.log(`      reason: ${String(got).slice(0, 118)}`);
}
console.log(`\n${pass} pass, ${fail} fail, ${divergences} case(s) the old guard got wrong`);
if (fail > 0) process.exitCode = 1;
