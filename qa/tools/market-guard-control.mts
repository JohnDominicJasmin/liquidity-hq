/* CONTROL MATRIX for marketDataUnavailable.
 *
 * The point is not that the new version returns a string. It is that the new version returns a
 * string for inputs where the OLD one returned null - so the old implementation is reproduced
 * here and run on the identical fakes. A control that only exercises the new code cannot show
 * that anything changed. */

/* RESOLVED FROM THIS FILE, NOT FROM AN ABSOLUTE PATH, and the reason is the whole point of the
   tool. It read `file:///C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/...` - one checkout on
   one machine. Anywhere else that import fails; worse, on a machine that HAPPENS to have that path
   it would certify a copy of `_shared.ts` nobody ships, and print the same green either way. A
   control that can verify the wrong artifact is the failure mode this file exists to catch, so it
   does not get to have it. Caught in review by PM/DevOps. */
const SHARED = new URL('../e2e/_shared.ts', import.meta.url).href;
console.log(`resolving _shared.ts from import.meta.url -> ${SHARED.replace(/^file:\/\/\//, '')}`);

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

/* ── entitlementsUnresolved: the third branch ─────────────────────────────────────────────── */

const { entitlementsUnresolved } = await import(SHARED) as {
  entitlementsUnresolved: (p: unknown) => Promise<string | null>;
};

/* The real copy, read off the components so the control cannot drift from them:
   EntitlementUnknownCard renders class `locked-card-term-wrap` + data-testid, and its `title` is
   ARENA_CONFLUENCE_GATE_TITLE = "Confluence Score". LockedFeatureCard says "part of Pro". */
const PRO_STRINGS = /part of Pro|Unlock with Pro/i;

const BRANCHES = [
  { name: 'entitled: the real Confluence card',
    testids: 0, body: 'Confluence Score 72 EMA Ribbon Order Flow', expectSkip: false },
  { name: 'UNKNOWN: the couldn\'t-verify card (the blind spot)',
    testids: 1, body: 'COULD NOT VERIFY Confluence Score We could not confirm your plan. Retry', expectSkip: true },
  { name: 'free: LockedFeatureCard',
    testids: 0, body: 'Confluence Score is part of Pro. Unlock with Pro', expectSkip: false },
];

let bPass = 0, bFail = 0;
console.log('\nbranch                                              new-skip  old-Pro-control');
for (const b of BRANCHES) {
  const page = { locator: (_sel: string) => ({ count: async () => b.testids }) };
  const reason = await entitlementsUnresolved(page);
  const skipped = reason !== null;
  /* What the pre-fix control alone would have concluded: it only ever looked for the Pro strings. */
  const oldWouldCatch = PRO_STRINGS.test(b.body);
  const ok = skipped === b.expectSkip;
  ok ? bPass++ : bFail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${b.name.padEnd(46)} ${skipped ? 'SKIP   ' : 'proceed'}   ${oldWouldCatch ? 'caught' : 'MISSED'}`);
  if (skipped) console.log(`      reason: ${String(reason).slice(0, 110)}`);
}
console.log(`\n${bPass} pass, ${bFail} fail`);
console.log('The UNKNOWN row is the point: the old Pro-string control MISSED it (that card says');
console.log('neither string), so it reached the card assertion and reported "did not appear at all".');
if (bFail > 0) process.exitCode = 1;
