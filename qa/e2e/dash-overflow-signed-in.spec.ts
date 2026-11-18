/* STAGING/CI ONLY (signs in as the DEV fixtures): which element makes /dashboard scroll sideways at 390 px, signed in as Free and Pro, consent banner open and closed.
 * A culprit has its right edge past the viewport, no ancestor that clips it (overflow hidden / clip / auto / scroll) and is not in a fixed-position subtree. Prints, asserts nothing. */
import { test } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
test.skip(!AUTH_READY, AUTH_SKIP_REASON);
for (const who of ['a', 'b'] as const) for (const consent of ['open', 'closed'] as const) {
  test(`DO:${who === 'a' ? 'pro' : 'free'}:consent-${consent}: /dashboard at 390`, async ({ browser }) => {
    test.setTimeout(120_000); const ctx = await signedInContext(browser, who, { viewport: { width: 390, height: 844 } });
    await ctx.addInitScript((c) => { try { localStorage.setItem('lhq_lang_v1', 'en'); if (c === 'closed') localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, consent);
    const page = await ctx.newPage();
    try {
      await gotoSignedIn(page, '/dashboard'); await page.waitForTimeout(15_000);
      const m = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const clipped = (el: Element) => { for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.position === 'fixed') return true; if (/hidden|clip|auto|scroll/.test(cs.overflowX)) return true; } return getComputedStyle(el).position === 'fixed'; };
        const past = Array.from(document.querySelectorAll('body *')).map((el) => ({ el, r: el.getBoundingClientRect() })).filter((x) => x.r.width > 0 && x.r.right > vw + 1 && !clipped(x.el))
          .map((x) => ({ tag: x.el.tagName.toLowerCase(), cls: String((x.el as HTMLElement).className).slice(0, 40), text: ((x.el as HTMLElement).innerText || '').replace(/\s+/g, ' ').slice(0, 28), right: Math.round(x.r.right), w: Math.round(x.r.width) }));
        return { vw, doc: document.documentElement.scrollWidth, n: past.length, culprits: past.slice(0, 10) };
      });
      console.log(`[DASHOV] ${who === 'a' ? 'pro' : 'free'} consent-${consent}: ${JSON.stringify(m)}`);
    } finally { await ctx.close(); }
  });
}
