import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';

/* Does the Perps vs Spot card read the LAST CLOSED hour? (#328, dev's PR #333)
 *
 * This is the property that failed. The card took its ratio from
 * `paired[paired.length - 1]` - the still-forming hour - while the baseline it
 * was compared against was a median of 167 COMPLETE hours. Measured against
 * Binance two minutes into an hour:
 *
 *     FORMING bar   spot  1.6M  perp  15.7M  ratio  9.76  relative 1.26x -> balanced
 *     LAST CLOSED   spot 48.9M  perp 539.0M  ratio 11.01  relative 1.42x -> PERP-LED
 *
 * Same coin, same instant, opposite verdicts. Dev fixed it in 2078d27 with
 * `dropForming` - the same helper from #316, which was the same bug in the
 * chart signals.
 *
 * WHY A LIVE RUN CANNOT TEST THIS. The defect only shows when the forming bar
 * and the last closed bar disagree, and on real data that is a coincidence of
 * timing: run this at :55 past the hour against live Binance and the two agree,
 * so a broken build passes. It also only reproduces at all in the early minutes
 * of an hour. A test that depends on WHEN it runs is not a test.
 *
 * So the fixture is built so the two bars DISAGREE BY CONSTRUCTION:
 *
 *     166 closed bars   ratio 10   the baseline
 *     last closed bar   ratio 14   relative 1.40x  -> FUTURES LEADING
 *     forming bar       ratio 10   relative 1.00x  -> NORMAL
 *
 * Reading the closed bar gives FUTURES LEADING. Reading the forming bar gives
 * NORMAL. One fixture, two possible answers, and only one of them is right.
 *
 * VERIFIED BY WATCHING IT FAIL, which is the only evidence a regression test
 * works: this reported NORMAL against the pre-fix build and FUTURES LEADING
 * after. I shipped a test earlier today that passed on a build without the fix
 * in it, so that check is now the standard rather than the exception.
 */

const KLINES = '**/api/market/klines**';
const HOUR = 3_600_000;
const CARD = '[data-testid="perp-spot-card"]';

/**
 * One Binance kline row. Only index 0 (open time) and index 7 (quote volume)
 * are read by the card; the rest are filled with plausible values rather than
 * zeros so nothing downstream divides by one.
 */
const bar = (time: number, quoteVolume: number) =>
  [time, '60000', '60500', '59500', '60000', '100', time + HOUR - 1,
    String(quoteVolume), 1000, '50', String(quoteVolume / 2), '0'];

/**
 * Build 168 hourly bars: a flat baseline, one closed bar that moves, and a
 * forming bar that does not.
 *
 * `perpLast` sets the ratio of the LAST CLOSED bar - the one the card should
 * be reading. `perpForming` sets the forming bar, which it should ignore.
 */
function series(opts: { perpLast: number; perpForming: number }) {
  const forming = Math.floor(Date.now() / HOUR) * HOUR;   // current, incomplete
  const spot: unknown[][] = [];
  const perp: unknown[][] = [];

  for (let i = 167; i >= 2; i--) {
    const t = forming - i * HOUR;
    spot.push(bar(t, 10_000_000));
    perp.push(bar(t, 100_000_000));                       // ratio 10 - the baseline
  }
  const lastClosed = forming - HOUR;
  spot.push(bar(lastClosed, 10_000_000));
  perp.push(bar(lastClosed, opts.perpLast));

  spot.push(bar(forming, 300_000));                       // ~3% of an hour, as measured
  perp.push(bar(forming, opts.perpForming));

  return { spot, perp };
}

/**
 * Serve the fixture for the perps card only.
 *
 * The card asks for `interval=1h&limit=168`. Other components hit this same
 * route with other intervals and limits - tf-gating pins `interval=15` - so
 * anything that is not this exact request is passed through untouched. A
 * blanket intercept here would silently rewrite the chart on the same page.
 */
async function pinBars(page: Page, opts: { perpLast: number; perpForming: number }) {
  const { spot, perp } = series(opts);
  await page.route(KLINES, async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('interval') !== '1h' || url.searchParams.get('limit') !== '168') {
      return route.continue();
    }
    const futures = url.searchParams.get('source') === 'binance-futures';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(futures ? perp : spot),
    });
  });
}

