import { test, expect } from '@playwright/test';
import { gotoGuarded } from './_shared';
import type { Browser } from '@playwright/test';
import { installMarketFixtures } from './_fixtures';

/* Time-dependent behaviour, with the clock pinned.
 *
 * `qa/TEST_GAPS.md` §1 listed these as untestable: "Best Hours and the economic
 * calendar across timezones, including DST" and "24h/48h alert outcome
 * resolution - a test would have to wait 24 hours". The first half is testable
 * now; the second still is not, and the difference matters.
 *
 * WHAT MADE IT POSSIBLE. Playwright's `page.clock` fakes the browser's clock,
 * so nothing in the app has to change. That mattered: the app makes 146
 * `Date.now()` and 71 `new Date()` calls with no abstraction between them and
 * the platform, so injecting a clock through app code would have been a
 * 217-site refactor - and app code is not QA's to write.
 *
 * 🔴 WHAT THIS DOES NOT FAKE, stated up front because it is easy to over-read:
 *
 *   - SERVER time. Anything rendered server-side, and every cron path, still
 *     runs on the real clock. The 24h/48h alert outcome resolution is a cron,
 *     so it stays untestable here.
 *   - The USER's timezone. `page.clock` moves the instant, not the zone. These
 *     run at the project's default locale; a real DST/zone matrix needs
 *     `timezoneId` contexts and is a separate piece of work.
 *
 * So §1 goes from "untestable" to "half testable", and the file says so rather
 * than claiming the gap is closed.
 */

/** The two designs, and the element each one uses to name the active window.
 *
 * PIN THE DESIGN, NEVER INHERIT IT (#844). This file used to seed no design and
 * read `div.session-pill`, which is the CURRENT design's app bar. That was
 * correct right up until #748 made terminal the default on every route, at
 * which point the selector stopped existing and the test failed with "the
 * session pill never rendered" - a message that reads like a broken feature and
 * was actually a spec looking at the wrong design.
 *
 * The feature is not missing in terminal. `TerminalNav.tsx` renders
 * `.tnav-session` from the same `getCurrentWindow()` in `lib/session.ts`. Two
 * components, one source of truth - so the clock behaviour is asserted in BOTH,
 * which is strictly more than this file used to prove. */
const DESIGNS = [
  { design: 'current',  selector: 'div.session-pill'   },
  { design: 'terminal', selector: 'span.tnav-session'  },
] as const;

/** A page with the clock pinned, fixtures served, the banner dismissed, and the
 *  design pinned rather than inherited. */
async function pinnedTo(browser: Browser, iso: string, timezoneId?: string, design: 'current' | 'terminal' = 'terminal') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
  });
  /* Seeded, not passed as `?design=`, so the preference is in place before the
   * `design-init` script in app/layout.tsx reads it - the same route the query
   * param takes, one step earlier, and with no first frame on the default. */
  await ctx.addInitScript((d) => {
    try { localStorage.setItem('lhq-design-mode', d); } catch { /* private mode */ }
  }, design);
  const page = await ctx.newPage();
  /* BEFORE navigation, and before fixtures. The app reads the clock during
   * hydration, so installing it after a goto measures the real time on first
   * paint and the fake one afterwards - which is worse than not faking at all,
   * because it looks like it worked. */
  await page.clock.install({ time: new Date(iso) });
  await installMarketFixtures(page, 'as-recorded');
  return { page, close: () => ctx.close() };
}

