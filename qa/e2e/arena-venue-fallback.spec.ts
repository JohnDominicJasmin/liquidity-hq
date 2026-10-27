import { test, expect } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence, assertNoUnstubbedPaidAi } from './_no-paid-ai';

/* #1767 / #1263: DOES THE ARENA SIGNAL'S BINANCE FALLBACK ACTUALLY RUN?
 *
 * Owner-reported: "Signal unavailable right now" under the Arena chart, intermittently. The Binance fallback
 * that was supposed to prevent it had never executed - `if (bySym) return fetchBybitKlines(...)` returns on
 * success and THROWS on failure, so the Binance line below it ran only for a coin Bybit does not list, which
 * is the one case where it is not a fallback. 44 of 49 coins are on both venues.
 *
 * ── WHY THIS HAS TO INJECT THE FAILURE ─────────────────────────────────────────────────────────────────────
 *
 * Loading /arena while Bybit is healthy exercises nothing: the primary answers and the fallback is never
 * reached, so the page looks identical before and after the fix. The only way to see the repair is to make
 * the primary fail. So the Bybit klines request is forced to 502 and Binance is left alone.
 *
 * Measured before writing this, so a failure here reads as a product defect rather than an egress problem:
 * `/api/market/klines?source=binance-futures` answers HTTP 200 from BOTH the production and the qa egress
 * (BTCUSDT, 15m and 1h). Binance futures 502/418 from this address is what #1059 recorded; it does not
 * reproduce today.
 *
 * ── THE THREE CASES, AND THE SECOND IS THE ONE THAT KEEPS THIS HONEST ──────────────────────────────────────
 *
 *   1. BOTH-VENUE COIN, Bybit down    -> a signal still renders, and the fallback says so in the console.
 *   2. BOTH VENUES DOWN               -> the failure message MUST still appear. A fix that made a real
 *                                        outage look like a working signal would be worse than the bug.
 *   3. BYBIT-ONLY COIN, Bybit down    -> the failure message, NOT a signal, and ZERO fallback log lines.
 *                                        The log count is what separates this from case 2: both end in the
 *                                        failure message, but only case 2 had a second venue to try. Without
 *                                        it, case 3 passes on any path that fails for any reason.
 *
 * WHAT CASE 3 DOES *NOT* PROVE, SINCE AN EARLIER VERSION OF THIS COMMENT CLAIMED IT DID. It read "a Binance
 * price for a 1000x-denominated symbol would be wrong by 1000x rather than merely absent", and used `hype`.
 * `BYBIT_SYMS.hype` is `HYPEUSDT` - not a 1000x symbol at all, so the cell proved the Bybit-only path and
 * nothing whatever about the price factor. It is `pepe` now, which is `1000PEPEUSDT` and so carries both
 * properties at once.
 *
 * The honest footnote is that there is no live 1000x risk to catch EITHER WAY: `BINANCE_SYMS` has no `pepe`
 * or `bonk` entry (lib/coins.ts - "Binance uses 1000x denomination - kept Bybit-only to avoid display
 * confusion"), so for the only two 1000x coins there is no second attempt for a wrong factor to apply to.
 * `bybitSymbolPriceFactor` therefore stays unexercised by this spec BY DESIGN. That makes case 3 a
 * regression guard for whoever adds `pepe: '1000PEPEUSDT'` to the Binance map - a useful thing to be, and a
 * different claim from the one it used to make.
 *
 * usage: E2E_BASE_URL=https://liquidity-hq-qa.onrender.com npx playwright test arena-venue-fallback --project=desktop */

const FAILURE_TEXT = 'Signal unavailable right now';   // EMA_SIGNAL_FAILED, rendered at components/EMASignal.tsx:409
const FALLBACK_LOG = '[useEMAStrategy]';               // emitted at lib/useEMAStrategy.ts:188 on a venue fallback

/** Force one or both venues to fail on the klines route the hook calls. */
async function breakVenues(page: import('@playwright/test').Page, venues: Array<'bybit' | 'binance-futures'>) {
  await page.route('**/api/market/klines**', async (route) => {
    const src = new URL(route.request().url()).searchParams.get('source') ?? '';
    if (venues.some((v) => src.includes(v))) {
      /* 502 rather than an abort: the hook's own retry treats a 5xx as a venue failure, which is the
         condition #1080 recorded live. An aborted request is a different failure mode. */
      await route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"forced by QA"}' });
      return;
    }
    try { await route.continue(); } catch { /* teardown race */ }
  });
}

