import { test, expect, type Page } from '@playwright/test';
import { gotoGuarded } from './_shared';

/* Arena signals: computed on CLOSED candles, and refreshed without a reload. (#316)
 *
 * Three findings sat behind the owner's one-line report, and the fix addresses
 * all three:
 *
 *   cause      the chart holds a live socket the signal path could not see
 *              (KLineProChart 7 socket refs, useEMAStrategy 0)
 *   mechanism  signals recomputed on a fixed 5-minute timer and nothing else
 *   amplifier  the server candle cache adds up to 15 min on 4h and 1d
 *
 * And the decision underneath: signals fire on closed candles only. The reason
 * that settled it is visible on the card - `simulateTrades` scores the win/loss
 * record over historical CLOSED bars while the live signal was computed over the
 * still-forming one, so two numbers sat side by side computed on different
 * bases with nothing announcing the mismatch.
 *
 * WHAT THIS ASSERTS is the PROPERTY, not the mechanism. Dev's unit tests pin
 * `dropForming` / `msUntilNextClose` / `sameCandle` directly; those are the
 * right home for the maths. This asserts what survives whatever is built
 * underneath: the rendered signal does not repaint, and it arrives without a
 * reload.
 */

const CARD = /EMA RIBBON STRATEGY/i;

/** Read the strategy verdict as rendered, scoped to its own card. */
async function verdict(page: Page): Promise<string> {
  /* .first(), not .last(). `.last()` picks the innermost matching div - the
     heading fragment - whose text carries the card title but not the verdict
     below it, so the control failed with "the card is present but says
     nothing". The outermost match is the whole card. */
  const card = page.locator('div').filter({ hasText: CARD }).first();
  await expect(card, 'the EMA ribbon card did not render - nothing below is meaningful')
    .toBeVisible({ timeout: 25_000 });
  /* No slice. The outermost matching div starts at the page wrapper, so the
     first N characters are navigation - truncating there hid the verdict and
     the control failed with "the card is present but says nothing". */
  return (await card.innerText()).replace(/\s+/g, ' ');
}

/** The verdict word, which is what must not flip mid-candle. */
/* UPPERCASED before comparison. The card renders the verdict in two places
   with different casing - one raw, one CSS-uppercased - so a raw comparison
   reported "Mixed -> MIXED" as a change across a reload. A case difference is
   not a repaint. */
const verdictWord = (t: string) =>
  ((/TRENDING (LONG|SHORT)|CHOPPY|MIXED|FREEZE/i.exec(t) || [])[0] ?? '(none)').toUpperCase();

test.describe('signal freshness', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
    });
  });

  test('CONTROL: the strategy card renders a verdict at all', async ({ page }) => {
    /* Every assertion below reads this card. If it stopped rendering, a
       "verdict did not change" check would pass on an empty page - the
       empty-result trap that produced four meaningless results on the
       econ-staleness spec earlier. */
    await gotoGuarded(page, '/arena');
    await page.waitForTimeout(9000);
    const t = await verdict(page);
    expect(verdictWord(t),
      'no strategy verdict rendered - the card is present but says nothing').not.toBe('(none)');
  });

  test('the verdict does NOT repaint within a single candle', async ({ page }) => {
    /* THE PROPERTY THE DECISION WAS ABOUT. A signal computed over the forming
       bar can flip and flip back inside one candle period, and the value shown
       was never a value the candle closed at.
     *
     * Sampled across ~2 minutes on the 1h chart - far inside one candle, so a
     * correct build cannot legitimately change its verdict here. On the old
     * build the poll fired mid-candle and could return a different answer from
     * the same unclosed bar. */
    test.setTimeout(240_000);
    await gotoGuarded(page, '/arena');
    await page.waitForTimeout(9000);

    const first = verdictWord(await verdict(page));
    expect(first, 'no verdict to compare against').not.toBe('(none)');

    const seen = new Set([first]);
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(30_000);
      seen.add(verdictWord(await verdict(page)));
    }

    expect([...seen],
      `the verdict changed ${seen.size} times inside a single 1h candle: ${[...seen].join(' -> ')}. ` +
      `A closed-candle signal cannot change until a candle closes, so this is a repaint.`)
      .toHaveLength(1);
  });

  test('the signal survives a reload unchanged - no refresh-only state', async ({ page }) => {
    /* The owner's exact complaint inverted. They saw a marker appear only AFTER
       refreshing, which means the rendered state and the post-reload state
       disagreed. If a reload inside one candle produces a different verdict,
       something is still being computed at mount that is not being computed
       live. */
    test.setTimeout(180_000);
    await gotoGuarded(page, '/arena');
    await page.waitForTimeout(9000);
    const before = verdictWord(await verdict(page));
    expect(before, 'no verdict before reload').not.toBe('(none)');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(9000);
    const after = verdictWord(await verdict(page));

    expect(after,
      `the verdict changed across a reload within one candle: ${before} -> ${after}. ` +
      `That is the owner's report - state that only appears once the page is rebuilt.`)
      .toBe(before);
  });
});
