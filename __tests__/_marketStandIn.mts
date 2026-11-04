/* THE MARKET STAND-IN, shared by every test file that INVOKES a route which gathers market data.
 *
 * Not a spec: `npm test` globs `__tests__/*.test.mts`, so this file is imported, never collected
 * (same convention as `_grokBody.mts`).
 *
 * WHY THIS EXISTS. #1910 makes `/api/grok` read the Arena's numbers server-side
 * (`arenaServerNumbers`) BEFORE it calls the model, and refuse with 503 `MARKET_UNAVAILABLE` when
 * that gather fails. The gather reaches real exchange hosts, so a fetch stand-in that throws on any
 * non-Supabase origin turns **every cell in the file** into a 503 regardless of what it was
 * testing. In `arenaCoinLadder` the clearest case was R6: it sets `db.failSubsRead` and is entirely
 * about the PLAN read, and it failed on a market refusal it never reaches in the product.
 *
 * Dev Team read that failure first as the 503 contradicting #1119's precedent. It is not: there was
 * no market stub in that file at all. The owner's decision stands (a market outage never bills the
 * request) and this is the harness catching up to it.
 *
 * WHY IT IS SHARED RATHER THAN COPIED. #1918 put this in `arenaCoinLadder.test.mts`; Dev then
 * found `aiReadChecks.test.mts` needs the identical thing, and bounded the set by measurement
 * rather than guess - of the six test files touching `app/api/grok/route`, only those two invoke
 * the handler, the other four read it as source text. Two copies of a stub drift exactly the way
 * two copies of a parser did (#1898, thirteen formatters). A third caller is plausible, so the
 * second one is the right moment to extract.
 *
 * WHAT THIS IS NOT. It is shaped to make the gather SUCCEED, not to be a market-data fixture.
 * The numbers are a deterministic ramp. **Nothing here may be used to assert a formatted field**
 * - that needs a fixture built for it, with a candle count large enough that `computeKlineMetrics`
 * does not return null (it needs 15, over a 100 window), or every field degrades to '-' on both
 * sides of a comparison and parity holds while measuring nothing.
 *
 * ONLY THE TICKER SECTION DECIDES ok/not-ok. `arenaServerNumbers` refuses when
 * `snap.data.partial` includes `'ticker'`; a failing kline or RSI feed degrades individual fields
 * instead. The klines and Bybit handlers are here so a real request does not fall through to the
 * caller's stray-request throw, not because anything needs their values. */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const BINANCE_HOST = /^(?:api[0-9]?|fapi[0-9]?)\.binance\.com$/;

/** True for any host the stand-in answers. Check this BEFORE a stray-request throw. */
export const isMarketHost = (host: string): boolean => BINANCE_HOST.test(host) || host === 'api.bybit.com';

/** Optional bookkeeping, so each caller records into its own shape. */
export type MarketRecord = {
  /** Every market request the stand-in answered, as `host+pathname`. */
  seen?: (hostAndPath: string) => void;
  /** A market path the stand-in does not model - a gap in the stub, not a product defect. */
  gap?: (methodHostAndPath: string) => void;
};

/**
 * Answers the exchange feeds `arenaServerNumbers` gathers.
 * Returns `null` when `url.host` is not a market host, so the caller continues to its own handling.
 */
