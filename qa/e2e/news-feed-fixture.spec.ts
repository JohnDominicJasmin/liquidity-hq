import { test, expect } from '@playwright/test';
import { SUPABASE_URL } from './_auth';

/* #757: `/news` cannot be swept off production, and no spec ran there. Closes
 * the free half of it.
 *
 * `/news` is push-based (`components/NewsProvider.tsx`'s own header): a
 * scheduled external job writes the `news` table, the page only ever READS it.
 * There is no in-app fetch that populates a non-prod table, so `dev`, `qa` and
 * `staging` render `NEWS_LOADING_FEEDS` forever and every QA sweep of the route
 * has measured an empty state - #752 needed a production check to find, #742
 * closed clean partly because nothing on staging COULD contradict it.
 *
 * TWO WAYS TO FIX THAT, and only one needs nobody's permission:
 *
 *   seed the dev Supabase news table    a write to a database three
 *                                       environments share - CONTRIBUTING's
 *                                       owner gate, not QA's or dev's call
 *
 *   intercept the READ this page makes  NewsProvider reads via getSupabase(),
 *                                       a plain supabase-js client with no
 *                                       custom fetch wrapper (lib/supabase.ts) -
 *                                       so the browser's own fetch is
 *                                       interceptable the same way
 *                                       qa/e2e/_fixtures.ts already serves 20
 *                                       recorded market endpoints. No DB
 *                                       touched, no owner approval needed.
 *
 * This spec takes the free path. If it turns out interception cannot reach the
 * read (checked below, not assumed), that is the finding that puts the seeding
 * request to the owner - with evidence instead of a guess.
 *
 * WHY THE 5s FALLBACK TIMER MATTERS MORE THAN THE ROUTE MATCH. NewsProvider
 * subscribes to Supabase Realtime FIRST and only calls the REST read
 * (`hydrateNews`) from inside the `SUBSCRIBED` callback - so if the websocket
 * never subscribes in a test environment, intercepting the REST call alone
 * would hang forever waiting for a callback that never fires. The provider's
 * own `hydrateFallback` setTimeout(5000) calls `hydrateNews()` unconditionally
 * if the ref is still false, which is the path this spec actually exercises.
 * Confirmed by NOT mocking the websocket at all - if this test passes, the
 * fallback path is what did it, not a lucky subscribe.
 */

interface NewsRow {
  dedup_key: string;
  headline: string;
  source: string;
  published_at: string;
  severity: string | null;
  cat: string;
  link: string | null;
  image: string | null;
}

const FIXED_HEADLINE = 'QA fixture: BTC breaks range on thin liquidity — #757';

const FIXTURE_ROWS: NewsRow[] = [
  {
    dedup_key: 'qa-757-fixture-1',
    headline: FIXED_HEADLINE,
    source: 'QA Fixture',
    // Recent enough to clear NewsProvider's 6h hydration cutoff and pushAlert's
    // 15-minute notify window, without depending on when the suite runs.
    published_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    severity: 'amber',
    cat: 'markets',
    link: null,
    image: null,
  },
];

test.describe('#757 /news is testable without production or a database write', () => {
  test('a seeded Supabase read renders a real headline, via the fallback path alone', async ({ page, baseURL }) => {
    test.setTimeout(30_000);

    const supabaseUrl = SUPABASE_URL;
    test.skip(!supabaseUrl, 'NEXT_PUBLIC_SUPABASE_URL is unset in this environment - cannot derive the REST host to intercept.');

    let hydrationRequestSeen = false;

    /* MATCHED BY PREDICATE, NOT A LITERAL "news" PATH SEGMENT — the actual
     * table name is environment-prefixed. `lib/tables.ts`'s `T.news` resolves
     * to `lhq_dev_news` on this project (`NEXT_PUBLIC_APP_ENV === 'dev' ?
     * 'lhq_dev_' : 'lhq_'`, the same mechanism CONTRIBUTING documents for the
     * table-prefix gap). A glob string here would have to know that prefix
     * and go stale the moment it changes; checking the request itself does not. */
    await page.route(
      (u) => u.href.includes('/rest/v1/') && /news\b/i.test(u.pathname),
      async (route) => {
        hydrationRequestSeen = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(FIXTURE_ROWS),
        });
      },
    );

    /* Realtime's websocket is left UNMOCKED on purpose (see header). It will
     * fail to establish against wherever it tries to connect, NewsProvider
     * treats that as "not yet subscribed", and hydrateFallback's 5s timer is
     * what actually calls hydrateNews(). Waiting past that window rather than
     * for a specific event, so the test proves the REAL path rather than one
     * this spec choreographed. */
    await page.goto('/news', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(7_000);

    expect(hydrationRequestSeen,
      'the page never requested /rest/v1/news at all - NewsProvider\'s hydration ' +
      'path did not run, which means this environment is not exercising the code ' +
      'this spec exists to test',
    ).toBe(true);

    const headline = page.locator('.ncard-grid-headline', { hasText: 'QA fixture: BTC breaks range' });
    await expect(headline,
      `/rest/v1/news was requested and answered with the fixture row, but no ` +
      `.ncard-grid-headline rendered it. Either the response shape does not match ` +
      `what NewsProvider expects (dedup_key/headline/source/published_at/severity/` +
      `cat/link/image), or something downstream of the read is filtering the row out.`,
    ).toBeVisible({ timeout: 10_000 });

    /* The loading state must be GONE, not merely absent from view - a route
     * that never resolves would leave both true, which toBeVisible above would
     * not catch if the loading text and the headline happen to coexist. */
    const loading = page.getByText(/loading/i).first();
    await expect(loading, 'the loading state is still showing alongside real content').not.toBeVisible();
  });

  /* THE NEGATIVE CASE, because a spec that only proves "seeded data renders" has
   * not proven the ROUTE exists - node/README trap 3, in this file rather than
   * someone else's. Confirms an unseeded read (empty array, matching what
   * dev/qa/staging's real, unpopulated table actually returns) reaches the
   * documented empty state rather than erroring or hanging. */
  test('CONTROL: an empty feed reaches the documented empty state, not an error', async ({ page }) => {
    test.setTimeout(30_000);
    const supabaseUrl = SUPABASE_URL;
    test.skip(!supabaseUrl, 'NEXT_PUBLIC_SUPABASE_URL is unset in this environment.');

    // Same predicate as the test above - see its comment for why a literal
    // "news" path segment does not match the environment-prefixed table name.
    await page.route(
      (u) => u.href.includes('/rest/v1/') && /news\b/i.test(u.pathname),
      async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      },
    );

    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    await page.goto('/news', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(7_000);

    expect(pageErrors, `the page threw with an empty news table: ${pageErrors.join(' | ')}`).toEqual([]);

    const loading = page.getByText(/loading/i).first();
    await expect(loading, 'an empty read should clear the loading state, not leave it spinning forever')
      .not.toBeVisible();
  });
});