async function arenaSignalState(page: import('@playwright/test').Page) {
  /* Read the card's own text rather than a screenshot: the failure state and a rendered signal are different
     strings in the same element, which is what makes this assertable at all. */
  return page.evaluate((failureText) => {
    const body = document.body.textContent ?? '';
    return { showsFailure: body.includes(failureText), bodyLength: body.length };
  }, FAILURE_TEXT);
}

for (const scenario of [
  { name: '1. both-venue coin with Bybit down: the fallback runs and a signal renders', coin: 'btc', broken: ['bybit'] as const, expectFailure: false, expectLogs: 'some' as const },
  { name: '2. both venues down: the failure message must STILL appear', coin: 'btc', broken: ['bybit', 'binance-futures'] as const, expectFailure: true, expectLogs: 'some' as const },
  /* pepe, not hype: `1000PEPEUSDT` is Bybit-only AND 1000x-denominated, so one cell carries both. See the
     header - the 1000x half is a guard for a future Binance entry, not a measurement of today's code. */
  { name: '3. Bybit-only coin with Bybit down: the failure message and NO fallback attempt', coin: 'pepe', broken: ['bybit'] as const, expectFailure: true, expectLogs: 'none' as const },
]) {
  test(`#1767 ${scenario.name}`, async ({ browser }) => {
    test.skip(test.info().project.name !== 'desktop', 'sets its own viewport');
    test.skip(!AUTH_READY, AUTH_SKIP_REASON);

    const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const logs: string[] = [];
    page.on('console', (m) => { const t = m.text(); if (t.includes(FALLBACK_LOG)) logs.push(t); });

    await installPaidAiFence(page);
    /* After the fence, so these win: /arena polls the paid macro routes on load (#1632) and the fence is
       right to abort an unstubbed one. Stub rather than remove the fence. */
    for (const seg of ['macro-context', 'dry-powder', 'onchain']) {
      await page.route(`**/api/${seg}**`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    }
    await breakVenues(page, [...scenario.broken]);

    try {
      await gotoSignedIn(page, `/arena?coin=${scenario.coin}&tf=15m`);
      /* The hook retries before giving up, so the card's final state is not immediate. */
      await page.waitForTimeout(12_000);
      const state = await arenaSignalState(page);

      // eslint-disable-next-line no-console
      console.log(`#1767 ${scenario.coin} broken=[${scenario.broken.join(',')}] `
        + `showsFailure=${state.showsFailure} (expected ${scenario.expectFailure}) `
        + `fallbackLogs=${logs.length}${logs.length ? ' | ' + logs[0].slice(0, 120) : ''}`);

      if (scenario.expectFailure) {
        expect(state.showsFailure,
          `with ${scenario.broken.join(' and ')} down the card must still say "${FAILURE_TEXT}" - a fix that `
          + 'makes a real outage look like a working signal is worse than the bug it replaced')
          .toBe(true);

        /* THE DISCRIMINATOR. Cases 2 and 3 both end on the failure message, so the message alone cannot say
           which path produced it. The log count can: case 2 had a second venue and announced the handover,
           case 3 had none and must announce nothing. Without this, case 3 would pass on a coin that is not
           Bybit-only, on a card that failed for an unrelated reason, or on a break that took too widely. */
        if (scenario.expectLogs === 'none') {
          expect(logs, `${scenario.coin} has no Binance symbol, so there is nothing to fall back to and no `
            + '"falling back to" line may be logged - one here means the coin is not Bybit-only, which is the '
            + 'entire premise of this cell')
            .toEqual([]);
        } else {
          expect(logs.length, 'both venues were broken, so the handover to the second must still have been '
            + 'announced before it failed too - no line means the Bybit break did not take')
            .toBeGreaterThan(0);
        }
      } else {
        expect(state.showsFailure,
          `with only Bybit down a signal must render: the Binance fallback should have answered. `
          + `"${FAILURE_TEXT}" on screen means the fallback still does not run`)
          .toBe(false);
        /* And it must have fallen back rather than merely succeeded - if the Bybit break did not take, the
           primary answered and this cell proves nothing. The console line is the evidence that the second
           venue was used. */
        expect(logs.length,
          'no [useEMAStrategy] fallback line was logged, so either the Bybit break did not take or the '
          + 'fallback did not run - in both cases this cell measured nothing')
          .toBeGreaterThan(0);
      }
    } finally {
      assertNoUnstubbedPaidAi(page, `#1767 ${scenario.coin}`);
      await ctx.close();
    }
  });
}