export const marketStandIn = (req: Request, url: URL, record: MarketRecord = {}): Response | null => {
  if (!isMarketHost(url.host)) return null;
  record.seen?.(`${url.host}${url.pathname}`);

  /* The mirror-walk pings each host to pick one; answering keeps it off the real network. */
  if (url.pathname.endsWith('/ping')) return json(200, {});

  if (url.pathname.endsWith('/ticker/24hr')) {
    /* The batched spot call passes `symbols=["BTCUSDT",...]`; the futures call passes none and
       expects every symbol. Echoing the request's own list keeps the two shapes honest. */
    const asked = url.searchParams.get('symbols');
    const syms: string[] = asked ? JSON.parse(asked) : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'];
    return json(200, syms.map((symbol, i) => ({
      symbol,
      lastPrice: String(100 + i),
      priceChangePercent: '1.5',
      quoteVolume: '1000000',
      highPrice: String(101 + i),
      lowPrice: String(99 + i),
      weightedAvgPrice: String(100 + i),
    })));
  }

  /* 121 rows because the gather asks for `limit=121`; oldest-first, as Binance returns them. */
  const binanceKlines = Array.from({ length: 121 }, (_, i) => {
    const open = 100 + (i % 7);
    const t = 1_700_000_000_000 + i * 900_000;
    return [t, String(open), String(open + 1), String(open - 1), String(open + 0.5), '10',
      t + 899_999, '1000', 5, '5', '500', '0'];
  });
  if (url.pathname.endsWith('/klines')) return json(200, binanceKlines);

  /* The long/short ratio feeds. Named by the harness own gap report rather than found by reading:
     it printed globalLongShortAccountRatio and topLongShortPositionRatio instead of letting the
     failure read as a route defect, which is what that mechanism is for. */
  if (url.pathname.startsWith('/futures/data/')) {
    const sym = url.searchParams.get('symbol') ?? 'BTCUSDT';
    return json(200, [{ symbol: sym, longAccount: '0.55', shortAccount: '0.45', longShortRatio: '1.22', timestamp: 1_700_000_000_000 }]);
  }

  /* Bybit account-ratio, added in #1920 BEFORE #1912 needed it. #1912 sources longShortRatio from
     the server and `lib/accountRatioData.ts` reaches this path, which otherwise falls past every
     branch above to the gap reporter - so `db.unknown` would be non-empty and EVERY Arena cell in
     the caller would fail naming it. The route itself stays 200: `bybitFanout` throws on an
     all-failed run, `accountRatioFor` catches it, and the field degrades to a dash. So that was
     the reporter working correctly on a path that did not exist yet, not a behaviour change.

     Dev Team traced it and handed it over rather than adding it to their own PR, for the same
     reason they declined the #1861 one-liner: choosing what a QA harness models to make their
     branch green is a choice nobody could audit.

     THE TWO NUMBERS ARE LOAD-BEARING. `pickAccountRatio` reads buyRatio/sellRatio off
     `result.list[0]`, and `parseRatioPair` REJECTS a pair that does not sum to 1 - #1651, because
     a missing side used to become a plausible 50/50 that consumers treated as measured. 0.55/0.45
     is chosen to pass that rule, not to look realistic, and the parser was read rather than the
     values taken on trust. Dev Team then confirmed this handler by running #1912's control on a
     tree without it: `db.unknown` named `api.bybit.com/v5/market/account-ratio`, which is the
     observed red the PR could not get in isolation. */
  if (url.pathname.startsWith('/v5/market/account-ratio')) {
    return json(200, { retCode: 0, result: { list: [{ buyRatio: '0.55', sellRatio: '0.45', timestamp: 1_700_000_000_000 }] } });
  }
  if (url.pathname.startsWith('/v5/market/tickers')) {
    return json(200, { retCode: 0, result: { list: [{ symbol: 'HYPEUSDT', lastPrice: '30', price24hPcnt: '0.02', turnover24h: '1000000' }] } });
  }
  if (url.pathname.startsWith('/v5/market/kline')) {
    /* Bybit returns newest-first and as strings, which is the opposite of Binance - reversing here
       rather than reusing the array is deliberate, since a stub that flattened that difference
       would hide a real parsing bug. */
    return json(200, { retCode: 0, result: { list: [...binanceKlines].reverse().map((k) => [String(k[0]), k[1], k[2], k[3], k[4], k[5], k[7]]) } });
  }

  /* A market path the stand-in does not model is recorded like any other gap, not thrown. */
  record.gap?.(`${req.method} ${url.host}${url.pathname}`);
  return json(501, { code: 'QA_STAND_IN_GAP', message: `the stand-in does not model ${url.host}${url.pathname}` });
};
