/* #1185 item 28: the landing hero and its Live Read panel between 1024 and 1280. 768-1024 is already proven (PM-signed shots);
 * 1100 and 1160 are the widths in between where the tablet stack gives way to the side-by-side layout.
 *
 * Anonymous, nothing stubbed. At each width: the hero section and the Live Read panel do not scroll inside themselves
 * (scrollWidth <= clientWidth), and the document does not scroll sideways (scrollWidth <= innerWidth). 1024 and 1280 are in the
 * list as controls that must also hold, so a harness fault shows up as a failure at a width already proven. */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const DIR = 'qa/.shots';

for (const width of [1024, 1100, 1160, 1280]) {
  test(`landing hero and Live Read panel fit at ${width}px`, async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.locator('.lp-hero-h1').first().waitFor({ state: 'visible', timeout: 30_000 });
      await page.getByText(/^Live read ·/).first().waitFor({ state: 'visible', timeout: 30_000 });
      await page.waitForTimeout(4_000);

      const m = await page.evaluate(() => {
        const h1 = document.querySelector('.lp-hero-h1') as HTMLElement | null;
        const hero = (h1?.closest('section') ?? h1?.parentElement?.parentElement) as HTMLElement | null;
        const label = Array.from(document.querySelectorAll('span')).find(s => /^Live read ·/.test(s.textContent ?? '')) as HTMLElement | undefined;
        const panel = (label?.parentElement?.parentElement ?? null) as HTMLElement | null;
        const box = (el: HTMLElement | null) => el && { sw: el.scrollWidth, cw: el.clientWidth, w: Math.round(el.getBoundingClientRect().width), r: Math.round(el.getBoundingClientRect().right) };
        return { hero: box(hero), panel: box(panel), doc: { sw: document.documentElement.scrollWidth, iw: window.innerWidth } };
      });
      console.log(`[hero-width] ${width}px hero=${JSON.stringify(m.hero)} panel=${JSON.stringify(m.panel)} doc=${JSON.stringify(m.doc)}`);
      mkdirSync(DIR, { recursive: true });
      await page.screenshot({ path: `${DIR}/landing-hero-${width}.png` });

      expect(m.hero, 'the hero section was not found').not.toBeNull();
      expect(m.panel, 'the Live Read panel was not found').not.toBeNull();
      expect(m.hero!.sw, `the hero scrolls inside itself at ${width}px (${m.hero!.sw} > ${m.hero!.cw})`).toBeLessThanOrEqual(m.hero!.cw);
      expect(m.panel!.sw, `the Live Read panel scrolls inside itself at ${width}px (${m.panel!.sw} > ${m.panel!.cw})`).toBeLessThanOrEqual(m.panel!.cw);
      expect(m.panel!.r, `the Live Read panel's right edge (${m.panel!.r}) is past the viewport at ${width}px`).toBeLessThanOrEqual(m.doc.iw);
      expect(m.doc.sw, `the page scrolls sideways at ${width}px (${m.doc.sw} > ${m.doc.iw})`).toBeLessThanOrEqual(m.doc.iw);
    } finally { await ctx.close(); }
  });
}
