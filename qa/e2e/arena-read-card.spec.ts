import { test, expect, type Page, type Route } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';

/* The AI Read card's VISIBILITY state machine (#278, #279).
 *
 * The owner reported this one directly, twice, and both halves were about the
 * card being on screen at the wrong moment rather than about its contents:
 *
 *   #278  "i tried to hit quick research while loading" - the old verdict stayed
 *         up under an "Updated just now" label while its replacement computed.
 *         A call that is about to change, presented as current.
 *
 *   #279  "i close the old research result now after the new quick research
 *         load both are gone" - dismissing a result and then running another
 *         left the user with nothing. The read completed, spent quota, and
 *         produced no visible output.
 *
 * WHY THIS IS A SPEC AND NOT A MANUAL CHECK. Both bugs are transitions, not
 * states. Any single screenshot of either one looks correct - the card is
 * legitimately hidden while loading and legitimately hidden after a dismiss. The
 * defect only exists in the SEQUENCE, which is exactly what a human tester
 * stops re-checking after the second release.
 *
 * WHY IT ASSERTS VISIBILITY AND NOT WORDS. #260 renames the verdict vocabulary
 * from LONG/SHORT to BULLISH/BEARISH, and the words themselves are database
 * rows that an owner can edit at any time. A spec keyed to them would fail on a
 * copy change and pass on a broken state machine. `FLAT` is used throughout
 * below precisely because it is the one value that survives that rename.
 *
 * THE CONTROL IS LOAD-BEARING. "the card is visible" is asserted four times
 * here, and a build where the card ALWAYS renders would satisfy every one of
 * them. `stays hidden until a new read` is what makes the others mean something.
 */

const CARD    = '.arena-signal-card';
const DISMISS = 'button.av-dismiss';
const QUICK   = 'button.arena-quick-btn';
const LOADING = '.arena-loading';
const ERROR   = '.arena-err';

/** One synthetic candle series. The read fetches 300 before it calls Grok; the
 *  values are never asserted, they only have to parse. */
function klines(count = 300): (string | number)[][] {
  const start = 1_700_000_000_000;
  return Array.from({ length: count }, (_, i) => {
    const o = 60_000 + i;
    return [
      start + i * 900_000, `${o}`, `${o + 50}`, `${o - 50}`, `${o + 10}`, '100',
      start + i * 900_000 + 899_999, '6000000', 500, '50', '3000000', '0',
    ];
  });
}

/**
 * How far in the past the fixture claims its result was produced.
 *
 * NOT cosmetic. The page serves a fresh cached result WITHOUT calling Grok at
 * all - `getCacheTTL()` is 2 minutes between 12:00 and 20:00 UTC and 15 minutes
 * otherwise - so a second click seconds after the first reaches nothing. The
 * first version of this file fell into exactly that: the failure-path test
 * clicked, got no error banner, and reported "a failed read must say so" as a
 * defect when the app had never been asked to fail.
 *
 * 20 minutes clears both TTL windows and the 30-second `force` threshold, so
 * every click below is a real read on any host at any hour. It stays well inside
 * CACHE_MAX_AGE_MS (4h), past which the card would refuse to render at all.
 *
 * The instrument check in the failure test stays regardless - a constant that
 * happens to work today is not the same as proving the request went out.
 */
const STALE_MS = 20 * 60_000;

type GrokControl = {
  /** Confidence the next POST will answer with. Changing it between reads is how
   *  a NEW result is told apart from the old one being re-shown. */
  confidence: number;
  /** When true the next POST answers 500, exercising the failure path. */
  fail: boolean;
  /** Held open to observe the in-flight state; resolve to let the read finish. */
  gate: Promise<void> | null;
  /** POSTs served so far - proves a read actually ran rather than a cache hit. */
  posts: number;
};

/**
 * Intercept both halves of `/api/grok`: the GET that reports remaining quota
 * (without it the Quick button renders disabled and every click below is a
 * no-op) and the POST that returns the analysis.
 *
 * Fixturing this also removes the xAI key from the dependency list, so the spec
 * measures the same thing on a host that has no key at all.
 */
async function installGrok(page: Page, control: GrokControl) {
  await page.route('**/api/market/klines**', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(klines()) }));

  await page.route('**/api/grok**', async (r: Route) => {
    if (r.request().method() === 'GET') {
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          usage: { quick_used: 0, quick_limit: 50, deep_used: 0, deep_limit: 20 },
        }),
      });
    }

    control.posts += 1;
    if (control.gate) await control.gate;

    if (control.fail) {
      return r.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'fixture: upstream refused' }),
      });
    }

    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        usage: { quick_used: 1, quick_limit: 50, deep_used: 0, deep_limit: 20 },
        result: {
          /* FLAT survives the #260 rename in both vocabularies. */
          signal: 'FLAT', confidence: control.confidence,
          entryLow: null, entryHigh: null, tp: null, sl: null,
          levels: [], chartAnalysis: 'fixture', patterns: [],
          reasoning: `fixture reasoning ${control.confidence}`,
          catalysts: [], waitFor: 'fixture wait', bias: 'NEUTRAL',
          raidSetup: null, raidTarget: null, raidTrigger: null,
          analyzedAt: Date.now() - STALE_MS, tf: '15m', session: 'fixture',
        },
      }),
    });
  });
}

