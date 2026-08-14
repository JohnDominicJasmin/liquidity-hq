import { test, expect } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { gotoGuarded } from './_shared';
import { CONVERTED_ROUTES } from './_design-tokens';
import { DESIGN_STORAGE_KEY } from '@/lib/designMode';

/* Does the redesign LOSE anything? (owner, in session)
 *
 *     "make sure we dont lose any UI components, yes we have new design but i
 *      dont ask you to remove something, i just want you to move UI or just
 *      putting it to another places or simplifying the words"
 *     "put it in your criteria when checking you should be checking if UI
 *      components are removed"
 *
 * Every other spec in this suite asks whether what is on the screen matches the
 * design. **None of them asks what USED to be there and is now gone.** A screen
 * can be pixel-perfect against its frame and still have quietly dropped a
 * control that people relied on — and the frame cannot tell you, because the
 * frame is not a list of everything the product does.
 *
 * PRODUCTION IS THE BASELINE, at the owner's suggestion, and it is the right
 * one: `dev` moves under us all day, so a diff against it measures whatever
 * landed in the last hour. Production is the last state a user actually had.
 *
 *     "yes you can compare it with prod to make things easy and spot it"
 *
 * WHAT COUNTS AS LOSS. Links by href, buttons by label, headings by text. Those
 * are the things a person notices missing. **Moved is fine, reworded is fine** —
 * the owner said so explicitly — so this compares SETS, not positions, and
 * normalises whitespace and case.
 *
 * WHAT THIS CANNOT SEE. A control that survives with a different label reads as
 * one lost plus one gained; a feature behind a tab that the sweep never opens
 * looks absent on both sides. It finds disappearances, not regressions in
 * behaviour — that is the functional pass, separately.
 */

const PROD = 'https://liquidity-hq.com';

interface Inventory { links: string[]; buttons: string[]; headings: string[] }

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 48);

async function inventory(browser: Browser, url: string, terminal: boolean): Promise<Inventory | null> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(([k, on]: [string, string]) => {
    try {
      localStorage.setItem('lhq_analytics_consent_v1', 'denied');
      if (on === '1') localStorage.setItem(k, 'terminal');
    } catch { /* private mode */ }
  }, [DESIGN_STORAGE_KEY, terminal ? '1' : '0'] as [string, string]);
  const page = await ctx.newPage();
  page.on('dialog', d => d.dismiss());
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(4000);
    const inv = await page.evaluate(() => {
      const n = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 48);
      const main = document.querySelector('main') ?? document.body;
      return {
        links: [...main.querySelectorAll('a[href]')]
          .map(a => a.getAttribute('href') ?? '').filter(Boolean),
        buttons: [...main.querySelectorAll('button')]
          .map(b => n(b.textContent ?? '') || '(icon)'),
        headings: [...main.querySelectorAll('h1,h2,h3')].map(h => n(h.textContent ?? '')),
      };
    });
    return inv;
  } catch {
    return null;
  } finally {
    await ctx.close();
  }
}

test.describe('the redesign loses nothing', () => {
  for (const route of CONVERTED_ROUTES) {
    test(`${route} keeps every control production has`, async ({ browser }) => {
      test.setTimeout(240_000);

      const before = await inventory(browser, `${PROD}${route}`, false);

      /* A PRODUCTION FETCH THAT FAILED IS NOT AN EMPTY PRODUCTION PAGE.
       * Skipping is the honest outcome - if prod is unreachable this run has
       * measured nothing, and reporting "nothing lost" would be a lie told by
       * a network error. */
      test.skip(before === null || before.links.length + before.headings.length === 0,
        `could not read ${PROD}${route}, so there is no baseline to compare against. ` +
        `This run measured nothing rather than finding nothing.`);

      const base = process.env.E2E_BASE_URL ?? 'http://localhost:3100';
      const after = await inventory(browser, `${base}${route}?design=terminal`, true);
      expect(after, `could not render ${route} locally in terminal mode`).not.toBeNull();

      const lost = (a: string[], b: string[]) => [...new Set(a.filter(x => !b.includes(x)))];

      const linksLost = lost(before!.links, after!.links);
      const buttonsLost = lost(before!.buttons, after!.buttons);
      const headingsLost = lost(before!.headings, after!.headings);

      const report =
        `\nproduction → terminal, ${route}\n` +
        `  links     ${before!.links.length} → ${after!.links.length}\n` +
        `  buttons   ${before!.buttons.length} → ${after!.buttons.length}\n` +
        `  headings  ${before!.headings.length} → ${after!.headings.length}\n`;

      expect({ linksLost, buttonsLost, headingsLost },
        `The redesign DROPPED things production has. The owner's rule is that the ` +
        `redesign moves, re-places and simplifies — it does not remove.${report}\n` +
        `If any of these is deliberate, it needs the owner's word, not a reviewer's ` +
        `assumption. If a control was RENAMED it shows here as lost — say so and ` +
        `this list is the record of the rename rather than a defect.`)
        .toEqual({ linksLost: [], buttonsLost: [], headingsLost: [] });
    });
  }

  test('the comparison is not vacuous (guards against an empty baseline)', async ({ browser }) => {
    test.setTimeout(120_000);
    /* Everything above is "nothing lost", which is also what a broken fetch
     * returns. This proves production answers with a real page - so a clean
     * run above means "compared and found nothing" rather than "never looked".
     * The suite has produced the second kind twice; it does not get to again. */
    const prod = await inventory(browser, `${PROD}/`, false);
    expect(prod, `${PROD} did not respond; every comparison in this file is void`).not.toBeNull();
    expect(prod!.links.length + prod!.headings.length,
      `${PROD} responded but rendered no links or headings, so it is not a usable ` +
      `baseline. A "nothing lost" result elsewhere in this file would be meaningless.`)
      .toBeGreaterThan(3);
  });
});
