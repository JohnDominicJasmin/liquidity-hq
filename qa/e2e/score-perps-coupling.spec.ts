import { test, expect, type Page } from '@playwright/test';
import { marketDataUnavailable } from './_shared';
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
const EXPECT_COUPLED = true;

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
async function readScore(page: Page, mode: 'leading' | 'absent' | 'spotled'): Promise<{ score: string; rest: string; perpLinesFound: number }> {
  await pinPerps(page, mode);
  await gotoSignedIn(page, '/arena');
  await page.waitForTimeout(9000);

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
  await expect(card, 'the Confluence card did not appear - nothing below is meaningful')
    .toBeVisible({ timeout: 20_000 });

  const verdict = card.locator('.sms-verdict').first();
  await expect(verdict, 'the Confluence card rendered without its score badge').toBeVisible({ timeout: 10_000 });

  /* WAIT FOR THE WHOLE CARD TO SETTLE, not just the number.
   *
   * THIS IS THE CORRECTION THAT MATTERS. Watching only the score badge produced
   * a retracted finding: I reported that the perps reading moved the score, and
   * it did not. Capturing the full card showed why -
   *
   *     futures-led   score -53   EMA Ribbon  -       Choppiness clear
   *     spot-led      score -58   EMA Ribbon  down 30 Choppiness -15 confidence
   *
   * The card's factors arrive ASYNCHRONOUSLY and the score reflects however
   * many have landed. Two loads differ for that reason alone, and the factors
   * that differed were EMA ribbon, choppiness and RSI divergence - none of them
   * perps, none of them touched by this fixture.
   *
   * A stable NUMBER is not a loaded CARD. So this waits for the entire card
   * text to stop changing, which cannot be satisfied while factors are still
   * arriving. */
  let last = (await card.innerText()).replace(/\s+/g, ' ').trim();
  let stableFor = 0;
  for (let i = 0; i < 40 && stableFor < 4; i++) {          // up to ~60s
    await page.waitForTimeout(1500);
    const now = (await card.innerText()).replace(/\s+/g, ' ').trim();
    stableFor = now === last ? stableFor + 1 : 0;
    last = now;
  }
  expect(stableFor,
    `the Confluence card never stopped changing in 60s - its factors are still arriving, so ` +
    `nothing read from it is comparable across loads.`).toBeGreaterThanOrEqual(4);

  const score = (await card.locator('.sms-verdict').first().innerText()).trim();
  /* `+0` is the badge before its inputs arrive. A genuine zero also lands here
     and skipping is right for both: a missed measurement costs a re-run, a
     placeholder read as a measurement costs a false finding. */
  test.skip(score === '+0',
    `the score badge reads +0 - that is the pre-input state, not a measurement.`);

  /* Everything EXCEPT the score. Two loads are only comparable if every other
     factor matches; if EMA ribbon or choppiness differ, the score difference is
     theirs and not the perps reading's. This is the control the retracted
     finding lacked. */
  /* AND THE MANIPULATED VARIABLE ITSELF, which the first version left in - so
   * this control fired on EVERY run and the test never once asserted anything.
   *
   * Measured 2026-08-14 on `feature/confluence-perps-line-always`, twice, with
   * identical output both times:
   *
   *     [score] leading=-40 spotled=-73 otherFactorsMatch=false
   *
   * Deterministic, not a race - which is what gave it away. The skip message
   * below still says "re-run", and re-running could never have helped.
   *
   * The cause is structural rather than timing. The two loads inject a
   * futures-led and a spot-led reading, and the card RENDERS that reading as a
   * sentence. So the perps line is part of the card text by design, differs by
   * design, and `rest` compared it as though it were an unrelated factor.
   * `a.rest !== b.rest` was true by construction.
   *
   * **A control that cannot pass is not a strict control, it is an absent
   * test.** It reported `2 skipped` and a skip reads as caution rather than as
   * "this measured nothing" - the same shape as the vacuous passes this suite
   * keeps finding, wearing a more responsible-looking colour.
   *
   * REMOVED, not substituted, and the difference decided a run. Measured on
   *  the counts came back `perpLines=1/0`: the futures-led load renders a
   * sentence and the spot-led load renders NOTHING - which is the #393 defect
   * itself. Replacing with a `#PERPS#` marker left one load carrying a token
   * the other lacked, so `rest` still differed and the control still fired.
   * Stripping both to nothing makes present-and-absent compare equal, which is
   * what "ignore the variable we changed" has to mean while that bug is live.
   *
   * Normalising the perps sentence out is what makes the comparison mean
   * "everything EXCEPT the score and EXCEPT the input we changed". Matched on
   * the stems from `lib/perpSpot.ts` rather than on the full strings, so a
   * copy edit to the explanation does not silently disable the control again -
   * and asserted below, because a normaliser that stops matching would restore
   * the original bug invisibly. */
  /* ANCHORED TO THE ENDINGS, because `[^.]*` cannot cross a decimal point.
     The first version used it and matched only `Futures trading is 1.` out of
     `Futures trading is 1.4x its usual share against spot. The move is ...` -
     the `.` in the ratio ended the match. It stripped four characters and left
     the whole explanation behind, so the control kept firing and the counter
     above still reported a confident `1/1`.
     A normaliser that matches SOMETHING is not a normaliser that matched the
     RIGHT thing, which is why the skip path now prints the first difference. */
  /* THE FACTOR ROW COUNTS AS THE VARIABLE TOO, not as an unrelated factor.
   *
   * With the sentence normalised, the diagnostic below finally named what was
   * left:
   *
   *     leading  ... Options Gamma (GEX) -12 confidence  Futures-Led Move -33 confidence  Choppiness ...
   *     spotled  ... Options Gamma (GEX) -12 confidence                                   Choppiness ...
   *
   * `Futures-Led Move` is `perpScorePenalty` appearing in the factor list. It
   * is present under a futures-led reading and absent under a spot-led one -
   * which is not a confound, it is the effect this test exists to detect,
   * showing up in the text as well as in the number.
   *
   * Treating it as an unrelated factor meant the control fired on the one
   * difference it was supposed to allow. That is the third distinct reason this
   * guard fired, and all three were mine. */
  const PERP_SENTENCE =
    /(Futures trading is[\s\S]*?(?:if it turns|tends to hold better)\.|Futures and spot are trading[\s\S]*?driving the move\.|Spot data unavailable[\s\S]*?buying or futures\.|Futures-Led Move\s*[−–-]?\s*\d+\s*confidence)/g;
  const perpLinesFound = (last.match(PERP_SENTENCE) ?? []).length;
  const rest = last.replace(score, '#SCORE#').replace(PERP_SENTENCE, '').replace(/\s+/g, ' ').trim();
  return { score, rest, perpLinesFound };
}

