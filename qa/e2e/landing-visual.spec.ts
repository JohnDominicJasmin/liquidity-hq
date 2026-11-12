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

  /* The cell that would have caught the 768 clip (PM, 2026-11-12): the hero LIVE READ panel's right
     edge was PAST the viewport at 768, which a page-level `scrollWidth` check cannot see - clipped
     (overflow-hidden) content does not grow scrollWidth. So measure the panel's own bounding box and
     assert it sits inside the viewport. The panel is an inline-styled div with no class, so it is
     located by its "Live read ·" header text and walked up to its bordered container. */
  for (const width of [768, 1024, 1280]) {
    test(`the hero LIVE READ panel is not clipped at ${width}px`, async ({ browser }) => {
      /* EXPECTED-FAIL AT 768 until Dev's fix lands (filed on #1185, group-2). The panel is clipped
         at the right edge at 768; test.fail keeps it red-by-design and flips the gate the moment the
         fix makes it pass, which is the cue to re-shoot. 1024 and 1280 are real assertions. */
      test.fail(width === 768, 'known: the LIVE READ panel is clipped at 768 (#1185, Dev fixing)');
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage();
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.locator('.lp-hero-h1').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(2500);
      const box = await page.evaluate(() => {
        const header = [...document.querySelectorAll('span')].find(s => /live read\s*·/i.test(s.textContent || ''));
        if (!header) return null;
        // Walk up to the bordered panel container (the div that owns the 1px border).
        let el: HTMLElement | null = header as HTMLElement;
        for (let i = 0; i < 6 && el; i += 1) {
          const cs = getComputedStyle(el);
          if (cs.borderTopWidth !== '0px' && el.getBoundingClientRect().width > 200) break;
          el = el.parentElement;
        }
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width, vw: window.innerWidth };
      });
      expect(box, `could not locate the LIVE READ panel at ${width}px`).not.toBeNull();
      expect(box!.right,
        `the LIVE READ panel's right edge (${Math.round(box!.right)}) is past the ${box!.vw}px viewport - it is clipped. `
        + `left=${Math.round(box!.left)} width=${Math.round(box!.width)}. A page scrollWidth check cannot see this because the overflow is hidden.`)
        .toBeLessThanOrEqual(box!.vw + 1);
      await ctx.close();
    });
  }
});
