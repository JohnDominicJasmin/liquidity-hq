/* #1910 items 1-3: the Arena's server-sourced numbers, and whether comparing them to the browser's
 * measures anything.
 *
 * THE ORDER IS THE POINT AND IT IS DEV TEAM'S, NOT MINE. From #1910's "What I need QA to assert":
 * candle count first, because `computeKlineMetrics` returns null below MIN_KLINES and then **every
 * field degrades to '-' on both sides and parity holds while measuring nothing**. Then parity. Then
 * a planted divergence, because without it parity passes for a comparison that cannot fail.
 *
 * WHY THIS DOES NOT REUSE `_marketStandIn.mts`. That stand-in says of itself that it is shaped to
 * make the gather SUCCEED and that nothing in it may be used to assert a formatted field. It is
 * right, and measured: its candles carry an identical quote volume on every row, so `volRatio` is
 * exactly 1.00, and index 9 is a fixed half of index 5, so `takerBuyRatio` is exactly 0.5 on every
 * candle. Both sides of a comparison would print the same degenerate constants and agree. So the
 * candles here are purpose-built, and this file owns them.
 *
 * WHAT PARITY CAN AND CANNOT ESTABLISH HERE, stated because the passing version is easy to overread.
 * `arenaServerNumbers` builds a row and hands it to `arenaNumberFields` - the SAME formatter the
 * browser calls. So divergence cannot come from the formatting; it can only arrive through the
 * input, which is `lib/arenaContextFields.ts`'s own stated hazard. This file therefore tests
 * **whether the server's row carries the same quantities as the browser's**, with one honest limit:
 *
 *   `components/MarketProvider.tsx:409-419` says the SOCKET owns price, change, high and low, and
 *   the snapshot seeds them only when a coin has no price yet. So in production the browser's
 *   `price` is fresher than the server's cached ticker, and for those two fields the overwrite makes
 *   the prompt slightly STALER rather than fresher - the reverse of the direction #1910's body
 *   argues ("the server's is the newer one"), which holds for the candle-derived fields.
 *   That is not a defect: item 4 is the security property, and a trusted-but-older price is the
 *   intended trade. It does mean the `price` and `change24h` cells below pass because one stubbed
 *   value reaches both sides, and must NOT be read as production parity for those two fields.
 */
import test from 'node:test';
import { NextRequest } from 'next/server';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./qa/alias-hooks.mjs', pathToFileURL('./'));

const SUPABASE = 'http://supabase.invalid';
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/* ── THE CANDLE FIXTURE ────────────────────────────────────────────────────────────────────────
 * 121 rows because `buildKlines` asks for `limit=121` (`marketSnapshotData.ts:300`), oldest-first
 * as Binance returns them. Deterministic, and built so that NO metric lands on a degenerate value:
 *
 *   close   trend plus an oscillation, so ma20 differs from the last price and RSI is neither
 *           null nor pinned at 50
 *   k[5]    base volume, varying, so vwap is a weighted average rather than a plain mean
 *   k[7]    quote volume, varying, so volRatio is not exactly 1.00
 *   k[9]    taker buy BASE volume, a varying share of k[5], so takerBuyRatio is not exactly 0.5
 *
 * Indices are the ones `lib/klineMetrics.ts` actually reads (1,2,3,4,5,7,9) - checked against that
 * file rather than against a Binance doc, since it is the consumer. */
const candle = (i: number, closeOverride?: number): string[] => {
  const close = closeOverride ?? 100 + i * 0.3 + 6 * Math.sin(i / 7);
  const open = close - 0.4 * Math.cos(i / 5);
  const high = Math.max(open, close) + 0.8 + 0.3 * Math.sin(i / 3);
  const low = Math.min(open, close) - 0.8 - 0.3 * Math.cos(i / 4);
  const baseVol = 40 + 18 * Math.sin(i / 6) + (i % 5);
  const takerBuyBase = baseVol * (0.42 + 0.16 * Math.sin(i / 9));
  const t = 1_700_000_000_000 + i * 900_000;
  return [
    String(t), open.toFixed(4), high.toFixed(4), low.toFixed(4), close.toFixed(4),
    baseVol.toFixed(4), String(t + 899_999), (baseVol * close).toFixed(4),
    String(120 + i), takerBuyBase.toFixed(4), (takerBuyBase * close).toFixed(4), '0',
  ];
};

const FIXTURE = Array.from({ length: 121 }, (_, i) => candle(i));

