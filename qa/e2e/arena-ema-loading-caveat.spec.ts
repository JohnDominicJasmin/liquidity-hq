import { test, expect, type Page, type Route } from '@playwright/test';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON } from './_auth';

/* #1347 item 5 (#1368, fix by Dev Team, follow-up 91f388fd) - while the EMA
 * hook is LOADING (a coin or timeframe switch it has not finished fetching for),
 * `emaSignalRef` deliberately keeps the PREVIOUS selection's technicals so the
 * panel does not flash "no data". Nothing told the model so: the QUICK/DEEP
 * prompt asserted the old coin/timeframe's EMA line as present-tense fact. The
 * fix prefixes that line with
 *
 *   "[Still loading EMA technicals for the current coin/timeframe - the line
 *    below is the PREVIOUS selection's, not this one's] "
 *
 * while `emaSignal.loading` is true.
 *
 * WHY THIS NEEDS A REAL RUN. QA's review found the first version read the flag
 * through a memoised callback whose dependency array did not refresh it, so the
 * caveat was present only when an unrelated market tick had recreated the
 * callback: Dev observed it in 1 of 8 reads made while EMA was provably loading.
 * The follow-up passes the flag in from the click handler. The failure was
 * intermittent BY CONSTRUCTION (ticks refresh the closure most of the time), so
 * ONE clean read proves nothing - this file asserts the caveat on EVERY read
 * across several timeframes, not on the first.
 *
 * BOTH DIRECTIONS, because a caveat that is missing and a caveat that is
 * wrongly present are different failures:
 *   A. loading -> the prompt's EMA line MUST carry the caveat, every time.
 *   B. resolved -> the prompt MUST NOT carry it, including the case where the
 *      signal resolved a moment ago after having been held (the direction where
 *      a stale `true` would surface).
 *
 * HOW LOADING IS MADE, AND HOW IT IS PROVED:
 *   - The EMA hook's klines requests are the ones carrying `closed=1`
 *     (lib/useEMAStrategy.ts:97); readMarket's own candle fetch does not. Those
 *     are HELD (never answered) while `hold` is on, so the hook stays loading.
 *   - The timeframe must be one the page has NOT visited. A revisited timeframe
 *     is served from the module-level kline cache and never enters the loading
 *     state (useEMAStrategy.ts:787-795) - Dev's two logged "misses" on 15m were
 *     exactly that, the correct answer for a state that was not loading. So each
 *     timeframe is used ONCE, and the page's first-render timeframe (15m) never.
 *   - The precondition is asserted, not assumed: the hook's request was held AND
 *     the EMA panel's "Loading…" marker is attached. Without both the read was
 *     not made while loading and the assertion below would measure nothing.
 *
 * NO AI CREDITS: /api/grok is stubbed and the prompt is read from its POST body.
 * The caveat is hard-coded English inside a prompt sent to the model, not a UI
 * label, so it is matched as written.
 *
 * READ A GREEN RUN FOR WHAT IT IS. This spec has only ever been seen to PASS,
 * on the FIXED build (deployed qa at 3f58a2d). It has never been run against the
 * code before 91f388fd, so nobody has watched it FAIL on the defect it guards.
 * Its power to catch that defect rests on Dev's measurement (the caveat present in
 * 1 of 8 reads while EMA was provably loading) and on the by-construction argument
 * above, not on a red run of its own - by qa/README.md's own habit, that makes it a
 * promise until it is proven once against a pre-fix build. Do that when the machine
 * has room; until then a pass here means the fix behaves, not that this spec would
 * have caught its absence.
 */

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

const CAVEAT = '[Still loading EMA technicals';

async function resetStrategySelection(page: Page) {
  await page.evaluate(async () => {
    const raw = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    const token = raw ? JSON.parse(localStorage.getItem(raw)!).access_token : null;
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ strategy_selection: [], knownAsOf: { strategy_selection: new Date().toISOString() } }),
    });
    localStorage.removeItem('lhq_settings_v1');
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('lhq_settings_unconfirmed_v1')) localStorage.removeItem(k);
    }
  });
}

const fakeCandles = () => JSON.stringify(
  Array.from({ length: 300 }, (_, i) => [Date.now() - (300 - i) * 60_000, 100, 101, 99, 100.5, 10]),
);

