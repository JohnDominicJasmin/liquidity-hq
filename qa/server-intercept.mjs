import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* Intercept the SERVER's outbound fetch, which `page.route` cannot reach.
 *
 * WHY THIS EXISTS. `qa/e2e/_fixtures.ts` intercepts what the BROWSER requests,
 * and that covers a lot - but this app's `/api/*` handlers call Binance, Bybit,
 * Yahoo and er-api from the Node process. Measured on one contrast sweep:
 * ~159 outbound calls the browser never sees (101 [cmc], 58 [proxy], 4
 * [econ-calendar]). Those are invisible to `page.route` and go out live on every
 * run, which is `TEST_GAPS` §1's remaining half and the reason #114 cannot step
 * `workers` past 2 on inference alone.
 *
 * WHY A PRELOAD AND NOT A CONFIG SEAM. There isn't one - upstream hosts are
 * hardcoded across the route handlers (18 fapi.binance.com, 17 api.bybit.com,
 * and so on), and QA does not write app code. `undici`'s MockAgent is not
 * available either; it is not a resolvable dependency here.
 *
 * So this wraps `globalThis.fetch` in a module loaded with `--require`, before
 * any app code runs. No dependency, no app change, and it disappears entirely
 * when the env var is absent.
 *
 * ── OFF BY DEFAULT ─────────────────────────────────────────────────────────
 * Does nothing unless QA_INTERCEPT_UPSTREAM=1. A preload that silently altered
 * every run would be far worse than the gap it closes: a suite that passes
 * against stubs while claiming to have talked to Binance is a vacuous pass with
 * extra steps.
 *
 * ── IT LOGS WHAT IT DID, ALWAYS ────────────────────────────────────────────
 * Every decision prints `[intercept]`. A silent stub is indistinguishable from a
 * live call in a log, and that ambiguity is what this whole exercise is about.
 *
 * ── ESM AND `--import`, NOT CJS AND `--require` ────────────────────────────
 * This was `.cjs` and loaded with `--require`. It worked, and it broke CI in a
 * way worth recording: `npm run lint` failed with
 *
 *     A configuration object specifies rule "react-hooks/set-state-in-effect",
 *     but could not find plugin "react-hooks"
 *
 * The config object in `eslint.config.mjs` that sets the react-hooks rules
 * carries no `plugins` key and no `files` restriction, so it applies to every
 * file - but the plugin itself is only registered for the patterns Next's
 * config covers. Every file in the repo happened to be .ts/.tsx, so nothing had
 * ever landed outside that. One .cjs file was enough.
 *
 * That is a latent config bug rather than something this file caused, and it is
 * reported separately. Using ESM with `--import` (Node 20.6+) sidesteps it
 * without touching shared lint config, which is not QA's to change.
 */
/* Three states, and the middle one is the useful one for #114.
 *
 *   unset    do nothing at all. The default, and the only safe default.
 *   'count'  pass EVERY call through untouched, but tally it by host. Measures
 *            real egress without changing a single response, so a suite run in
 *            this mode is exactly as valid as one without the preload.
 *   '1'      stub the known hosts. Removes egress entirely; changes behaviour.
 *
 * 'count' exists because #114 needs a number nobody has: how many outbound calls
 * the FULL suite makes. ~159 was measured for the contrast sweep alone, by
 * grepping route-handler log lines - which counts route invocations, not
 * upstream requests, and misses every host that does not log. */
const MODE = process.env.QA_INTERCEPT_UPSTREAM === '1' ? 'stub'
  : process.env.QA_INTERCEPT_UPSTREAM === 'count' ? 'count'
  : 'off';
const ENABLED = MODE !== 'off';

/* STDERR, never stdout, and this was measured the hard way.
 *
 * `NODE_OPTIONS=--require` applies to EVERY node process in the tree, including
 * the `npm` wrapper that starts the server. npm parses its own stdout while
 * resolving `npm-prefix.js`, so a single console.log here corrupted that path
 * and the server never started - with an error naming a module path that had
 * this file's banner spliced into it.
 *
 * stderr is not parsed, so it is safe and still visible in Playwright's
 * `stderr: 'pipe'` webServer output. */
const log = (msg) => { try { process.stderr.write(msg + '\n'); } catch { /* never break the app to log */ } };

