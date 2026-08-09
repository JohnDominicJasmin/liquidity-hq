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
 */
'use strict';

const ENABLED = process.env.QA_INTERCEPT_UPSTREAM === '1';

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

  globalThis.fetch = async function qaInterceptingFetch(input, init) {
    let url = '';
    try {
      url = typeof input === 'string' ? input : (input && input.url) || String(input);
    } catch { /* fall through to a live call rather than guessing */ }

    let host = '';
    try { host = new URL(url).host; } catch { host = ''; }

    if (!host || !STUBBED.includes(host)) {
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

  process.on('exit', () => {
    log(`[intercept] final: ${served} stubbed, ${passed} passed through`);
  });

  log(`[intercept] ACTIVE - ${STUBBED.length} hosts stubbed, everything else passes through`);
}
