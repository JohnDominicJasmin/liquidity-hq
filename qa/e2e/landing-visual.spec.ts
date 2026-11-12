/* Group-2 visual evidence for PM's sign-off, captured on a GitHub runner (never the owner's
 * laptop). The landing page, signed OUT, at 390/768/1280 in light and dark, with the hero clock and
 * the Setup row visible. Any email on the page is masked - the repo and its artifacts are public.
 *
 * Writes to qa/.shots; the dispatch uploads that as a 1-day artifact when `screenshots` is on:
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/landing-visual.spec.ts \
 *     -f base_url=https://liquidity-hq-qa.onrender.com -f screenshots=true -f project=desktop
 */
import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOT_DIR = 'qa/.shots';
const WIDTHS = [390, 768, 1280];
const THEMES = ['dark', 'light'] as const;

test.describe('group-2 landing visual evidence (signed out)', () => {
  test.describe.configure({ timeout: 120_000 });

  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      test(`landing / signed out, ${width}px, ${theme}`, async ({ browser }) => {
        const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
        const page = await ctx.newPage();
        // Seed the theme before the first frame (same approach as _auth.ts), so the shot is the
        // theme we asked for rather than whatever hydration settles on.
        await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch { /* private mode */ } }, theme);
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        // Wait for the hero to paint (the clock renders after mount, so give it a moment), and the
        // Setup row below it.
        await page.locator('.lp-hero-h1').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(3500);
        mkdirSync(SHOT_DIR, { recursive: true });
        await page.screenshot({
          path: `${SHOT_DIR}/landing-${width}-${theme}.png`,
          fullPage: false,
          // MASK ANY EMAIL. The landing support email is public, but the rule is to blur any email
          // in a public artifact - so this masks the support-email element and any bare @-address.
          mask: [page.locator('[data-testid="landing-support-email"]'), page.locator('text=/@/')],
          maskColor: '#000000',
        });
        await ctx.close();
      });
    }
  }
});
