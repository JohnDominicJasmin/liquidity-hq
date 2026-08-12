import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';

/* Does the perps/spot reading move the Confluence Score? (#340)
 *
 * WRITTEN BEFORE THE FEATURE, AND IT IS MEANT TO BE INVERTED.
 *
 * The owner has scoped perps-vs-spot as an INPUT to Arena's decision making,
 * across five surfaces. Three of them are context handed to a model - Quick
 * Research, Deep Research, Ask AI - and two are numbers: the Confluence Score
 * and the chart signal's confidence.
 *
 * Those ship in two steps, and the risk sits in the gap between them:
 *
 *     step 1   wire the reading into the three TEXT surfaces
 *              -> the score MUST NOT move. Any change is accidental coupling.
 *
 *     step 3   wire it into the score, with an owner-approved weighting
 *              -> the score MUST move. This test then FAILS, and that failure
 *                 is the signal to invert it rather than a regression.
 *
 * A test whose expected result reverses on a known future change is unusual
 * enough to say out loud, so: `EXPECT_COUPLED` below is the switch, and the
 * failure message says which step you are probably in.
 *
 * WHY AN INVARIANT AND NOT A FIXED VALUE. Pinning "the score is +3" would need
 * every input pinned - RSI, funding, open interest, order flow, six timeframes -
 * and would then be asserting a property of the fixture. Comparing the SAME page
 * under two perps readings needs none of that: everything else is identical by
 * construction, so any difference is attributable.
 *
 * WHICH ONLY HOLDS IF THE SCORE IS STABLE AT ALL. It is computed from live
 * market data that moves between page loads, so a difference between two loads
 * proves nothing on its own. Hence the third load: same reading as the first,
 * and if the score has drifted under IDENTICAL conditions the run cannot
 * conclude and says so instead of guessing. That is the instrument check that
 * every void attempt on #306 lacked.
 */

/* Flip to true when step 3 lands and the owner-approved weighting is in. */
const EXPECT_COUPLED = false;

const KLINES = '**/api/market/klines**';
const HOUR = 3_600_000;

const bar = (time: number, quoteVolume: number) =>
  [time, '60000', '60500', '59500', '60000', '100', time + HOUR - 1,
    String(quoteVolume), 1000, '50', String(quoteVolume / 2), '0'];

/** 168 hourly bars whose last CLOSED bar sets the reading. */
function series(perpLast: number) {
  const forming = Math.floor(Date.now() / HOUR) * HOUR;
  const spot: unknown[][] = [];
  const perp: unknown[][] = [];
  for (let i = 167; i >= 2; i--) {
    const t = forming - i * HOUR;
    spot.push(bar(t, 10_000_000));
    perp.push(bar(t, 100_000_000));
  }
  const lastClosed = forming - HOUR;
  spot.push(bar(lastClosed, 10_000_000));
  perp.push(bar(lastClosed, perpLast));
  spot.push(bar(forming, 300_000));
  perp.push(bar(forming, 3_000_000));
  return { spot, perp };
}

/**
 * `'leading'`  -> strong FUTURES LEADING  (perp volume 14x spot on the last closed bar)
 * `'spotled'`  -> SPOT LEADING            (7x, below this coin's own normal)
 * `'absent'`   -> no spot side at all, so the reading is CANNOT MEASURE
 *
 * THE COMPARISON USES THE TWO **VALID** MODES, not valid-vs-absent, and that
 * distinction decided a finding.
 *
 * `'absent'` serves a 404 for the spot side. If any OTHER component read the
 * same endpoint at the same parameters, that 404 would break it, and the score
 * would change for a reason that had nothing to do with the perps reading -
 * a fixture side-effect wearing the costume of a defect.
 *
 * Ruled out by measurement rather than argument:
 *
 *     requests matching interval=1h&limit=168:  2  ["binance","binance-futures"]
 *
 * Both are the perps card's own fetch. Nothing else on /arena reads it. But the
 * comparison still uses two valid payloads, because that conclusion holds only
 * until someone adds a third consumer - and then valid-vs-404 would start
 * lying without anything failing.
 */
async function pinPerps(page: Page, mode: 'leading' | 'absent' | 'spotled') {
  const { spot, perp } = series(mode === 'spotled' ? 70_000_000 : 140_000_000);
  await page.route(KLINES, async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('interval') !== '1h' || url.searchParams.get('limit') !== '168') {
      return route.continue();
    }
    const futures = url.searchParams.get('source') === 'binance-futures';
    if (!futures && mode === 'absent') {
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no such symbol"}' });
    }
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(futures ? perp : spot),
    });
  });
}

