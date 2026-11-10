import { test, expect } from '@playwright/test';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON, SUPABASE_URL, FIXTURES } from './_auth';
import { installPaidAiFence, assertNoUnstubbedPaidAi } from './_no-paid-ai';

/* A /briefing coin row must open Arena on THAT coin, even when the account's saved
 * `default_coin` is a different one.
 *
 * ── WHY THIS CELL AND NOT THE SIGNED-OUT ONE ────────────────────────────────────────────────
 *
 * Dev Team measured the signed-out half on deployed qa and it does not reproduce: direct deep
 * links honoured, and a primed-then-click flow landed on `pepe` and then `fil` against hrefs
 * captured before the click. But signed out there are no settings, so the seed effect's coin
 * branch never runs and a clean signed-out result says nothing about the reported flow. The only
 * untested case is a SIGNED-IN account whose saved `default_coin` differs from the row's coin,
 * which is this file.
 *
 * ── AND WHY IT IS WORTH A FILE RATHER THAN A ONE-OFF RUN ────────────────────────────────────
 *
 * `arena-seed-effect-real-selection.spec.ts` covers the strategy third of #1308 and says in its
 * own scope note that the COIN and TF thirds were attempted and left out: two live attempts gave
 * two inconsistent results, and the remaining variable was never isolated. #1263 records the coin
 * behaviour as UNCONFIRMED, not as a pass. So this is the gap that has been open since September,
 * and it should be pinned by an assertion rather than re-measured by hand a third time.
 *
 * ── THE MECHANISM UNDER TEST, read from app/(main)/arena/page.tsx before writing this ───────
 *
 * `hadCoinParamAtMount` (:237) is `searchParams.has('coin')` captured in a LAZY INITIALIZER, and
 * the seed effect (:752) only applies `settings.default_coin` when that is false. The page's own
 * "sync coin + tf to URL" effect calls `history.replaceState` on every mount, which Next reflects
 * back into `searchParams` - so any LATER `has('coin')` read sees the app's own write and cannot
 * tell a real deep link from it. That is the trap the lazy capture exists to avoid, and it is the
 * same `useSearchParams()` prerender family as the /upgrade hydration bug fixed in #2090, which is
 * why "the guard reads correctly" is not evidence that it works.
 *
 * ── NO WRITE TO THE SHARED DATABASE ─────────────────────────────────────────────────────────
 *
 * `default_coin` is served by STUBBING the Supabase `user_settings` read, never by saving a value
 * on a fixture. `qa` and `staging` share the DEV database, so a fixture write would change state
 * for every other session and for dev's own account - and a shared-database write is owner-gated
 * besides. The stub is also what makes the control below possible at all.
 *
 * ── THE CONTROL, AND WHY THESE TWO VALUES ───────────────────────────────────────────────────
 *
 * Two different defaults could otherwise explain a pass:
 *
 *     Arena's own lazy initializers (:221, :225)   coin 'btc'   tf '15m'
 *     DEFAULT_SETTINGS (lib/settings.ts:62, :67)   coin 'btc'   tf '1h'
 *
 * So the stub serves `eth` and `4h`, and NEITHER is reachable by any other path. C2 loads /arena
 * with no params at all and requires both to arrive: that proves the stub reached the app AND that
 * the seed effect genuinely ran. Without it, "C1 ended on the row's coin" is equally consistent
 * with settings never having loaded, which is precisely the ambiguity that left two earlier
 * attempts inconsistent.
 *
 * `tf` carries that proof INTO C1 as well - a per-cell witness rather than a separate run. If C1
 * ends on the row's coin and `tf=4h`, the seed ran in that same load and deliberately left the
 * coin alone. If C1 ends on the row's coin and `tf=15m`, the seed never ran and C1 proves nothing.
 * The assertion below states both, so that second case fails instead of passing quietly.
 *
 * Reading the SETTLED url is a fair read of `selectedCoin` because the sync effect writes it there;
 * it is the `has()` PREDICATE that the same effect poisons, not the value. Stated because the
 * distinction is the whole reason the earlier attempts disagreed.
 */

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

const STUB_COIN = 'eth';   // not 'btc', so it cannot be either default
const STUB_TF   = '4h';    // not '15m' (arena's own) and not '1h' (DEFAULT_SETTINGS)

/** Serves `user_settings` from a stub so the saved coin/tf are known without writing to the
 *  shared dev database. Installed before any navigation: Playwright matches the most recently
 *  registered handler first, so a stub added after a page has already read is a stub that never
 *  fires - and an unfired stub is indistinguishable from one that was not needed. */
