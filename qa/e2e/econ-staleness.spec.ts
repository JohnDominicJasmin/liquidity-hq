import { test, expect, type Page } from '@playwright/test';
import { gotoGuarded, marketDataUnavailable } from './_shared';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';

/* Does the STALE-CALENDAR state reach the screen? (#298, dev's PR #307)
 *
 * `__tests__/macroRiskStale.test.mts` pins `computeMacroRisk` - a pure function
 * over an events array and a boolean. That is the right place for the logic and
 * it is a different claim from this one: a correct function still shows nothing
 * if the provider never sets the flag, if the component drops it, or if the
 * label renders empty. Dev's own note on #283 is the general form - the unit
 * test would pass either way.
 *
 * So this asserts the property where the user meets it: on the rendered card.
 *
 * WHY IT DRIVES THE DATA RATHER THAN USING WHAT THE HOST HAS. `qa` and
 * `staging` both carry a genuinely stale snapshot today (#261 - the cron only
 * ever targeted prod), so the stale case would pass there by accident and would
 * silently stop being tested the moment anyone fixes the ingest schedule. And
 * the FRESH cases cannot be produced at all without controlling the row.
 *
 * `page.route` on the Supabase REST call gives all four states on any host,
 * needs no database write, and cannot disturb dev's data.
 *
 * IT MUST RUN SIGNED IN AS PRO, and the first version did not. The Confluence
 * card is Pro-gated - signed out, /arena renders "Order flow bias, absorption
 * detection, and the combined confluence verdict are part of Pro" and the macro
 * row does not exist. Every assertion below is about that row, so a signed-out
 * run measured a card that was never on the page: the two negative controls
 * passed because the text was absent along with everything else, and the two
 * positive assertions failed for the same reason.
 *
 * Hence `cardPresent` - a POSITIVE control on every test. A control that only
 * asserts absence is satisfied by absence of the whole feature, which is the
 * exact trap this file is here to guard against elsewhere. */

const SNAPSHOT_ROUTE = '**/rest/v1/*econ_snapshot*';
const STALE_TEXT = /out of date|cannot be checked/i;

/** One high-impact release, `hoursAhead` from now. */
const event = (hoursAhead: number) => ({
  name: 'Consumer Price Index (CPI) MoM',
  type: 'CPI',
  isoDate: new Date(Date.now() + hoursAhead * 3_600_000).toISOString(),
  impact: 'high',
  previous: '0.0%',
  estimate: '0.2%',
});

/**
 * Serve a controlled snapshot row.
 *
 * `ageHours` sets `updated_at`; dev's threshold is 24h and "unknown age counts
 * as stale", so null is a distinct case worth being able to produce.
 */
async function installSnapshot(page: Page, opts: { ageHours: number | null; events: unknown[] }) {
  /* PIN USD/JPY QUIET, and this is not optional.
   *
   * `computeMacroRisk` returns `unknown` only when the calendar is stale AND
   * NOTHING was found - and USD/JPY is a finding. `lib/confluence.ts:126` fires
   * a caution at >= 158, and qa was serving 159.3 live, so every stale case
   * legitimately reported the carry-trade line instead of the staleness notice.
   *
   * That cost a wrong conclusion: the spec was red on the fixed build and the
   * obvious reading was "dev's fix does not work". It works. My scenario was
   * never the one I thought I was testing, because a live input I had not
   * controlled was supplying a finding.
   *
   * Dev's unit test passes `jpyUsd` directly; the browser reads /api/forex/jpy
   * (arena/page.tsx:403), so this pins it there. 150 is well below the 158
   * threshold - quiet, no reason emitted, nothing to mask the calendar state. */
  await page.route('**/api/forex/jpy**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ jpy: 150 }),
  }));

  await page.route(SNAPSHOT_ROUTE, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Content-Range': '0-0/1' },
    body: JSON.stringify([{
      key: 'us_high_impact',
      events: opts.events,
      updated_at: opts.ageHours === null
        ? null
        : new Date(Date.now() - opts.ageHours * 3_600_000).toISOString(),
    }]),
  }));
}

/** Load /arena signed in, then return the page text with the Pro card proven present. */
async function macroText(page: Page): Promise<string> {
  await gotoSignedIn(page, '/arena');
  /* The card is below the fold and renders after the provider hydrates. */
  await page.waitForTimeout(9000);
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

  /* POSITIVE CONTROL, run before every assertion. Without it a signed-out or
     broken page reports "no stale warning" perfectly. */
  /* SKIP if the upstream is refusing THIS deployment. A spec that cannot reach
     its data has not found a defect - it failed to measure. CI on a GitHub
     runner cannot reach Binance at all, and one run turned that single cause
     into ~40 failures, several of which read as Pro-gating defects. */
  const down = await marketDataUnavailable(page.request);
  test.skip(down !== null, down ?? '');

  expect(body, 'the Confluence card is Pro-gated and did not render - this run measured nothing')
    .not.toMatch(/part of Pro|Unlock with Pro/i);

  /* SCOPED TO THE CARD, not the page.
   *
   * Reading document.body made an assertion pass for the wrong reason: the
   * Multi-TF block renders "Stay out or reduce size - no clear edge" on its own,
   * so /reduce size/ matched text from a completely different component and the
   * stale-with-event control passed without the macro row saying anything.
   *
   * `.sms-card` is the Confluence card (ConfluenceScore.tsx:141). Several cards
   * share the class, so this picks the one that identifies itself. */
  const card = page.locator('.sms-card').filter({ hasText: /Confluence/i }).first();
  await expect(card, 'the Confluence card did not appear at all - nothing below is meaningful')
    .toBeVisible({ timeout: 20_000 });

  return (await card.innerText()).replace(/\s+/g, ' ');
}