async function arrange(browser: import('@playwright/test').Browser) {
  const ctx = await signedInContext(browser, 'a');
  const page = await ctx.newPage();
  const held: Route[] = [];
  const prompts: string[] = [];
  const state = { hold: false };

  await page.route('**/api/grok', async route => {
    if (route.request().method() !== 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ usage: null }) });
    }
    const asked = route.request().postDataJSON() as { prompt?: string; tf?: string; session?: string };
    prompts.push(asked.prompt ?? '');
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        result: {
          signal: 'FLAT', confidence: 50, levels: [], patterns: [], catalysts: [], chartAnalysis: 'stub', reasoning: 'stub',
          waitFor: null, bias: null, raidSetup: null, raidTarget: null, raidTrigger: null,
          analyzedAt: Date.now(), tf: asked.tf ?? '15m', session: asked.session ?? 'London',
        },
        usage: null,
      }),
    });
  });
  await page.route('**/api/market/klines**', route => {
    // The EMA hook's requests (closed=1) are held while `hold` is on; every
    // other klines request, readMarket's included, is answered at once.
    if (state.hold && route.request().url().includes('closed=1')) { held.push(route); return; }
    return route.fulfill({ status: 200, contentType: 'application/json', body: fakeCandles() });
  });

  await gotoSignedIn(page, '/about');
  await resetStrategySelection(page);
  await page.goto('/arena');

  const quick = page.getByRole('button', { name: 'QUICK', exact: true });
  await expect(quick).toBeVisible({ timeout: 30_000 });
  await expect(quick).toBeEnabled({ timeout: 30_000 });
  const loadingMarker = page.locator('.sr-only', { hasText: 'Loading…' });
  // Let the first-render timeframe's EMA signal settle so we start from a
  // known, resolved state.
  await expect(loadingMarker, 'the EMA panel never finished its first load, so the starting state is unknown')
    .toHaveCount(0, { timeout: 30_000 });

  const tfButton = (tf: string) => page.getByRole('button', { name: tf, exact: true }).first();
  const releaseHeld = async () => {
    const routes = held.splice(0, held.length);
    await Promise.allSettled(routes.map(r => r.fulfill({ status: 200, contentType: 'application/json', body: fakeCandles() })));
  };
  const read = async (): Promise<string> => {
    const before = prompts.length;
    await expect(quick).toBeEnabled({ timeout: 30_000 });
    await quick.click();
    await expect.poll(() => prompts.length, { message: 'QUICK never reached the stubbed /api/grok', timeout: 30_000 }).toBeGreaterThan(before);
    return prompts[prompts.length - 1];
  };
  return { ctx, page, held, state, quick, loadingMarker, tfButton, releaseHeld, read };
}

test.describe('The QUICK prompt labels the EMA line as stale while EMA is loading, and only then (#1347 item 5)', () => {
  test('A. loading: EVERY read made while EMA is provably loading carries the caveat', async ({ browser }) => {
    const { ctx, held, state, loadingMarker, tfButton, read } = await arrange(browser);
    try {
      state.hold = true;
      const results: string[] = [];
      for (const tf of ['1m', '5m', '30m']) {
        const heldBefore = held.length;
        await tfButton(tf).click();
        await expect.poll(() => held.length, {
          message: `the EMA hook never issued its klines request after switching to ${tf} - the page did not change timeframe`,
          timeout: 15_000,
        }).toBeGreaterThan(heldBefore);
        await expect(loadingMarker.first(),
          `the EMA panel is not showing "Loading…" after switching to ${tf} - this read would not be made while loading, so it measures nothing ` +
          '(a revisited timeframe is served from cache and never loads)').toBeAttached();

        const prompt = await read();
        results.push(`${tf}: ${prompt.includes(CAVEAT) ? 'caveat' : 'NO CAVEAT'}`);
      }
      const misses = results.filter(r => r.endsWith('NO CAVEAT'));
      expect(misses, `reads made while EMA was provably loading that did NOT carry the caveat - the missing-label direction, the defect ` +
        `QA found in the first version (${results.join(', ')}). Intermittent by design: ONE pass would not have caught it.`).toHaveLength(0);
    } finally {
      await ctx.close();
    }
  });

  test('B. resolved: a read made after EMA has resolved does NOT carry the caveat, including right after a held load is released', async ({ browser }) => {
    const { ctx, held, state, loadingMarker, tfButton, releaseHeld, read } = await arrange(browser);
    try {
      // Hold a switch, prove it is loading, then RELEASE it and wait for the
      // panel to finish - the state a stale `true` would survive into.
      state.hold = true;
      const heldBefore = held.length;
      await tfButton('2h').click();
      await expect.poll(() => held.length, { message: 'the EMA hook never issued its klines request after switching to 2h', timeout: 15_000 })
        .toBeGreaterThan(heldBefore);
      await expect(loadingMarker.first(), 'not loading after the switch to 2h - the release below would prove nothing').toBeAttached();

      state.hold = false;
      await releaseHeld();
      await expect(loadingMarker, 'the EMA panel never resolved after its held request was released').toHaveCount(0, { timeout: 30_000 });

      const afterRelease = await read();
      expect(afterRelease.includes(CAVEAT),
        'a read made AFTER the held load resolved still carried the "still loading" caveat - the false-label direction (a stale `true`)').toBe(false);

      // And a plain unheld switch to another new timeframe, resolved before the click.
      await tfButton('4h').click();
      await expect(loadingMarker, 'the EMA panel never resolved after switching to 4h').toHaveCount(0, { timeout: 30_000 });
      const plain = await read();
      expect(plain.includes(CAVEAT), 'a read made after an ordinary, fully resolved switch carried the caveat').toBe(false);
    } finally {
      await ctx.close();
    }
  });
});
