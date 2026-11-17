/* #2517 UPGRADE PAGE + LANDING PRICING: the Nightcrawler quote under the headline and the new rows (Free +2, Pro +4) must fit at 390 px in every locale. Signed out, read only.
 *   gh workflow run ci.yml --ref <branch> -f e2e=true [-f base_url=<url>] -f project=desktop -f screenshots=true -f "spec=qa/e2e/upgrade-pricing-2517.spec.ts"
 *   UP:<path>:<lang>:<theme>   /upgrade and "/" (landing pricing) at 390 and 1280 in en / ko / zh / ru and the stored-preference ar fallback, light and dark: no sideways scroll (docW == viewport), no element past the right edge, no clipped text in the quote or a plan row, the quote and the rows are present (counts printed), every plan row inside the viewport
 * One [PRICING] JSON line per cell; screenshots qa/.shots/pricing-<path>-<lang>-<theme>-<width>.png. */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { settleForShot } from './_settle';

mkdirSync('qa/.shots', { recursive: true });
const LANGS = ['en', 'ko', 'zh', 'ru', 'ar'] as const;
for (const path of ['/upgrade', '/'] as const) for (const lang of LANGS) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280] as const) {
  if (width === 1280 && (lang === 'ar' || theme === 'dark')) continue;
  const title = `UP:${path}:${lang}:${theme}:${width}`;
  test(title, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
    await ctx.addInitScript(([l, t]) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('theme', t); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [lang, theme]);
    const page = await ctx.newPage();
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 }); await page.waitForTimeout(12_000);
      if (path === '/') await page.locator('#pricing, [id*="pricing" i], section:has-text("Pro")').first().scrollIntoViewIfNeeded().catch(() => {});
      const m = await page.evaluate(() => {
        const vw = window.innerWidth, doc = document.documentElement.scrollWidth;
        const fixedUp = (e: HTMLElement) => { for (let p: HTMLElement | null = e; p && p !== document.body; p = p.parentElement) { const pos = getComputedStyle(p).position; if (pos === 'fixed' || pos === 'sticky') return true; } return false; };
        const past = (Array.from(document.querySelectorAll('body *')) as HTMLElement[]).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !fixedUp(e) && r.right > vw + 1; });
        const quote = (Array.from(document.querySelectorAll('blockquote, q, p, div, span')) as HTMLElement[]).filter((e) => /nightcrawler/i.test(e.innerText || '') && (e.innerText || '').length < 400 && !Array.from(e.children).some((c) => /nightcrawler/i.test((c as HTMLElement).innerText || '')));
        const rows = (Array.from(document.querySelectorAll('li')) as HTMLElement[]).filter((e) => e.closest('[class*="pricing" i], [class*="plan" i], [class*="upgrade" i], section, main') && (e.innerText || '').trim().length > 3);
        const clip = [...quote, ...rows].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible').map((e) => (e.innerText || '').slice(0, 50));
        const q0 = quote[0]?.getBoundingClientRect();
        return { vw, doc, past: past.length, pastList: past.slice(0, 4).map((e) => `${e.tagName.toLowerCase()}.${typeof e.className === 'string' ? e.className.split(' ')[0] : ''} right=${Math.round(e.getBoundingClientRect().right)}`), quotes: quote.length, quoteText: (quote[0]?.innerText || '').replace(/\s+/g, ' ').slice(0, 90), quoteBox: q0 ? { l: Math.round(q0.left), r: Math.round(q0.right) } : null, rows: rows.length, clip };
      });
      console.log(`[PRICING] ${JSON.stringify({ title, ...m })}`);
      await settleForShot(page, title).catch(() => {}); await page.screenshot({ path: `qa/.shots/pricing-${path === '/' ? 'landing' : 'upgrade'}-${lang}-${theme}-${width}.png`, fullPage: true, timeout: 25_000 }).catch(() => {});
      expect(m.doc, `${path} is ${m.doc}px wide in a ${m.vw}px viewport (${lang}): ${m.pastList.join(' | ')}`).toBeLessThanOrEqual(m.vw);
      expect(m.past, `${m.past} elements sit past the right edge (${lang}): ${m.pastList.join(' | ')}`).toBe(0);
      expect(m.clip, `clipped text in the quote or a plan row (${lang}): ${JSON.stringify(m.clip)}`).toEqual([]);
      expect(m.quotes, `the Nightcrawler quote is not on ${path} (${lang})`).toBeGreaterThan(0);
    } finally { await ctx.close(); }
  });
}