async function cardText(page: Page): Promise<string> {
  await gotoSignedIn(page, '/dashboard');
  const card = page.locator(CARD).first();
  /* POSITIVE CONTROL. Every assertion below is about text inside this card, so
     a dashboard that never rendered it would satisfy the negative ones for free
     - the trap that produced four meaningless green results on the Confluence
     card before anyone noticed it was Pro-gated. */
  await expect(card, 'the Perps vs Spot card is not on the dashboard - this run measured nothing')
    .toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);                 // the fetch resolves after mount
  return (await card.innerText()).replace(/\s+/g, ' ');
}

test.describe('Perps vs Spot reads the last CLOSED hour', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  test('THE REGRESSION: a moving closed bar wins over a quiet forming bar', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      /* Closed bar ratio 14 -> relative 1.40 -> FUTURES LEADING.
         Forming bar ratio 10 -> relative 1.00 -> NORMAL. */
      await pinBars(page, { perpLast: 140_000_000, perpForming: 3_000_000 });
      const text = await cardText(page);

      expect(text,
        `the card is reading the still-forming hour. The last CLOSED hour ran at 1.40x its ` +
        `own normal, which is past the 1.30 threshold the owner approved, but the card reports ` +
        `what the incomplete bar says. At two minutes past the hour that bar holds ~3% of an ` +
        `hour's volume. Card: ${text}`)
        .toMatch(/FUTURES LEADING/i);
    } finally { await ctx.close(); }
  });

  test('THE MIRROR: it is not just always saying FUTURES LEADING', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      /* Same shape, opposite direction. Closed bar ratio 7 -> relative 0.70 ->
         SPOT LEADING, under the 0.75 threshold. Without this, a build that
         hardcoded "FUTURES LEADING" would pass the test above. */
      await pinBars(page, { perpLast: 70_000_000, perpForming: 100_000_000 });
      const text = await cardText(page);
      expect(text,
        `a closed bar at 0.70x its own normal is past the SPOT_LED_AT threshold and should ` +
        `read SPOT LEADING. Card: ${text}`)
        .toMatch(/SPOT LEADING/i);
    } finally { await ctx.close(); }
  });

  test('CONTROL: a genuinely quiet series stays NORMAL', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      /* Every bar at the baseline. A card that shouted on ordinary data would
         be worse than the bug - users learn to ignore a permanent warning, the
         same reason econ-staleness pins the fresh case. */
      await pinBars(page, { perpLast: 100_000_000, perpForming: 3_000_000 });
      const text = await cardText(page);
      expect(text,
        `nothing is happening in this series and the card claims a lean. Card: ${text}`)
        .toMatch(/NORMAL/i);
      expect(text, 'a quiet series produced a lean verdict').not.toMatch(/FUTURES LEADING|SPOT LEADING/i);
    } finally { await ctx.close(); }
  });

  test('a coin with no spot market says CANNOT MEASURE, not a number', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      /* The single-number risk dev and I both flagged: with one figure there is
         nowhere for a missing half to surface, so an unanswerable question
         renders as though it had been answered. Spot fails, perp succeeds. */
      await page.route(KLINES, async route => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('interval') !== '1h' || url.searchParams.get('limit') !== '168') {
          return route.continue();
        }
        if (url.searchParams.get('source') === 'binance-futures') {
          const { perp } = series({ perpLast: 140_000_000, perpForming: 3_000_000 });
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(perp) });
        }
        return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no such symbol"}' });
      });

      const text = await cardText(page);
      expect(text,
        `the spot side is unavailable and the card rendered a verdict anyway. The perp side ` +
        `alone cannot answer "is this real buying" - a number here reads as measured when ` +
        `nothing was measured. Card: ${text}`)
        .toMatch(/CANNOT MEASURE/i);
      expect(text, 'a number was shown for a reading that could not be taken')
        .not.toMatch(/\d+\.\d+x/);
    } finally { await ctx.close(); }
  });
});