test.describe('stale econ calendar reaches the screen', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  test('CONTROL: a FRESH calendar with nothing upcoming does NOT claim staleness', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
    /* The load-bearing one. A build that renders the stale warning
       unconditionally satisfies every positive assertion below, and a permanent
       "cannot be checked" is worse than the bug it replaces - unfalsifiable, and
       users learn to ignore it. Same reason arena-legacy-signals asserts that a
       genuine FLAT stays FLAT. */
    await installSnapshot(page, { ageHours: 1, events: [] });
    const text = await macroText(page);

    expect(text, 'a one-hour-old calendar was reported as out of date')
      .not.toMatch(STALE_TEXT);
    } finally { await ctx.close(); }
  });

  test('CONTROL: a FRESH calendar WITH an upcoming release does not claim staleness', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
    /* ONE hour, not three. At three the release sits outside computeMacroRisk's
       caution window, so the card legitimately says nothing about it - and the
       positive assertion below would then fail on correct behaviour. Matching
       the stale-with-event control's offset keeps both tests asserting against a
       finding that genuinely exists. */
    await installSnapshot(page, { ageHours: 1, events: [event(1)] });
    const text = await macroText(page);

    expect(text, 'a fresh calendar carrying a real event was reported as out of date')
      .not.toMatch(STALE_TEXT);

    /* POSITIVE half. "The staleness text is absent" is satisfied by a macro row
       that rendered NOTHING - the shared card control proves the card exists,
       but the macro row is a conditional inside it. Dev caught this: without an
       assertion that the seeded release is actually reported, a broken render
       passes while looking like proof of correct behaviour.

       Three states instead of two:
         risk shown        PASS   the guard fired correctly
         staleness shown   FAIL   the mutation being hunted
         neither shown     FAIL   the row broke - previously a PASS */
    expect(text, 'the imminent CPI release is not reported at all - the macro row rendered ' +
      'neither the risk nor the staleness notice')
      .toMatch(/CPI|reduce size|volatility spike/i);

    } finally { await ctx.close(); }
  });

  test('a STALE calendar says so rather than reporting nothing', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
    /* 48h - past dev's 24h threshold. The events array is deliberately EMPTY,
       because that is the defect: an old set does not show expired rows, it is
       simply missing whatever was scheduled since the writer stopped. The search
       finds nothing and the card used to call that "no macro risk". */
    await installSnapshot(page, { ageHours: 48, events: [] });
    const text = await macroText(page);

    expect(text, 'a 48h-old calendar rendered without saying it could not be checked')
      .toMatch(STALE_TEXT);
    } finally { await ctx.close(); }
  });

  test('CONTROL: a STALE calendar with a real imminent event still reports the RISK', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
    /* THE MUTATION THE OTHER FOUR CANNOT CATCH, and dev named it on the PR.
     *
     * A guard that fires on `stale` REGARDLESS of what was found would replace
     * every real warning with "cannot be checked" - and all four other tests
     * here would still pass, because none of them has both a stale calendar and
     * something to find.
     *
     * Dev mutation-tested exactly this in macroRiskStale.test.mts:
     *   guard never fires        -> the unknown assertions fail  (covered above)
     *   guard fires always       -> the CONTROLs fail            (only this one)
     *
     * The unit tests catch both but exercise computeMacroRisk in isolation. This
     * is the only thing that would notice the wiring through NewsProvider and
     * ConfluenceScore degrading into "always stale". */
    await installSnapshot(page, { ageHours: 48, events: [event(1)] });
    const text = await macroText(page);

    expect(text, 'a stale calendar that still contains an imminent release reported "cannot be checked" ' +
      'instead of the risk it found - the guard is firing regardless of the result, which replaces real ' +
      'warnings with an unfalsifiable one')
      .not.toMatch(STALE_TEXT);

    /* POSITIVE half. "The staleness text is absent" is satisfied by a macro row
       that rendered NOTHING - the shared card control proves the card exists,
       but the macro row is a conditional inside it. Dev caught this: without an
       assertion that the seeded release is actually reported, a broken render
       passes while looking like proof of correct behaviour.

       Three states instead of two:
         risk shown        PASS   the guard fired correctly
         staleness shown   FAIL   the mutation being hunted
         neither shown     FAIL   the row broke - previously a PASS */
    expect(text, 'the imminent CPI release is not reported at all - the macro row rendered ' +
      'neither the risk nor the staleness notice')
      .toMatch(/CPI|reduce size|volatility spike/i);

    } finally { await ctx.close(); }
  });

  test('an UNKNOWN age counts as stale', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
    /* Dev's call, and the right one: we cannot show the set is complete, and
       claiming freshness we have not established is the failure being fixed. */
    await installSnapshot(page, { ageHours: null, events: [] });
    const text = await macroText(page);

    expect(text, 'a snapshot with no updated_at was treated as fresh')
      .toMatch(STALE_TEXT);
    } finally { await ctx.close(); }
  });
});