/** The signed number in the Confluence card's verdict badge (ConfluenceScore.tsx:159). */
async function readScore(page: Page, mode: 'leading' | 'absent' | 'spotled'): Promise<string> {
  await pinPerps(page, mode);
  await gotoSignedIn(page, '/arena');
  await page.waitForTimeout(9000);

  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  expect(body, 'the Confluence card is Pro-gated and did not render - this run measured nothing')
    .not.toMatch(/part of Pro|Unlock with Pro/i);

  const card = page.locator('.sms-card').filter({ hasText: /Confluence/i }).first();
  await expect(card, 'the Confluence card did not appear - nothing below is meaningful')
    .toBeVisible({ timeout: 20_000 });

  const verdict = card.locator('.sms-verdict').first();
  await expect(verdict, 'the Confluence card rendered without its score badge').toBeVisible({ timeout: 10_000 });

  /* WAIT FOR IT TO SETTLE, do not just read it.
   *
   * The first version read after a flat 9s and got `+0`, then `-49` on the two
   * loads after. That looked like live-data drift and it was not: `+0` is the
   * card before its inputs have arrived, and `-49` is the settled value. Nine
   * seconds was simply too early on a cold service.
   *
   * A placeholder read as a real measurement is the same failure as every other
   * one on this project this week - so this polls until the value stops moving
   * rather than trusting a fixed wait. */
  /* STABLE IS NOT THE SAME AS LOADED, and the first version conflated them.
   *
   * `+0` is what the badge shows before its inputs arrive, and it is perfectly
   * stable while it waits - so "three identical reads" settled on the
   * placeholder whenever the data took longer than 4.5s. Observed exactly that
   * against qa @ 69bfe39: leading=+0, absent=-73, leading-again=-58.
   *
   * So the score must also have MOVED OFF its initial value before a reading
   * counts. A card whose real score genuinely is +0 will time out here and skip
   * rather than report - the wrong-but-quiet answer is the one worth avoiding. */
  /* Two attempts at this were wrong in opposite directions, so the reasoning
     matters more than the code:
   *
   *   "stable for 4.5s"        settled on the `+0` PLACEHOLDER whenever the
   *                            inputs took longer than that - it is perfectly
   *                            stable while it waits
   *   "must MOVE off its       skipped a load whose real score happened to be
   *    first value"            there before the first read, which is a false
   *                            skip on a correct reading
   *
   * `+0` is the placeholder specifically, so that is what to wait out. The
   * trade: a card whose genuine score is exactly zero will time out and SKIP.
   * That is the safe direction - a missed measurement costs a re-run, a
   * placeholder read as a measurement costs a false finding, and this file
   * exists to stop the second one. */
  const PLACEHOLDER = '+0';
  let last = (await verdict.innerText()).trim();
  let stableFor = 0;
  for (let i = 0; i < 40 && !(last !== PLACEHOLDER && stableFor >= 3); i++) {   // up to ~60s
    await page.waitForTimeout(1500);
    const now = (await verdict.innerText()).trim();
    stableFor = now === last ? stableFor + 1 : 0;
    last = now;
  }
  test.skip(last === PLACEHOLDER,
    `the score badge still reads ${PLACEHOLDER} after 60s - that is the state before its ` +
    `inputs arrive, not a measurement. (A genuine score of zero also lands here, and skipping ` +
    `is the right answer for both.)`);
  expect(stableFor,
    `the score never stopped changing (last value ${last}). It cannot be compared across ` +
    `loads if it does not settle within a single one.`).toBeGreaterThanOrEqual(3);
  return last;
}

test.describe('perps reading and the Confluence Score', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  test('the score is decoupled from the perps reading (until step 3)', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      const first = await readScore(page, 'leading');
      await page.unrouteAll({ behavior: 'ignoreErrors' });

      const absent = await readScore(page, 'spotled');
      await page.unrouteAll({ behavior: 'ignoreErrors' });

      /* INSTRUMENT CHECK, and the reason this test can say anything at all.
         The score is computed from live market data. If it drifts between two
         loads under the SAME perps reading, then a difference under different
         readings is not attributable to the reading, and the honest outcome is
         "could not measure" rather than a verdict. */
      const repeat = await readScore(page, 'leading');

      // eslint-disable-next-line no-console
      console.log(`[score] leading=${first} absent=${absent} leading-again=${repeat}`);

      test.skip(first !== repeat,
        `the score moved from ${first} to ${repeat} under IDENTICAL perps input, so live market ` +
        `data is drifting between loads and nothing here is attributable. Not a finding either ` +
        `way - re-run when the market is quieter.`);

      if (EXPECT_COUPLED) {
        expect(absent,
          `the score is ${absent} whether the perps reading is FUTURES LEADING or CANNOT ` +
          `MEASURE. Step 3 was supposed to make this input count, and it does not. Worse: a ` +
          `coin with no spot data is scoring exactly as though it had been measured.`)
          .not.toEqual(first);
      } else {
        expect(absent,
          `the score changed from ${first} to ${absent} when only the perps reading changed. ` +
          `If step 3 has landed and the score is SUPPOSED to use this input, flip ` +
          `EXPECT_COUPLED at the top of this file - this failure is then the feature working. ` +
          `If only the text surfaces were wired, this is accidental coupling and a real defect.`)
          .toEqual(first);
      }
    } finally { await ctx.close(); }
  });
});