async function bodyTextOf(browser: Browser, iso: string, route = '/hours') {
  const { page, close } = await pinnedTo(browser, iso);
  try {
    await gotoGuarded(page, route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    return (await page.evaluate(() => document.body.innerText || '')).replace(/\s+/g, ' ');
  } finally { await close(); }
}

test.describe('clock-dependent behaviour', () => {
  // DOM-level; the mobile project would assert identical strings.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'clock behaviour is viewport-independent');
  });

  /* POSITIVE CONTROL, first. Every assertion below reads text off a page at a
   * pinned time. If `page.clock` silently failed to install, the page would
   * render at the REAL time and some of these would still pass by luck.
   *
   * This proves the fake clock is actually in effect before anything is
   * concluded from what the page says. */
  test('the fake clock is actually installed (guards against a vacuous pass)', async ({ browser }) => {
    const { page, close } = await pinnedTo(browser, '2026-08-10T02:00:00Z');
    try {
      await gotoGuarded(page, '/hours', { waitUntil: 'domcontentloaded' });
      const seen = await page.evaluate(() => new Date().toISOString());
      expect(seen.slice(0, 13),
        `the page reported ${seen} - page.clock did not take effect, so every assertion in this ` +
        'file would be measuring the real time and passing or failing by accident',
      ).toBe('2026-08-10T02');
    } finally { await close(); }
  });

  /* SESSION WINDOWS. lib/session.ts defines these as UTC ranges; /hours renders
   * whichever is active. Three pinned instants, three different answers - which
   * is the behaviour no test could reach before. */
  /* Reads `div.session-pill`, NOT the page text.
   *
   * The first version of this test asserted against `document.body.innerText`
   * and failed on its own negative case: /hours renders a session MAP listing
   * every window, so "MON EVENING" appears at 02:00 UTC as a label in the map
   * rather than as the active session. The page was right and the assertion was
   * reading the wrong thing.
   *
   * `.session-pill` is the single element that names the CURRENTLY active
   * window, which is the thing that actually depends on the clock. */
  async function sessionPill(
    browser: Browser, iso: string, design: 'current' | 'terminal', selector: string,
  ): Promise<string> {
    const { page, close } = await pinnedTo(browser, iso, undefined, design);
    try {
      await gotoGuarded(page, '/hours', { waitUntil: 'domcontentloaded' });

      /* PROVE THE DESIGN APPLIED BEFORE CONCLUDING ANYTHING FROM A SELECTOR.
       * Without this, seeding the wrong key or the app ignoring it both surface
       * as "the element never rendered", which is the exact failure this file
       * just spent a release misreading. */
      await expect
        .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-design')),
          { message: `the ${design} design never applied - the selector below would be measuring the other one`, timeout: 10_000 })
        .toBe(design === 'terminal' ? 'terminal' : null);

      const pill = page.locator(selector);
      await expect(pill, `${selector} never rendered in the ${design} design - nothing can be concluded from its text`)
        .toBeVisible({ timeout: 20_000 });
      return ((await pill.innerText()) || '').replace(/\s+/g, ' ').trim();
    } finally { await close(); }
  }

  for (const { design, selector } of DESIGNS) {
    test(`the active session window follows the clock (${design} design)`, async ({ browser }) => {
      const asia = await sessionPill(browser, '2026-08-10T02:00:00Z', design, selector);
      expect(asia, 'Monday 02:00 UTC is inside the Asia window').toMatch(/ASIA SESSION/i);

      const monEvening = await sessionPill(browser, '2026-08-10T14:00:00Z', design, selector);
      expect(monEvening, 'Monday 14:00 UTC is the Monday-evening window').toMatch(/MON EVENING/i);

      /* The negative cases are what make the two above mean anything: a pill that
       * says the same thing at every instant would satisfy both otherwise. */
      expect(monEvening, '14:00 UTC must NOT also claim the Asia session').not.toMatch(/ASIA SESSION/i);
      expect(asia, '02:00 UTC must NOT also claim the Monday-evening window').not.toMatch(/MON EVENING/i);
    });
  }

  /* TIMEZONES, and the harness question had to be settled first.
   *
   * `page.clock` fakes the INSTANT; `timezoneId` sets the ZONE. Whether the two
   * compose is not obvious - a faked Date that ignored the context timezone
   * would make every assertion here an artefact of the harness rather than a
   * fact about the app.
   *
   * Measured before writing this: at 2026-08-10T14:00:00Z,
   *   America/New_York -> "10:00 AM EDT"     (UTC-4, and EDT not EST - DST)
   *   Australia/Sydney -> "12:00 AM GMT+10"  (next calendar day)
   * Both correct, so they do compose.
   *
   * DST is the part worth having. New York in August is EDT, not EST, and the
   * only way that is wrong is if something formats against a fixed offset
   * instead of a zone - which is exactly the bug class that makes a session
   * window an hour out for half the year. */
  for (const [zone, instant, expected] of [
    ['America/New_York', '2026-08-10T14:00:00Z', '10:00'],   // summer, EDT, UTC-4
    ['America/New_York', '2026-01-12T14:00:00Z', '9:00'],    // winter, EST,  UTC-5
    ['Australia/Sydney', '2026-08-10T14:00:00Z', '12:00'],   // next day, UTC+10
  ] as const) {
    test(`${zone} at ${instant} renders local time, DST included`, async ({ browser }) => {
      const { page, close } = await pinnedTo(browser, instant, zone);
      try {
        await gotoGuarded(page, '/hours', { waitUntil: 'domcontentloaded' });
        const local = await page.evaluate(() =>
          new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
        expect(local,
          `the page reported ${local} for ${instant} in ${zone}. If the hour is right but the ` +
          'offset is wrong by exactly one, something is formatting against a fixed offset ' +
          'rather than a zone, and every session window is an hour out for half the year.',
        ).toContain(expected);
      } finally { await close(); }
    });
  }

  /* MARKET HOLIDAYS. Verified against two real entries rather than one, so a
   * single mis-typed date cannot make this pass. */
  test('market holidays are recognised', async ({ browser }) => {
    const christmas = await bodyTextOf(browser, '2026-12-25T15:00:00Z');
    expect(christmas, 'NY and London are both closed on 2026-12-25').toMatch(/NY closed - Christmas Day/i);
    expect(christmas).toMatch(/London closed - Christmas Day/i);

    const thanksgiving = await bodyTextOf(browser, '2026-11-26T15:00:00Z');
    expect(thanksgiving, 'NY is closed on 2026-11-26; London is not').toMatch(/NY closed - Thanksgiving Day/i);
    expect(thanksgiving, 'Thanksgiving is not a London holiday - a blanket "closed" would be wrong')
      .not.toMatch(/London closed - Thanksgiving/i);
  });

  /* 🔴 THE ONE THIS FILE EXISTS FOR.
   *
   * `lib/session.ts` holds a single hardcoded table, `HOLIDAYS_2026`, and
   * `getHoliday()` does `HOLIDAYS_2026[region] ?? []`. The file says "Update
   * this table at the start of each year" - and nothing enforces it.
   *
   * Measured with the clock pinned:
   *   2026-12-25  ->  "NY closed - Christmas Day · London closed - Christmas Day"
   *   2027-12-25  ->  nothing at all
   *
   * So on 2027-01-01 every market holiday silently becomes an ordinary trading
   * day. No error, no warning, no log line - the app just says the market is
   * open on Christmas.
   *
   * THIS TEST IS DELIBERATELY EARLY. It checks the table covers the year that
   * will contain "sixty days from now", not the year it is now. So it turns red
   * in early November 2026, while there is time to act, instead of on New
   * Year's Day when it is already wrong in production.
   *
   * If you are reading this because it just failed: add next year's holidays to
   * `HOLIDAYS_2026` (and rename it), then update the two dates above. Do not
   * widen this test - the lead time IS the feature. */
  test('the holiday table still covers the near future', async ({ browser }) => {
    const soon = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    const year = soon.getUTCFullYear();

    // New Year's Day is a holiday for both NY and London in every table so far,
    // which makes it the safest probe for "is this year present at all".
    const text = await bodyTextOf(browser, `${year}-01-01T15:00:00Z`);

    expect(text,
      `${year}-01-01 produced no holiday. lib/session.ts holds a single hardcoded HOLIDAYS_2026 ` +
      `table and getHoliday() falls back to [] for any other year, so from ${year}-01-01 every ` +
      `market holiday silently becomes a normal trading day. This test fires 60 days early on ` +
      `purpose - there is still time. Add ${year}'s holidays to lib/session.ts.`,
    ).toMatch(/closed - New Year/i);
  });
});
