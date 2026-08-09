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
    if (MODE === 'count' || !host || !STUBBED.includes(host)) {
      passed++;
      return realFetch(input, init);
    }

    served++;
    log(`[intercept] stubbed ${host} (${served} stubbed / ${passed} passed through)`);

    /* Deliberately an EMPTY-SHAPED success rather than recorded payloads.
     *
     * This module's job is to prove the seam works and to stop live egress. The
     * recorded payloads already exist in qa/fixtures/ and are wired through
     * `_fixtures.ts` for the browser side; pointing this at them is the next
     * step, not this one.
     *
     * An empty array is the shape most of these handlers expect, and a handler
     * that CRASHES on it is a finding rather than a problem with this file -
     * `market-scenarios.spec.ts` already asserts an upstream 500 must not blank
     * the page. */
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
