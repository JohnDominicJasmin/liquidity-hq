import { test, expect, type Page } from '@playwright/test';
import { marketDataUnavailable } from './_shared';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';

/* Does the 10Y REAL YIELD reach the Confluence card? (#60, #311, dev's PR #319)
 *
 * `__tests__/realYield.test.mts` pins `computeRealYield` - a pure function over
 * FRED rows. Right place for the logic, different claim from this one: a
 * correct function still shows nothing if the provider drops the field or the
 * card never renders the line. Same split as macroRiskStale vs econ-staleness.
 *
 * FOUR STATES, AND TWO OF THEM LOOK IDENTICAL ON PURPOSE (lib/confluence.ts:166):
 *
 *     tightening   line appears      a rising real yield is a headwind
 *     unknown      line appears      "cannot check the rates backdrop"
 *     easing       SILENT            a tailwind is not a risk
 *     neutral      SILENT            a quiet market needs no banner
 *
 * The `easing` case is the one a naive test calls a bug. It is past the same
 * 10bp threshold as `tightening`, and it deliberately renders nothing, because
 * the macro row is the card's RISK band - amber and red. Dev's reasoning is
 * that putting good news in a warning box teaches people to read the colour as
 * decoration. Pinning it here means nobody "fixes" that later by accident.
 *
 * THE PAIR THAT MATTERS IS `neutral` vs `unknown`. Both mean the card has no
 * warning to give, and they must NOT look the same: one is "checked, nothing
 * happening", the other is "could not check". That distinction has cost this
 * project more than any other single thing, and it is asserted directly below
 * rather than left to two separate tests that each pass alone.
 *
 * WHY IT DRIVES /api/macro RATHER THAN FRED. `fetchFredRows` runs SERVER-side
 * inside the route handler, so `page.route` cannot see it - the browser never
 * makes that request. `/api/macro` is the boundary the browser does cross.
 *
 * WHY IT OVERRIDES ONE FIELD INSTEAD OF SERVING A WHOLE FIXTURE. Real oil, DXY,
 * SPX, gold and USD/JPY keep flowing, so the rest of the card behaves normally
 * and this file cannot accidentally assert a property of its own fixture. It
 * also means the yield line is the only thing under test - which is why the
 * band colour is RECORDED rather than asserted (see the tightening case).
 *
 * IT MUST RUN SIGNED IN AS PRO. The Confluence card is Pro-gated; signed out,
 * every "no line" assertion below passes because the whole card is absent.
 * `cardText` carries that positive control on every single test.
 */

const MACRO_ROUTE = '**/api/macro**';

/** Any rendering of the yield line, in any of its four wordings. */
const YIELD_LINE = /10Y real yield/i;

type Signal = 'tightening' | 'easing' | 'neutral' | 'unknown';

/**
 * Build a RealYield payload (lib/realYield.ts:49) for one signal.
 *
 * `note` is written here exactly as the lib would write it. That is deliberate:
 * if dev changes the wording, these fixtures keep the OLD wording and the test
 * still passes on `/10Y real yield/` - so this file pins that a line appears,
 * not that a particular sentence appears. Wording is dev's to change.
 */
function realYield(signal: Signal) {
  const day = 24 * 3_600_000;
  if (signal === 'unknown') {
    return {
      value: null, changeBp: null, asOf: null, stale: true, signal,
      note: '10Y real yield unavailable - cannot check the rates backdrop',
    };
  }
  const changeBp = signal === 'tightening' ? 15 : signal === 'easing' ? -15 : 3;
  return {
    value: 1.83,
    changeBp,
    asOf: Date.now() - day,            // fresh: well inside the 5-day stale window
    stale: false,
    signal,
    note:
      signal === 'tightening' ? '10Y real yield +15bp - tighter conditions, headwind for risk' :
      signal === 'easing'     ? '10Y real yield -15bp - easier conditions, tailwind for risk' :
                                '10Y real yield +3bp - no meaningful move',
  };
}

/** Replace only `real10y` in the live /api/macro response. */
async function pinYield(page: Page, signal: Signal) {
  await page.route(MACRO_ROUTE, async route => {
    let body: Record<string, unknown> = {};
    try {
      const res = await route.fetch();
      body = await res.json();
    } catch {
      /* Upstream unreachable. Fulfilling with only real10y would still exercise
         the line under test, and the missing siblings are visible in the card
         text the assertions read - they do not silently become zeros. */
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...body, real10y: realYield(signal) }),
    });
  });
}