test.describe('AI Read card visibility', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  /* Both triggers redirect to /login when signed out, so every assertion here
     needs a real session. Account 'a' - this reads state and spends no quota that
     matters, since the POST never reaches xAI. */
  let control: GrokControl;

  test.beforeEach(() => {
    control = { confidence: 41, fail: false, gate: null, posts: 0 };
  });

  test('a completed read shows the card, and dismiss hides it', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      await installGrok(page, control);
      await gotoSignedIn(page, '/arena');

      await expect(page.locator(CARD), 'no read has run yet, so no card').toHaveCount(0);

      await page.locator(QUICK).click();
      await expect(page.locator(CARD)).toBeVisible({ timeout: 60_000 });
      await expect(page.locator(CARD)).toContainText('41');

      await page.locator(DISMISS).click();
      await expect(page.locator(CARD), 'dismiss must hide the card').toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test('CONTROL: once dismissed the card stays hidden until a new read', async ({ browser }) => {
    /* Without this, a build whose card never hides would pass every other test
       in this file. It is the reason the four "is visible" assertions mean
       anything at all. */
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      await installGrok(page, control);
      await gotoSignedIn(page, '/arena');

      await page.locator(QUICK).click();
      await expect(page.locator(CARD)).toBeVisible({ timeout: 60_000 });
      await page.locator(DISMISS).click();
      await expect(page.locator(CARD)).toHaveCount(0);

      const postsAtDismiss = control.posts;
      await page.waitForTimeout(6_000);

      await expect(page.locator(CARD),
        'the card came back on its own - dismissal is not sticky').toHaveCount(0);
      expect(control.posts,
        'no read was triggered, so this really was the idle case').toBe(postsAtDismiss);
    } finally {
      await ctx.close();
    }
  });

  test('#279: a new read after a dismiss brings the card back, with the NEW result', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      await installGrok(page, control);
      await gotoSignedIn(page, '/arena');

      await page.locator(QUICK).click();
      await expect(page.locator(CARD)).toContainText('41', { timeout: 60_000 });

      await page.locator(DISMISS).click();
      await expect(page.locator(CARD)).toHaveCount(0);

      /* A different confidence, so a card showing 41 again would mean the OLD
         result was re-revealed rather than the new one rendered - a different
         defect that "the card is visible" alone cannot distinguish. */
      control.confidence = 77;
      await page.locator(QUICK).click();

      await expect(page.locator(CARD),
        'the read completed and produced no visible output - #279').toBeVisible({ timeout: 60_000 });
      await expect(page.locator(CARD)).toContainText('77');
    } finally {
      await ctx.close();
    }
  });

  test('#278: the card is hidden while a read is in flight, not left stale', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      await installGrok(page, control);
      await gotoSignedIn(page, '/arena');

      await page.locator(QUICK).click();
      await expect(page.locator(CARD)).toContainText('41', { timeout: 60_000 });

      /* Hold the second read open so the in-flight state can be observed at all.
         Without the gate this is a race the test loses on a fast host, and a
         test that cannot fail is worse than no test. */
      let release!: () => void;
      control.gate = new Promise<void>(res => { release = res; });
      control.confidence = 88;

      await page.locator(QUICK).click();

      await expect(page.locator(LOADING),
        'the loading indicator should replace the card').toBeVisible({ timeout: 30_000 });
      await expect(page.locator(CARD),
        'the previous verdict is still on screen while its replacement computes - #278')
        .toHaveCount(0);

      release();
      await expect(page.locator(CARD)).toContainText('88', { timeout: 60_000 });
    } finally {
      await ctx.close();
    }
  });

  test('a FAILED read restores the previous card rather than eating it', async ({ browser }) => {
    /* The un-dismiss lives in `finally`, not the success branch. On failure there
       is no new result, so leaving the coin dismissed would cost the user the
       result they already had ON TOP of the one that did not arrive. */
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      await installGrok(page, control);
      await gotoSignedIn(page, '/arena');

      await page.locator(QUICK).click();
      await expect(page.locator(CARD)).toContainText('41', { timeout: 60_000 });

      await page.locator(DISMISS).click();
      await expect(page.locator(CARD)).toHaveCount(0);

      const postsBefore = control.posts;
      control.fail = true;
      await page.locator(QUICK).click();

      /* Prove the click reached the API before reading anything into the result.
         The page serves a fresh cached result without calling Grok at all, so a
         click that hits the cache produces no error banner and no request - and
         "no error banner" would read as a defect when nothing was ever asked to
         fail. Same shape as the six routes that reported 0 exchange calls
         because they never loaded. */
      await expect.poll(() => control.posts, {
        message: 'the click never reached /api/grok - served from cache, so this test measured nothing',
        timeout: 30_000,
      }).toBeGreaterThan(postsBefore);

      await expect(page.locator(ERROR),
        'a failed read must say so').toBeVisible({ timeout: 60_000 });
      await expect(page.locator(CARD),
        'the failure swallowed the result the user already had').toBeVisible();
      await expect(page.locator(CARD)).toContainText('41');
    } finally {
      await ctx.close();
    }
  });
});