if (ENABLED) {
  const realFetch = globalThis.fetch;

  /* Hosts the app talks to that a test should not depend on. Anything not
   * listed passes through untouched - Supabase in particular MUST pass through,
   * because the specs sign in with real fixture accounts. */
  const STUBBED = [
    'api.binance.com',
    'fapi.binance.com',
    'fapi1.binance.com',
    'api.bybit.com',
    'query1.finance.yahoo.com',
    'open.er-api.com',
    'api.alternative.me',
    'pro-api.coinmarketcap.com',
    'openapi.sosovalue.com',
    'open-api.coinglass.com',
  ];

  let served = 0;
  let passed = 0;
  /** host -> call count, so the report says WHERE the traffic goes. */
  const byHost = new Map();

  /* The tally file is the only record that survives SIGKILL, so it is written
   * DURING the run rather than at the end.
   *
   * Throttled to once a second: without that, a sweep making thousands of calls
   * would do a synchronous write per call and change the timing of the thing it
   * is measuring. Once a second means the worst case is losing the final <1s of
   * counts to a hard kill, which cannot change any conclusion drawn from a run
   * that lasts minutes.
   *
   * writeFileSync and not a stream: a stream buffers, and a buffer is exactly
   * what SIGKILL discards. */
  /* ONE FILE PER PROCESS, and the pid in the name is the whole point.
   *
   * `NODE_OPTIONS` applies to EVERY node process in the tree - the npm wrapper,
   * the build, the Next server, each Playwright worker. Every one of them loads
   * this module and gets its OWN `byHost` map.
   *
   * The first version wrote them all to a single path, so they overwrote each
   * other and the last writer won. In CI that was a short-lived process with
   * nothing to report, and the run ended with:
   *
   *     [intercept] TOTAL outbound: 0 (0 stubbed, 0 passed through) [exit]
   *
   * while a worker in the same run had already logged
   * `TOTAL outbound: 8 ... 8 wdtjhrilakoitfcezxpx.supabase.co`. The tally was
   * never wrong, it was destroyed - which is the same failure as the original
   * `process.on('exit')` bug wearing a different hat, and I shipped it in the
   * fix for that bug.
   *
   * Per-pid files cannot collide. The reader sums them; ci.yml aggregates the
   * glob and reports both the total and the process count, because "12 processes
   * reported" is itself the signal that this is working.
   *
   * fileURLToPath, NOT `.pathname`: this repo lives under "VS code" and
   * `.pathname` percent-encodes the space, so the first version wrote to
   * `.../VS%20code/...`, threw, and was swallowed by the catch exactly as
   * designed. Caught by testing the SIGKILL case rather than assuming it. */
  const TALLY_PATH = process.env.QA_INTERCEPT_OUT
    ?? fileURLToPath(new URL(`./.intercept-tally.${process.pid}.json`, import.meta.url));
  let lastFlush = 0;
  let trailing = null;

  const flushTally = (force = false) => {
    const now = Date.now();

    /* LEADING + TRAILING, not leading only.
     *
     * A leading-only throttle writes the first call in each window and silently
     * drops the rest, so the file records whatever happened to land on a window
     * boundary. First test of this wrote `total: 1` after three calls - the two
     * that followed within the same second were dropped and nothing ever wrote
     * again, because the process then sat idle.
     *
     * The trailing timer guarantees the last state is always written once the
     * window closes. `unref()` so an idle timer never holds the process open -
     * this module must not change when the server is allowed to exit. */
    if (!force && now - lastFlush < 1000) {
      if (!trailing) {
        trailing = setTimeout(() => { trailing = null; flushTally(true); }, 1000);
        if (typeof trailing.unref === 'function') trailing.unref();
      }
      return;
    }

    lastFlush = now;
    try {
      writeFileSync(TALLY_PATH, JSON.stringify({
        mode: MODE,
        pid: process.pid,
        updatedAt: new Date(now).toISOString(),
        total: [...byHost.values()].reduce((n, c) => n + c, 0),
        served,
        passed,
        byHost: Object.fromEntries([...byHost.entries()].sort((a, b) => b[1] - a[1])),
      }, null, 2));
    } catch { /* never break the app to record a measurement */ }
  };


  /* ── SYNTHETIC, DETERMINISTIC MARKET DATA (option iii, PM 2026-11-12) ────────────────────────
   *
   * The blanket `[]` below removes egress but feeds no data, so every spec that needs a candle or a
   * price fails against this stub - klines-route ("200 with ZERO candles"), anything pricing a coin.
   * This function GENERATES the venue's own response shape from the request, so the real route code
   * (parse, trim, denominate, cache) runs against plausible data and still makes zero network calls.
   *
   * DETERMINISTIC ON PURPOSE: no Math.random. Every value is a function of the symbol and the bar's
   * timestamp, so two runs of the same request produce byte-identical candles and a flake cannot
   * hide here. Timestamps are relative to `Date.now()` at request time, honour `limit`, `interval`
   * and `start`/`end`, and prices are plausible per symbol, including 1000x-denominated contracts. */
  const IV_MS = { '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '2h': 7200000, '4h': 14400000, '6h': 21600000, '12h': 43200000, '1d': 86400000, '1w': 604800000,
    '1': 60000, '3': 180000, '5': 300000, '15': 900000, '30': 1800000, '60': 3600000, '120': 7200000, '240': 14400000, '360': 21600000, '720': 43200000, 'D': 86400000, 'W': 604800000 };
  const KNOWN_PX = { BTC: 69000, ETH: 3500, SOL: 170, BNB: 600, XRP: 0.62, DOGE: 0.16, ADA: 0.45, AVAX: 35, LINK: 18, TON: 6.5, TRX: 0.13, DOT: 7, MATIC: 0.72, LTC: 90, BCH: 440, NEAR: 7, APT: 11, ARB: 1.1, OP: 2.3, SUI: 1.4, XAUT: 3900, CYBER: 6, PEPE: 0.0000082, BONK: 0.000022, SATS: 0.00000045, SHIB: 0.000024 };
  const hashNum = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };
  /* Strip the quote and any venue count-prefix (1000PEPE, 10000SATS), remembering the prefix so the
     synthetic price lands in the SAME order of magnitude the real contract trades at. */
  const basePrice = (symRaw) => {
    let core = String(symRaw || 'BTCUSDT').toUpperCase().replace(/[-_]/g, '').replace(/(USDT|USDC|USD|PERP)$/, '');
    let prefix = 1;
    const m = core.match(/^(\d{3,})(.+)$/);
    if (m) { prefix = Number(m[1]); core = m[2]; }
    const unit = KNOWN_PX[core] ?? (0.01 + hashNum(core) * 200); // plausible unit price for an unknown coin
    return unit * prefix; // a 1000x contract quotes 1000 units, so its price is ~1000x the unit
  };
  const synthUpstream = (url) => {
    let u; try { u = new URL(url); } catch { return null; }
    const p = u.pathname, q = u.searchParams;
    const sym = q.get('symbol') || 'BTCUSDT';
    const base = basePrice(sym);
    const nowMs = Date.now();
    /* One deterministic candle: a smooth, bounded wobble around `base`, keyed on the bar time. */
    const candle = (t, iv) => {
      const phase = t / iv;
      const drift = Math.sin(phase / 29) * 0.03 + Math.cos(phase / 11) * 0.015;
      const o = base * (1 + drift);
      const c = base * (1 + drift + Math.sin(phase / 5) * 0.004);
      const hi = Math.max(o, c) * 1.0025, lo = Math.min(o, c) * 0.9975;
      const vol = 500 + (Math.abs(Math.sin(phase / 7)) * 4500);
      return { o, c, hi, lo, vol };
    };
    const limit = Math.max(1, Math.min(1500, Number(q.get('limit') || 200)));
    const ivKey = q.get('interval') || '1h';
    const iv = IV_MS[ivKey] || 3600000;
    /* SNAP THE NEWEST BAR TO THE INTERVAL BOUNDARY. Without this the newest timestamp is `Date.now()`
       at the moment of the call, so two requests milliseconds apart (a `limit=4` and the unsliced
       reference klines-route compares it against) get DIFFERENT newest bars - the limited one looks
       like a reversed slice ("4 candles whose newest is OLDER than the reference"). Flooring to the
       interval makes every call within the same bar return the identical newest timestamp, so a
       smaller limit is a true suffix of a larger one. A real exchange behaves the same way: the
       newest closed candle is the interval boundary, not the wall clock. */
    const endMs = Number(q.get('end') || q.get('endTime')) || (Math.floor(nowMs / iv) * iv);
    const startBound = Number(q.get('start') || q.get('startTime')) || null;
    const bars = [];
    for (let i = limit - 1; i >= 0; i--) {
      const t = endMs - i * iv;
      if (startBound !== null && t < startBound) continue;
      bars.push({ t, ...candle(t, iv) });
    }
    const f = (n) => n.toPrecision(10);
    // Binance klines: array of 12-element arrays, oldest-first, strings.
    if (/\/klines$/.test(p)) {
      return JSON.stringify(bars.map(b => [b.t, f(b.o), f(b.hi), f(b.lo), f(b.c), f(b.vol), b.t + iv - 1, f(b.vol * b.c), 100, f(b.vol / 2), f(b.vol * b.c / 2), '0']));
    }
    // Bybit kline: { retCode:0, result:{ list:[7-element arrays], ... } }, NEWEST-first.
    if (/\/v5\/market\/kline$/.test(p)) {
      const list = bars.slice().reverse().map(b => [String(b.t), f(b.o), f(b.hi), f(b.lo), f(b.c), f(b.vol), f(b.vol * b.c)]);
      return JSON.stringify({ retCode: 0, retMsg: 'OK', result: { category: q.get('category') || 'linear', symbol: sym, list } });
    }
    // Binance 24hr ticker: one object, or the whole-market array when no symbol.
    if (/\/ticker\/24hr$/.test(p)) {
      const one = (s) => { const bp = basePrice(s); return { symbol: s, lastPrice: bp.toPrecision(10), priceChangePercent: (Math.sin(hashNum(s) * 6) * 5).toFixed(2), quoteVolume: (bp * 1e6).toPrecision(10), openPrice: (bp * 0.99).toPrecision(10), highPrice: (bp * 1.02).toPrecision(10), lowPrice: (bp * 0.98).toPrecision(10), volume: '1000000' }; };
      return JSON.stringify(sym && q.get('symbol') ? one(sym) : [one('BTCUSDT'), one('ETHUSDT')]);
    }
    // Bybit tickers: { retCode:0, result:{ list:[{symbol,lastPrice,...}] } }
    if (/\/v5\/market\/tickers$/.test(p)) {
      return JSON.stringify({ retCode: 0, retMsg: 'OK', result: { category: q.get('category') || 'linear', list: [{ symbol: sym, lastPrice: base.toPrecision(10), price24hPcnt: (Math.sin(hashNum(sym) * 6) * 0.05).toFixed(4), turnover24h: (base * 1e6).toPrecision(10), volume24h: '1000000', openInterest: '500000', fundingRate: '0.0001' }] } });
    }
    // Binance futures open-interest history: [{ symbol, sumOpenInterest, sumOpenInterestValue, timestamp }]
    if (/openInterestHist$/.test(p)) {
      return JSON.stringify(bars.map(b => ({ symbol: sym, sumOpenInterest: (b.vol * 100).toPrecision(10), sumOpenInterestValue: (b.vol * 100 * b.c).toPrecision(10), timestamp: b.t })));
    }
    return null; // an endpoint we do not synthesize falls through to the empty-array success below
  };

  globalThis.fetch = async function qaInterceptingFetch(input, init) {
    let url = '';
    try {
      url = typeof input === 'string' ? input : (input && input.url) || String(input);
    } catch { /* fall through to a live call rather than guessing */ }

    let host = '';
    try { host = new URL(url).host; } catch { host = ''; }

    if (host) byHost.set(host, (byHost.get(host) ?? 0) + 1);

    /* Report as we go, not only at exit.
     *
     * The first full-suite run reported 14 outbound calls, all to
     * telemetry.nextjs.org, and zero to Binance - which contradicted a direct
     * test where /api/funding alone made three. The tally was not wrong; it was
     * never printed. `process.on('exit')` does not run when Playwright tears the
     * webServer down, so the long-lived server's totals died with it and the
     * only numbers that survived came from short-lived build processes.
     *
     * A measurement that is only emitted on a graceful exit is not a
     * measurement of anything that gets killed. */
    if (MODE === 'count' && host) {
      const n = byHost.get(host);
      if (n === 1 || n % 25 === 0) log(`[intercept] ${host}: ${n}`);
    }

    if (host) flushTally();

    /* count mode never stubs - it only observes. A measurement that alters the
     * thing being measured would answer a different question than #114 asks. */
    /* FAIL CLOSED FOR PAID AI, AHEAD OF THE MODE CHECK AND AHEAD OF `STUBBED`.
     *
     * This host is NOT in `STUBBED` on purpose, because `STUBBED` serves an empty-shaped SUCCESS and
     * that is the wrong answer for an AI call: a spec asserting "no verdict was shown" would pass on
     * a fabricated empty success, for the wrong reason. An error is the honest shape - the route's own
     * failure handling is what should run.
     *
     * AND IT APPLIES IN `count` MODE TOO, which is the one deliberate exception to that mode's rule
     * that it "never stubs - it only observes". Observing costs money here: every sample is a billed
     * xAI call. A measurement that bills per sample is not worth the fidelity, so this host is blocked
     * in both modes and the log says which host and why.
     *
     * WHAT THIS IS NOT. It is not the protection that makes CI safe today - that is the absence of
     * `GROK_API_KEY` in `ci.yml`, which makes `/api/macro-context` and `/api/dry-powder` return 50x at
     * their `!GROK_KEY` guard before they reserve or spend (measured 2026-11-08). This is the second
     * layer, so that adding an AI key to CI stops being a one-line change that silently starts
     * billing. Before this, the only thing between a CI key and a bill was 16 specs that happen not to
     * install the browser fence. */
    /* Matched on the DOMAIN, not one hostname, so a regional or versioned endpoint under x.ai is
       covered too. Only x.ai - this project's vendor - and no hosts added on a guess. */
    if (/(^|\.)x\.ai$/.test(host ?? '')) {
      served++;
      byHost.set(host, (byHost.get(host) ?? 0) + 1);
      log(`[intercept] FAIL-CLOSED ${host} - paid AI, blocked in ${MODE} mode (see the comment in this file)`);
      return new Response(JSON.stringify({ error: 'blocked by qa/server-intercept.mjs: paid AI egress is not allowed in tests' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (MODE === 'count' || !host || !STUBBED.includes(host)) {
      passed++;
      return realFetch(input, init);
    }

    served++;

    /* SYNTHETIC BODY FIRST (option iii). If this URL is a venue endpoint we generate - klines,
       tickers, open-interest - return deterministic data in that venue's own shape so the real
       route parses real-looking candles with zero egress. An endpoint we do not synthesize falls
       through to the empty-array success below, which is still the right answer for the handlers
       that expect `[]` and the honest "a handler that crashes on it is a finding" case. */
    const synth = synthUpstream(url);
    if (synth !== null) {
      log(`[intercept] stubbed ${host} (${served} stubbed / ${passed} passed through) [synthetic ${new URL(url).pathname}]`);
      return new Response(synth, { status: 200, headers: { 'content-type': 'application/json' } });
    }

    log(`[intercept] stubbed ${host} (${served} stubbed / ${passed} passed through) [empty]`);
    return new Response('[]', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const report = (why) => {
    const rows = [...byHost.entries()].sort((a, b) => b[1] - a[1]);
    const total = rows.reduce((n, [, c]) => n + c, 0);
    log(`[intercept] TOTAL outbound: ${total} (${served} stubbed, ${passed} passed through) [${why}]`);
    for (const [h, c] of rows) log(`[intercept]   ${String(c).padStart(5)}  ${h}`);
  };

  /* THREE WAYS OUT, because a measurement that only survives a graceful exit is
   * not a measurement of anything that gets killed.
   *
   * Dev hit this on #201: they killed the server, the tally never printed, and
   * they were left inferring the total from the `n % 25` progress lines above -
   * enough to prove "fewer than 25", not enough to distinguish 1 from 24. My
   * bug, reported by the person it cost time.
   *
   *   exit             - graceful, and the only one that fired before
   *   SIGTERM/SIGINT   - how Playwright and Ctrl-C actually stop this process
   *   the tally file   - the only thing that survives SIGKILL, which no handler
   *                      can intercept by definition
   *
   * The signal handlers re-raise rather than calling process.exit() with a made
   * up code: re-raising after removing the handler lets the process die of the
   * signal it was sent, so the exit status still tells the truth about how it
   * ended. */
  process.on('exit', () => report('exit'));

  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(sig, () => {
      report(sig);
      flushTally();
      process.removeAllListeners(sig);
      process.kill(process.pid, sig);
    });
  }

  log(`[intercept] tally file: ${TALLY_PATH} (survives SIGKILL)`);

  log(MODE === 'count'
    ? '[intercept] COUNT MODE - every call passes through untouched, tallied by host'
    : `[intercept] STUB MODE - ${STUBBED.length} hosts stubbed, everything else passes through`);
}