async function stubSavedSettings(page: import('@playwright/test').Page) {
  let served = 0;
  await page.route(`${SUPABASE_URL}/rest/v1/**`, async (route) => {
    if (!/user_settings/.test(route.request().url())) return route.fallback();
    served += 1;
    /* `maybeSingle()` asks for a single object rather than an array, so answer in that shape.
       Getting it wrong would make the app fall back to DEFAULT_SETTINGS - which is exactly what
       the tf witness catches, so a wrong shape fails loudly instead of passing vacuously.

       A WHOLE ROW, not just the two fields under test. The first version returned only
       `default_coin` and `default_tf`, and a cold load then settled on btc/15m while a warm
       client-side navigation honoured the stub - an asymmetry that would have read as an app
       defect. `user_settings` is (user_id, default_coin, default_tf, updated_at, ...) and the
       provider carries per-field concurrency machinery (#1202/#1217 `knownAsOf`,
       `fieldUpdatedAtRef`), so a row with no `user_id` and no `updated_at` is a row it may
       legitimately refuse on a first read. Serving the real shape is what makes a remaining
       asymmetry attributable to the app rather than to the stub. */
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user_id: FIXTURES.aId,
        default_coin: STUB_COIN,
        default_tf: STUB_TF,
        updated_at: new Date().toISOString(),
      }),
    });
  });
  return () => served;
}

/** The settled `?coin=`/`?tf=` the page syncs from its own state.
 *
 *  WAITS FOR QUIESCENCE, NOT FOR PRESENCE, and the difference is a real failure this cell already
 *  produced once. The first version waited for `has('coin')` and then read immediately - but the
 *  URL-sync effect writes the page's INITIALIZER defaults (`btc`/`15m`) the moment Arena mounts,
 *  which satisfies that condition instantly and long before the settings read lands. On a direct
 *  /arena load that read `tf=15m` and failed the control, while the same assertion passed after a
 *  client-side navigation purely because the extra hop gave settings time to arrive first. The app
 *  was not the variable; the wait was. It is the same trap `arena/page.tsx:232-236` describes for
 *  `has('coin')`, one layer up - the app's own write is indistinguishable from the real answer.
 *
 *  So: poll until the query string stops changing, then read. Answer-agnostic on purpose - waiting
 *  for `tf` to BECOME the stubbed value would be waiting for the result this cell exists to measure,
 *  which is how a test ends up unable to fail. `stable` is returned rather than asserted here so a
 *  caller can report "never settled" as its own outcome instead of a wrong value. */
async function settledCoinAndTf(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => new URLSearchParams(location.search).has('coin'), null, { timeout: 30_000 });

  const QUIET_MS = 3_000;
  const LIMIT_MS = 25_000;
  const started = Date.now();
  let last = '';
  let quietFor = 0;
  let stable = false;
  while (Date.now() - started < LIMIT_MS) {
    const now = await page.evaluate(() => location.search);
    if (now === last) {
      quietFor += 500;
      if (quietFor >= QUIET_MS) { stable = true; break; }
    } else {
      last = now;
      quietFor = 0;
    }
    await page.waitForTimeout(500);
  }

  const q = new URLSearchParams(last);
  return { coin: q.get('coin'), tf: q.get('tf'), stable, search: last };
}