/** Load /arena signed in and return the Confluence card's text, card proven present. */
async function cardText(page: Page): Promise<string> {
  await gotoSignedIn(page, '/arena');
  await page.waitForTimeout(9000);          // card is below the fold, renders after hydration

  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  /* SKIP if the upstream is refusing THIS deployment. A spec that cannot reach
     its data has not found a defect - it failed to measure. CI on a GitHub
     runner cannot reach Binance at all, and one run turned that single cause
     into ~40 failures, several of which read as Pro-gating defects. */
  const down = await marketDataUnavailable(page.request);
  test.skip(down !== null, down ?? '');

  expect(body, 'the Confluence card is Pro-gated and did not render - this run measured nothing')
    .not.toMatch(/part of Pro|Unlock with Pro/i);

  const card = page.locator('.sms-card').filter({ hasText: /Confluence/i }).first();
  await expect(card, 'the Confluence card did not appear at all - nothing below is meaningful')
    .toBeVisible({ timeout: 20_000 });

  return (await card.innerText()).replace(/\s+/g, ' ');
}

test.describe('10Y real yield reaches the Confluence card', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  test('a TIGHTENING yield puts a line on the card', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
    await pinYield(page, 'tightening');
    const text = await cardText(page);

    expect(text,
      `a +15bp real yield is past the 10bp threshold and should surface as a headwind, ` +
      `but the card says nothing about it. Card text: ${text.slice(0, 300)}`)
      .toMatch(YIELD_LINE);

    /* RECORDED, NOT ASSERTED. A tightening yield escalates the band to caution
       unless it is already danger - but oil, DXY, SPX, gold and USD/JPY are all
       live here and any of them can have put the card in caution already. An
       assertion would pass for the wrong reason on a busy macro day and fail on
       a quiet one. The line above is the deterministic claim; this is context. */
    // eslint-disable-next-line no-console
    console.log(`[yield] tightening - band text: ${/danger|caution|elevated|calm/i.exec(text)?.[0] ?? 'no band word found'}`);
    } finally { await ctx.close(); }
  });

  test('an EASING yield is deliberately SILENT', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
    /* Past the same threshold as tightening, and renders nothing on purpose.
       This test exists so that "the easing case is missing" reads as a decision
       rather than an oversight the next time someone audits this file. */
    await pinYield(page, 'easing');
    const text = await cardText(page);

    expect(text,
      `an easing real yield rendered a line. It is a tailwind, and the macro row is the ` +
      `card's RISK band - good news in a warning box teaches people to read the colour as ` +
      `decoration. If this is now intended, lib/confluence.ts:166 is the decision to revisit.`)
      .not.toMatch(YIELD_LINE);
    } finally { await ctx.close(); }
  });

  test('a QUIET yield says nothing', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
    await pinYield(page, 'neutral');
    const text = await cardText(page);
    expect(text,
      `a +3bp move is under the 10bp threshold and should be silent, but a line appeared`)
      .not.toMatch(YIELD_LINE);
    } finally { await ctx.close(); }
  });

  test('an UNAVAILABLE yield says so', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
    await pinYield(page, 'unknown');
    const text = await cardText(page);
    expect(text,
      `the real yield could not be read and the card says nothing about it. A silent card ` +
      `means "checked, nothing happening" - which is a different statement from "could not ` +
      `check", and the user cannot tell them apart. Card text: ${text.slice(0, 300)}`)
      .toMatch(YIELD_LINE);
    } finally { await ctx.close(); }
  });

  test('THE PAIR: a quiet yield and an unreadable one do not look the same', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
    /* The four tests above each pass in isolation while the property that
       actually matters fails. Two of them assert absence and two assert
       presence, and nothing so far compares the quiet card to the unavailable
       one directly. If a future change made `unknown` silent, the "unavailable"
       test would fail - but if a change made BOTH render the same generic line,
       every test above would still pass and the distinction would be gone.
       So this asserts the difference itself, on one page, in one run. */
    await pinYield(page, 'neutral');
    const quiet = await cardText(page);

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await pinYield(page, 'unknown');
    const absent = await cardText(page);

    expect(quiet === absent,
      `a quiet real yield and an unreadable one produced IDENTICAL cards. The user cannot ` +
      `tell "checked, nothing happening" from "could not check", which is the failure this ` +
      `whole feature exists to prevent.`).toBe(false);

    expect(absent, 'the unavailable state produced no line').toMatch(YIELD_LINE);
    expect(quiet, 'the quiet state produced a line').not.toMatch(YIELD_LINE);
    } finally { await ctx.close(); }
  });
});