/** The same 121 candles with ONE row changed - item 3's planted divergence. */
const PERTURBED = FIXTURE.map((k, i) => (i === 100 ? candle(i, 180) : k));

/* ── item 1: THE GATE. Everything after this is vacuous if it fails ───────────────────────────── */

test('1. the fixture clears MIN_KLINES and produces real metrics, so a parity comparison can measure something', async () => {
  const { computeKlineMetrics, MIN_KLINES, METRIC_WINDOW } = await import('../lib/klineMetrics.ts');

  assert.ok(FIXTURE.length >= MIN_KLINES,
    `the fixture has ${FIXTURE.length} candles and computeKlineMetrics returns null below ${MIN_KLINES}, which would degrade every field to '-' on BOTH sides and let parity hold while measuring nothing`);
  assert.ok(FIXTURE.length > METRIC_WINDOW,
    `the fixture must exceed the ${METRIC_WINDOW}-candle window so the slice path is the one under test, not the short-array path`);

  const m = computeKlineMetrics(FIXTURE);
  assert.notEqual(m, null, 'computeKlineMetrics returned null on a 121-candle fixture - nothing below can mean anything');
  if (!m) return;

  /* NOT-DEGENERATE, named value by value. Each of these is a number the `_marketStandIn.mts`
     candles actually produce, and each would compare equal on both sides while testing nothing. */
  assert.notEqual(m.volRatio, 1, 'volRatio is exactly 1.00 - the fixture has a flat quote volume, the degenerate case the stand-in warns about');
  assert.notEqual(m.takerBuyRatio, 0.5, 'takerBuyRatio is exactly 0.5 - k[9] is a fixed share of k[5], so this field is constant by construction');
  assert.notEqual(m.rsi14, null, 'rsi14 is null, so three of the thirteen fields degrade to the same dash on both sides');
  assert.notEqual(m.vwap, null, 'vwap is null - k[5] is zero across the window');
  assert.ok(m.rsi14 != null && m.rsi14 > 0 && m.rsi14 < 100, `rsi14 is ${m.rsi14}, outside (0,100) - the close series is monotonic and the reading is pinned`);
  assert.ok(Math.abs(m.ma20 - parseFloat(FIXTURE[FIXTURE.length - 1][4])) > 0.01,
    'ma20 equals the last close, so priceVsMA cannot distinguish above from below');
  assert.ok(m.vah > m.val, `the value area is inverted or flat (vah ${m.vah}, val ${m.val}) - the volume profile has no spread to measure`);
});

test('1b. CONTROL: the degenerate fixture the stand-in produces really does fail the gate above', async () => {
  /* Without this, item 1 is a list of assertions that have never been seen to fire. The stand-in's
     own candle shape is the control, because it is the exact mistake item 1 exists to prevent -
     and it is checked in, so this cannot drift from what that file actually does. */
  const { computeKlineMetrics } = await import('../lib/klineMetrics.ts');
  const flat = Array.from({ length: 121 }, (_, i) => {
    const open = 100 + (i % 7);
    const t = 1_700_000_000_000 + i * 900_000;
    return [String(t), String(open), String(open + 1), String(open - 1), String(open + 0.5), '10',
      String(t + 899_999), '1000', '5', '5', '500', '0'];
  });
  const m = computeKlineMetrics(flat);
  assert.notEqual(m, null, 'the flat fixture should still compute - it is degenerate, not short');
  assert.equal(m?.volRatio, 1, 'the flat fixture no longer pins volRatio at 1.00, so item 1 guards a case that cannot arise and one of its assertions is unreachable');
  assert.equal(m?.takerBuyRatio, 0.5, 'the flat fixture no longer pins takerBuyRatio at 0.5, so that assertion in item 1 is unreachable');

  const short = FIXTURE.slice(0, 14);
  assert.equal(computeKlineMetrics(short), null,
    'a 14-candle array no longer returns null, so MIN_KLINES is not 15 any more and item 1 is asserting the wrong floor');
});

/* ── item 3: THE SENSITIVITY CONTROL, before item 2 reads as a pass ───────────────────────────── */