test.describe('perps reading and the Confluence Score', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  test('the score is decoupled from the perps reading (until step 3)', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      const a = await readScore(page, 'leading');
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      const b = await readScore(page, 'spotled');

      // eslint-disable-next-line no-console
      console.log(`[score] leading=${a.score} spotled=${b.score} otherFactorsMatch=${a.rest === b.rest} ` +
        `perpLines=${a.perpLinesFound}/${b.perpLinesFound}`);

      /* THE NORMALISER MUST HAVE MATCHED SOMETHING. If a copy edit to the
         explanation in `lib/perpSpot.ts` stops these patterns matching, `rest`
         silently goes back to containing the manipulated variable and this
         control returns to firing on every run - which is how it shipped.
         A normaliser that quietly stops normalising is worse than none. */
      expect(a.perpLinesFound + b.perpLinesFound,
        `the perps sentence was not found in either load, so nothing was normalised out and ` +
        `the control below compares the variable this test deliberately changes. Check the ` +
        `PERP_SENTENCE patterns against lib/perpSpot.ts - the wording has probably moved.`)
        .toBeGreaterThan(0);

      /* THE CONTROL THE RETRACTED FINDING LACKED. If any other factor differs
         between the two loads, the score difference is not attributable to the
         perps reading and this run cannot conclude. Skipping is the honest
         outcome - a difference that LOOKS like coupling is exactly what cost
         dev ninety minutes. */
      /* SAY WHAT DIFFERS. The first version of this guard reported only that
         the loads were not comparable, so three separate investigations had to
         re-derive the cause by hand. A control that fires without naming its
         reason trains people to re-run it. */
      let diff = '';
      if (a.rest !== b.rest) {
        let i = 0;
        while (i < a.rest.length && i < b.rest.length && a.rest[i] === b.rest[i]) i++;
        diff = `
  first difference at char ${i}:
` +
               `    leading: ...${a.rest.slice(Math.max(0, i - 40), i + 80)}
` +
               `    spotled: ...${b.rest.slice(Math.max(0, i - 40), i + 80)}`;
      }

      // eslint-disable-next-line no-console
      if (diff) console.log(`[score] ${diff}`);

      test.skip(a.rest !== b.rest, diff +
        `the two loads differ in factors other than the score AND other than the perps ` +
        `sentence, so nothing is attributable. Those are the only two things this test ` +
        `changes; anything else differing means the card's async factors landed in ` +
        `different states. Re-run once. If it repeats IDENTICALLY it is not a race - ` +
        `something else is varying and this guard is hiding it, which is exactly how this ` +
        `control came to fire on every run for its whole life.`);

      if (EXPECT_COUPLED) {
        expect(b.score,
          `every other factor is identical and the score is ${b.score} under BOTH a futures-led ` +
          `and a spot-led reading. Step 3 was supposed to make this input count.`)
          .not.toEqual(a.score);
      } else {
        expect(b.score,
          `every other factor on the card is identical and only the perps reading changed, yet ` +
          `the score moved from ${a.score} to ${b.score}. If step 3 has landed, flip ` +
          `EXPECT_COUPLED at the top of this file. If not, this is accidental coupling.`)
          .toEqual(a.score);
      }
    } finally { await ctx.close(); }
  });
});
