/* #2514 UPSELL COUNT (PM audit 2026-11-17: the same upsell said in many places). Counts the VISIBLE upsell strings per page and persona, listing each one, so the number can be compared with the production baseline (arena 10, research 9, alerts 5, dashboard 4) and with the target (<= 3 for Free and signed-out, 0 for Pro apart from the plan badge).
 *   gh workflow run ci.yml --ref <branch> -f e2e=true [-f base_url=<url>] -f project=desktop -f "spec=qa/e2e/upsell-count-2514.spec.ts"
 *   UC:<persona>:<page>   persona out | free | pro (free and pro sign in with the DEV fixtures: CI builds / staging only); page /arena?coin=hype, /arena?coin=btc, /research, /alerts, /dashboard; 1280 px, dark
 * WHAT COUNTS: a visible INNERMOST element (no child element that matches too) whose own text matches Upgrade / Unlock with Pro / PRO FEATURE / See Pro / "With Pro" / a bare "Pro" tag / "Pro only"; the header plan badge (.plan-badge*) is excluded. One [UPSELL] JSON line per cell: the count and every string with its tag, so a reader can disagree with the counting, not just the number.
 * ASSERTIONS: out and free <= 3, pro = 0. The cell prints the count first and asserts after, so a baseline run on production reads the numbers (the assertions then fail by design there). Nothing is clicked or saved. */
import { test, expect, type Page, type Browser } from '@playwright/test';
import { AUTH_READY, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';
test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: measures a deployed site (-f base_url=<site>); on the runner build the default suite must not run it (a long sweep once hit the 2 h cap)');

const PAGES = ['/arena?coin=hype', '/arena?coin=btc', '/research', '/alerts', '/dashboard'] as const;
const RX = /\bupgrade\b|\bunlock with pro\b|\bpro feature\b|\bsee pro\b|\bwith pro\b|\bpro only\b|^pro$/i;

const count = (page: Page) => page.evaluate((src) => {
  const rx = new RegExp(src, 'i'); const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0; };
  const own = (e: Element) => Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim();
  const all = Array.from(document.querySelectorAll('body *')).filter((e) => !e.closest('script,style,noscript,.sr-only,[aria-hidden="true"]'));
  const hits = all.filter((e) => vis(e) && rx.test(own(e)) && !e.closest('.plan-badge, .plan-badge-free-text, [class*="plan-badge"]'));
  const inner = hits.filter((e) => !hits.some((o) => o !== e && e.contains(o)));
  return inner.map((e) => ({ tag: e.tagName.toLowerCase(), cls: typeof (e as HTMLElement).className === 'string' ? (e as HTMLElement).className.split(' ')[0] : '', text: own(e).slice(0, 70) }));
}, RX.source);

async function open(browser: Browser, persona: 'out' | 'free' | 'pro') {
  const ctx = persona === 'out' ? await browser.newContext({ viewport: { width: 1280, height: 900 } }) : await signedInContext(browser, persona === 'free' ? 'b' : 'a', { viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  return ctx;
}

for (const persona of ['out', 'free', 'pro'] as const) for (const path of PAGES) {
  test(`UC:${persona}:${path}`, async ({ browser }) => {
    test.setTimeout(150_000); test.skip(persona !== 'out' && !AUTH_READY, 'the signed-in fixtures are not configured on this run');
    const ctx = await open(browser, persona); const page = await ctx.newPage();
    try {
      await installPaidAiFence(page);
      if (persona === 'out') await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 }); else await gotoSignedIn(page, path);
      await page.waitForTimeout(14_000);
      const hits = await count(page); console.log(`[UPSELL] ${JSON.stringify({ persona, path, count: hits.length, hits })}`);
      /* the Strategy panel's own "PRO" tag (span.strat-aux) is a plan label on a Pro-only feature, accepted by PM: it is not an upsell to a Pro user */
      if (persona === 'pro') expect(hits.filter((h) => !(h.cls === 'strat-aux' && /^PRO$/.test(h.text))).map((h) => h.text), `Pro sees upsell strings on ${path}`).toEqual([]); else expect(hits.length, `${persona} sees ${hits.length} upsell strings on ${path} (target <= 3): ${hits.map((h) => h.text).join(' | ')}`).toBeLessThanOrEqual(3);
    } finally { await ctx.close(); }
  });
}