test('3. one changed candle is visible in the thirteen strings, so a parity comparison CAN fail', async () => {
  const { computeKlineMetrics } = await import('../lib/klineMetrics.ts');
  const { arenaNumberFields, ARENA_NUMBER_FIELDS } = await import('../lib/arenaContextFields.ts');

  const rowFrom = (klines: string[][]) => {
    const m = computeKlineMetrics(klines);
    assert.notEqual(m, null, 'the fixture stopped computing - see item 1');
    return {
      price: parseFloat(klines[klines.length - 1][4]),
      change: 1.5,
      ma20: m?.ma20, volRatio: m?.volRatio, rsi14: m?.rsi14, vwap: m?.vwap,
      takerBuyRatio: m?.takerBuyRatio, poc: m?.poc, vah: m?.vah, val: m?.val,
      rsi1h: 55, rsi4h: 48, rsiDaily: 61, longRatio: 0.55, shortRatio: 0.45,
    };
  };

  const base = arenaNumberFields(rowFrom(FIXTURE));
  const moved = arenaNumberFields(rowFrom(PERTURBED));

  const differing = ARENA_NUMBER_FIELDS.filter((f) => base[f] !== moved[f]);
  assert.ok(differing.length > 0,
    'changing one candle changed NONE of the thirteen strings, so item 2 below is comparing two things that cannot disagree and its pass means nothing');

  /* Reported rather than pinned to an exact set: which fields move depends on WHICH candle moves,
     and pinning the set here would turn a fixture tweak into a failure that reads like a defect. */
  assert.ok(differing.length <= ARENA_NUMBER_FIELDS.length, 'impossible by construction - guards a typo in the filter above');
  console.log(`      one candle at index 100 moved ${differing.length}/${ARENA_NUMBER_FIELDS.length} fields: ${differing.join(', ')}`);
});

/* ── item 2: PARITY, both sides driven from ONE stubbed feed layer ────────────────────────────── */