test.describe('a /briefing coin row opens Arena on that coin, not on the saved default (#1263)', () => {
  /* ── C2 IS ANNOTATED FAILING, AND IT IS THE FINDING RATHER THAN A BROKEN CELL ──────────────
   *
   * Measured on deployed qa `705c149`, desktop, --repeat-each=2: a COLD /arena load settles on
   * `?coin=btc&tf=15m` - arena's own initializer defaults - after exactly 1 `user_settings` read,
   * while the SAME stub on a warm client-side navigation (C1) is honoured, `tf=4h`. 2/2 both ways.
   *
   * WHAT WAS RULED OUT. The first stub returned only the two fields under test, and a row with no
   * `user_id`/`updated_at` is one the provider's concurrency machinery could legitimately refuse on
   * a first read. Re-run with the full row - `user_id`, `default_coin`, `default_tf`, `updated_at` -
   * and the result is byte-identical, 2/2. So the asymmetry is not the stub's shape.
   *
   * WHAT IS NOT CONFIRMED, and it is app code so it is dev's to confirm: the likely mechanism is
   * `SettingsProvider`'s `lhq_settings_v1` localStorage cache. On the warm path /briefing's mount has
   * already read and cached, so Arena mounts with settings present synchronously and the seed applies
   * at once; cold, they arrive late. That is the #1308 latch class exactly - "the effect latched on
   * its FIRST run, before settingsLoaded could ever be true" - and
   * `arena-seed-effect-real-selection.spec.ts`'s scope note records the coin/TF thirds of that fix as
   * UNCONFIRMED, never as a pass. This cell is what confirms they are still open.
   *
   * ANNOTATED, NOT LEFT RED AND NOT SKIPPED. A permanently failing cell teaches nobody anything on
   * the day it starts passing, and a skip exits 0 so it cannot gate. `test.fail()` is this repo's
   * idiom for the same reason it was used on #2088: the suite is green while the defect is open and
   * goes RED the moment someone fixes it, which is the signal worth having. When it flips, strip the
   * annotation and this comment - do not delete the cell.
   *
   * USER-VISIBLE SHAPE, for whoever picks it up: a signed-in account with a saved default coin that
   * opens /arena directly gets btc/15m instead of what it saved. Tracker line on #1263. */
  test('C2 CONTROL: /arena with no params lands on the STUBBED saved coin and tf', async ({ browser }) => {
    /* INSIDE the body, not at describe level: a bare `test.fail()` in the describe scope applies to
       EVERY cell in it, which would invert C1 and report the passing cell as a failure. */
    test.fail();
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    await installPaidAiFence(page);
    const servedCount = await stubSavedSettings(page);
    try {
      await gotoSignedIn(page, '/arena');
      const { coin, tf, stable, search } = await settledCoinAndTf(page);

      expect(stable, `the query string never stopped changing in 25s (last: '${search}'), so nothing below is a read of a settled state`).toBe(true);
      expect(servedCount(), 'the user_settings stub never fired, so nothing below is about saved settings').toBeGreaterThan(0);
      /* BOTH values in ONE assertion, deliberately. Asserting tf first hid what coin did, and
         "which fields the seed applied" is the whole question - a cold load that ignores tf but
         honours coin is a different defect from one that ignores both. `search` is quoted so the
         failure message carries the settled state rather than a single field. */
      expect(
        { coin, tf },
        `settled query was '${search}' after ${servedCount()} user_settings read(s). `
        + `Expected the stubbed saved values. coin '${STUB_COIN}' and tf '${STUB_TF}' are reachable ONLY `
        + `from the stub: arena's own initializers default to btc/15m and DEFAULT_SETTINGS to btc/1h, `
        + `so btc/15m means the seed effect never applied saved settings on this cold load`,
      ).toEqual({ coin: STUB_COIN, tf: STUB_TF });
      await assertNoUnstubbedPaidAi(page);
    } finally {
      await ctx.close();
    }
  });

  test('C1: clicking a briefing row whose coin differs from the saved default opens THAT coin', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    await installPaidAiFence(page);
    await stubSavedSettings(page);
    try {
      await gotoSignedIn(page, '/briefing');

      /* Capture what the row PROMISES before clicking it, so the comparison is against the row's
         own href and not against a coin chosen by this test. A row whose coin equals STUB_COIN
         would pass no matter which branch won, so those are excluded. */
      const rows = page.locator('a[href^="/arena?coin="]');
      await expect(rows.first(), 'no /briefing coin rows rendered, so there is nothing to click').toBeVisible({ timeout: 60_000 });
      const hrefs = await rows.evaluateAll((els) =>
        els.map((el) => (el as HTMLAnchorElement).getAttribute('href') ?? ''));
      const candidates = hrefs
        .map((h) => new URLSearchParams(h.split('?')[1] ?? '').get('coin'))
        .filter((c): c is string => !!c && c !== STUB_COIN);
      expect(candidates.length, `every briefing row was '${STUB_COIN}', so no row can discriminate`).toBeGreaterThan(0);

      const target = candidates[0];
      const targetIndex = hrefs.findIndex((h) => h.includes(`coin=${target}`));
      expect(targetIndex, `could not find the row promising coin=${target} among the captured hrefs`).toBeGreaterThanOrEqual(0);
      await rows.nth(targetIndex).click();
      await page.waitForURL(/\/arena/, { timeout: 60_000 });
      const { coin, tf, stable, search } = await settledCoinAndTf(page);

      expect(stable, `the query string never stopped changing in 25s (last: '${search}'), so nothing below is a read of a settled state`).toBe(true);
      expect(tf, `WITNESS: tf must be the stubbed ${STUB_TF} - if it is '15m' the seed effect never ran in this load and the coin result below proves nothing`).toBe(STUB_TF);
      expect(coin, `the row promised coin=${target} and the saved default was ${STUB_COIN}`).toBe(target);
      await assertNoUnstubbedPaidAi(page);
    } finally {
      await ctx.close();
    }
  });
});
