/* LABEL RENDER CHECK AT 390 (for the wordy-text PR #2545, BEFORE its DEV rows are applied): every page in English at 390 px, with /api/labels answered EMPTY so the page renders the label DEFAULTS in the build under test (that is the text the DEV rows will carry).
 * Per page: document width vs the viewport, the elements whose text is CUT (overflow hidden / clip and scrollWidth > clientWidth), and the elements whose right edge is past the viewport without a clipping ancestor. Run on the PR head and on dev, then compare: only a DIFFERENCE is a finding.
 * Asserts only the document width (no sideways scroll); prints everything else. */
import { test, expect } from '@playwright/test';
import { AUTH_READY, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

const OUT = ['/', '/about', '/faq', '/markets', '/dashboard', '/briefing', '/correlation', '/scanner', '/news', '/funding', '/liq', '/hours', '/upgrade', '/changelog'];
const PRO = ['/arena?coin=btc', '/alerts', '/settings', '/research', '/journal'];
const measure = () => {
  const vw = document.documentElement.clientWidth;
  const fixed = (el: Element) => { for (let a: Element | null = el; a && a !== document.documentElement; a = a.parentElement) if (getComputedStyle(a).position === 'fixed') return true; return false; };
  const clipAnc = (el: Element) => { for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) if (/hidden|clip|auto|scroll/.test(getComputedStyle(a).overflowX)) return true; return false; };
  const cut: string[] = []; const past: string[] = [];
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const h = el as HTMLElement; const r = h.getBoundingClientRect(); if (r.width < 4 || fixed(el)) continue; const txt = (h.innerText || '').replace(/\s+/g, ' ').trim(); if (!txt) continue;
    if (h.scrollWidth > h.clientWidth + 1 && /hidden|clip/.test(getComputedStyle(h).overflowX) && h.children.length < 4) cut.push(`${h.tagName.toLowerCase()}.${String(h.className).slice(0, 22)} "${txt.slice(0, 26)}" sw${h.scrollWidth}>cw${h.clientWidth}`);
    if (r.right > vw + 1 && !clipAnc(el)) past.push(`${h.tagName.toLowerCase()}.${String(h.className).slice(0, 22)} "${txt.slice(0, 22)}" r${Math.round(r.right)}`);
  }
  return { vw, doc: document.documentElement.scrollWidth, nCut: cut.length, cut: cut.slice(0, 14), nPast: past.length, past: past.slice(0, 6) };
};

for (const path of OUT) {
  test(`LR:out:${path}`, async ({ browser }) => {
    test.setTimeout(120_000); const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await ctx.newPage(); await installPaidAiFence(page); await page.route(/\/api\/labels(\?|$)/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    try { await page.goto(path, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(12_000); const m = await page.evaluate(measure); console.log(`[LR] out ${path}: ${JSON.stringify(m)}`); expect(m.doc, `${path} scrolls sideways (${m.doc} > ${m.vw}): ${m.past.join(' | ')}`).toBeLessThanOrEqual(m.vw); } finally { await ctx.close(); }
  });
}
for (const path of PRO) {
  test(`LR:pro:${path}`, async ({ browser }) => {
    test.skip(!AUTH_READY, 'no fixtures'); test.setTimeout(120_000); const ctx = await signedInContext(browser, 'a', { viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await ctx.newPage(); await installPaidAiFence(page); await page.route(/\/api\/labels(\?|$)/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    try { await gotoSignedIn(page, path); await page.waitForTimeout(12_000); const m = await page.evaluate(measure); console.log(`[LR] pro ${path}: ${JSON.stringify(m)}`); expect(m.doc, `${path} scrolls sideways (${m.doc} > ${m.vw}): ${m.past.join(' | ')}`).toBeLessThanOrEqual(m.vw); } finally { await ctx.close(); }
  });
}