test('2. the server row and the browser row format to the same thirteen strings', async () => {
  const net: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url);
    net.push(`${url.host}${url.pathname}`);

    if (url.pathname.endsWith('/ping')) return json(200, {});
    if (url.pathname.endsWith('/klines') || url.pathname.startsWith('/v5/market/kline')) {
      /* A DIFFERENT SERIES PER INTERVAL, and the first version of this file did not do that.
         `lib/marketRsi.ts:110-115` fetches 1h, 4h and 1d separately, and when all three got the
         same candles all three RSI fields printed "41 (Neutral)". Parity still held - but three
         identical strings cannot tell each other apart, so a server that SWAPPED rsi1h and rsi4h
         would have passed this cell. Phasing the series per interval closes that, and it is the
         same hazard as the dash-equals-dash one: agreement between two values that are equal for a
         reason unrelated to what is being tested. */
      const phase = { '1h': 1.7, '4h': 3.1, '1d': 4.9, '1w': 6.2, '1M': 7.4 }[url.searchParams.get('interval') ?? ''] ?? 0;
      const series = phase === 0 ? FIXTURE : FIXTURE.map((_, i) => candle(i, 100 + i * 0.3 + 6 * Math.sin(i / 7 + phase)));

      /* Bybit is newest-first and stringified; Binance oldest-first. Serving the SAME series in each
         provider's own order, because a stub that flattened the difference would hide a real parser
         bug - and here it would do so inside the very comparison under test. */
      if (url.host === 'api.bybit.com') {
        return json(200, { retCode: 0, result: { list: [...series].reverse().map((k) => [k[0], k[1], k[2], k[3], k[4], k[5], k[7]]) } });
      }
      return json(200, series);
    }
    if (url.pathname.endsWith('/ticker/24hr')) {
      const asked = url.searchParams.get('symbols');
      const syms: string[] = asked ? JSON.parse(asked) : ['BTCUSDT'];
      const last = parseFloat(FIXTURE[FIXTURE.length - 1][4]);
      return json(200, syms.map((symbol) => ({
        symbol, lastPrice: String(last), priceChangePercent: '1.50',
        quoteVolume: '1000000', highPrice: String(last + 2), lowPrice: String(last - 2),
        weightedAvgPrice: String(last),
      })));
    }
    if (url.pathname.startsWith('/futures/data/')) {
      return json(200, [{ symbol: 'BTCUSDT', longAccount: '0.55', shortAccount: '0.45', longShortRatio: '1.22', timestamp: 1_700_000_000_000 }]);
    }
    if (url.pathname.startsWith('/v5/market/account-ratio')) {
      return json(200, { retCode: 0, result: { list: [{ buyRatio: '0.55', sellRatio: '0.45', timestamp: 1_700_000_000_000 }] } });
    }
    if (url.pathname.startsWith('/v5/market/tickers')) {
      return json(200, { retCode: 0, result: { list: [{ symbol: 'HYPEUSDT', lastPrice: '30', price24hPcnt: '0.02', turnover24h: '1000000' }] } });
    }
    if (url.origin === SUPABASE) return json(200, []);
    throw new Error(`the parity stub does not model ${req.method} ${url.host}${url.pathname} - a real request here would make this comparison meaningless`);
  }) as typeof fetch;

  try {
    const { arenaServerNumbers } = await import('../lib/arenaServerNumbers.ts');
    const { arenaNumberFields, ARENA_NUMBER_FIELDS } = await import('../lib/arenaContextFields.ts');
    const { GET: snapshotGET } = await import('../app/api/market/snapshot/route.ts');
    const { GET: rsiGET } = await import('../app/api/market/rsi/route.ts');

    const server = await arenaServerNumbers('btc');
    assert.equal(server.ok, true, `arenaServerNumbers refused: ${'reason' in server ? String(server.reason) : ''}`);
    if (!server.ok) return;
    assert.equal(server.coinOutsideCoverage, false, 'btc read as outside coverage - the ticker stub is not reaching the gather');

    /* THE BROWSER SIDE COMES FROM THE ENDPOINTS MarketProvider ACTUALLY CALLS, not from a row I
       wrote. Authoring both sides by hand would make this a mirror that cannot disagree with me. */
    const snapBody = await (await snapshotGET(new NextRequest('http://localhost/api/market/snapshot'))).json() as {
      ticker?: Record<string, { price: number; change: number }>;
      klines?: Record<string, Record<string, number | null>>;
    };
    const rsiBody = await (await rsiGET(new NextRequest('http://localhost/api/market/rsi'))).json() as {
      rsi?: Record<string, { rsi1h?: number; rsi4h?: number; rsiDaily?: number }>;
    };

    const t = snapBody.ticker?.btc;
    const k = snapBody.klines?.btc;
    const r = rsiBody.rsi?.btc;
    assert.ok(t, 'the snapshot endpoint returned no btc ticker, so there is no browser row to compare');
    assert.ok(k, 'the snapshot endpoint returned no btc klines, so the candle-derived fields would all be dashes on this side only');

    /* The one re-authored step, and it is the mapping in components/MarketProvider.tsx - the browser
       reads these same keys off these same two responses. Kept to a transcription with no
       arithmetic, so anything this comparison catches is a difference in the QUANTITIES, which is
       the only place divergence can enter once the formatter is shared. */
    const browserRow = {
      price: t?.price, change: t?.change,
      ma20: k?.ma20 ?? undefined, volRatio: k?.volRatio ?? undefined, rsi14: k?.rsi14 ?? undefined,
      vwap: k?.vwap ?? undefined, takerBuyRatio: k?.takerBuyRatio ?? undefined,
      poc: k?.poc ?? undefined, vah: k?.vah ?? undefined, val: k?.val ?? undefined,
      rsi1h: r?.rsi1h, rsi4h: r?.rsi4h, rsiDaily: r?.rsiDaily,
      longRatio: 0.55, shortRatio: 0.45,
    };
    const browser = arenaNumberFields(browserRow);

    /* Non-vacuity again at the point of comparison: if both sides were dashes this would pass. */
    const serverDashes = ARENA_NUMBER_FIELDS.filter((f) => server.fields[f] === '-');
    assert.ok(serverDashes.length < ARENA_NUMBER_FIELDS.length / 2,
      `${serverDashes.length} of ${ARENA_NUMBER_FIELDS.length} server fields are '-' (${serverDashes.join(', ')}), so this comparison is mostly dash-equals-dash`);

    /* THE THREE PER-TIMEFRAME RSI FIELDS MUST NOT BE IDENTICAL, or they cannot tell each other
       apart and a swap of two of them passes. This is an assertion about the FIXTURE's power, not
       about the product - which is why it names the stub when it fails. */
    const rsiTriple = [server.fields.rsi1h, server.fields.rsi4h, server.fields.rsiDaily];
    assert.equal(new Set(rsiTriple).size, 3,
      `rsi1h/rsi4h/rsiDaily are not three distinct strings (${rsiTriple.join(' , ')}), so this cell would pass even if the server swapped two of them - the per-interval phasing in the stub above has stopped working`);

    for (const f of ARENA_NUMBER_FIELDS) {
      assert.equal(server.fields[f], browser[f],
        `field ${f} differs between the server's row and the browser's: server ${JSON.stringify(server.fields[f])} vs browser ${JSON.stringify(browser[f])}. The formatter is shared, so this is a difference in the QUANTITY fed to it - lib/arenaContextFields.ts's stated hazard`);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});
