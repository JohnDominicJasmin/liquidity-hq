/* QA's measurements for the STILL-OPEN rows of the 2026-11-14 release tick list (#2292), on a live build. Expectations come from the tracker text.
 *   H1  #1185 B6/B9  the landing hero at 768, 1024, 1100 and 1160, light and dark: page not wider than the viewport, the LIVE READ panel and its STOP / TARGET columns inside the viewport,
 *                    and the two hero CTAs each on one line; shots at 768 and 1100
 *   J1  #1185 B2/B3  first paint with scripts OFF (what the server HTML paints before the first tick): /hours shows the placeholder clock and no needle, /dashboard's Day cell is a placeholder
 *   P1  #1185 B3     /upgrade as the Pro fixture (account A): no checkout button is ever shown while the plan loads (a MutationObserver watches from the first node)
 *   F1  #1185 B1     the Ask AI button against every control: at 390/641/768/1100/1280 and scroll 0/400/1200 on /playbook, /dashboard and /arena, the controls it covers by 20% or more
 *                    are LISTED (name, share); the named ones (BOOK tab, /playbook star, dashboard "new play") are flagged. The cell prints and fails on any named control covered
 * Signed out except P1 (account A, read only). A cell that finds nothing to measure fails. */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { gotoGuarded } from './_shared';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';

mkdirSync('qa/.shots', { recursive: true });
async function open(browser: Browser, width: number, theme: 'dark' | 'light' = 'dark', o: { js?: boolean; height?: number } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: o.height ?? 900 }, javaScriptEnabled: o.js ?? true });
  await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, theme);
  await ctx.routeWebSocket(/binance\.com/, () => { /* silent */ });
  return ctx;
}

/* ---------- H1 ---------- */
for (const width of [768, 1024, 1100, 1160]) for (const th of ['dark', 'light'] as const) {
  test(`H1. landing hero at ${width} ${th}: nothing clipped, CTAs on one line`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await open(browser, width, th); const page = await ctx.newPage();
    try {
      await gotoGuarded(page, '/'); await page.waitForTimeout(10_000);
      const m = await page.evaluate(() => {
        const vw = window.innerWidth;
        const byText = (re: RegExp) => Array.from(document.querySelectorAll('span,div,th,td,p,a,button')).filter(e => e.children.length === 0 && re.test((e.textContent || '').trim()) && (e as HTMLElement).offsetParent !== null) as HTMLElement[];
        const panelTitle = byText(/LIVE READ/i)[0] || null;
        const panel = panelTitle ? (panelTitle.closest('div[style*="flex-shrink"], div[style*="flexShrink"]') as HTMLElement | null) || (panelTitle.parentElement?.parentElement as HTMLElement | null) : null;
        const pr = panel ? panel.getBoundingClientRect() : null;
        const stop = byText(/^STOP$/i)[0], tgt = byText(/^TARGET$/i)[0];
        const cta = Array.from(document.querySelectorAll('a,button')).filter(e => /START FOR FREE|SEE LIVE BRIEFING/i.test((e.textContent || '').trim())) as HTMLElement[];
        return {
          docSw: document.documentElement.scrollWidth, vw,
          panel: pr ? { l: Math.round(pr.left), r: Math.round(pr.right), w: Math.round(pr.width) } : null,
          stopRight: stop ? Math.round(stop.getBoundingClientRect().right) : null, tgtRight: tgt ? Math.round(tgt.getBoundingClientRect().right) : null,
          ctas: cta.map(c => { const r = c.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(c).lineHeight) || parseFloat(getComputedStyle(c).fontSize) * 1.3; return { t: (c.textContent || '').trim().slice(0, 24), h: Math.round(r.height), lines: Math.round((r.height - 2 * (parseFloat(getComputedStyle(c).paddingTop) || 0)) / lh * 10) / 10 }; }),
        };
      });
      console.log(`[H1] ${width} ${th} ${JSON.stringify(m)}`);
      if (width === 768 || width === 1100) await page.screenshot({ path: `qa/.shots/hero-${width}-${th}.png`, fullPage: false });
      expect(m.panel, 'the LIVE READ panel was not found: nothing measured').not.toBeNull();
      expect(m.docSw, `page scrolls sideways at ${width}`).toBeLessThanOrEqual(m.vw);
      expect(m.panel!.r, `the LIVE READ panel runs past the viewport (right ${m.panel!.r} vs ${m.vw})`).toBeLessThanOrEqual(m.vw + 1);
      expect(m.stopRight, 'STOP column not found').not.toBeNull(); expect(m.stopRight!).toBeLessThanOrEqual(m.vw);
      expect(m.tgtRight, 'TARGET column not found').not.toBeNull(); expect(m.tgtRight!).toBeLessThanOrEqual(m.vw);
      expect(m.ctas.length, 'the two hero CTAs were not found').toBeGreaterThanOrEqual(2);
      for (const c of m.ctas) expect(c.lines, `CTA "${c.t}" wraps onto ${c.lines} lines`).toBeLessThanOrEqual(1.6);
    } finally { await ctx.close(); }
  });
}

/* ---------- J1 ---------- */
test('J1. first paint with scripts off: /hours placeholder clock, no needle; /dashboard Day placeholder', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await open(browser, 1280, 'dark', { js: false }); const page = await ctx.newPage();
  try {
    await page.goto('/hours', { waitUntil: 'domcontentloaded' });
    const h = await page.evaluate(() => ({ text: document.body.innerText, placeholder: /--:--:--/.test(document.body.innerText), realClock: /\b\d{2}:\d{2}:\d{2}\b/.test(document.body.innerText), needle: document.querySelectorAll('[data-testid*="needle"], .hours-needle, [class*="needle"]').length }));
    await page.screenshot({ path: 'qa/.shots/hours-js-off-1280.png' });
    console.log(`[J1] /hours placeholder=${h.placeholder} realClock=${h.realClock} needle=${h.needle} len=${h.text.length}`);
    expect(h.text.length, '/hours server HTML painted nothing').toBeGreaterThan(200);
    expect(h.placeholder, '/hours first paint must show the placeholder clock').toBe(true);
    expect(h.realClock, '/hours first paint shows a real HH:MM:SS clock').toBe(false);
    expect(h.needle, '/hours first paint draws a needle').toBe(0);
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    const d = await page.evaluate(() => { const t = document.body.innerText; const m = /Day\s*[:\n ]\s*([^\n]+)/i.exec(t); return { cell: m ? m[1].trim().slice(0, 20) : null, weekday: /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/.test(t), len: t.length }; });
    console.log(`[J1] /dashboard Day cell=${JSON.stringify(d.cell)} weekdayNamed=${d.weekday} len=${d.len}`);
    expect(d.len, '/dashboard server HTML painted nothing').toBeGreaterThan(200);
    expect(d.weekday, '/dashboard first paint names a weekday (a build-day value shown as today)').toBe(false);
  } finally { await ctx.close(); }
});

/* ---------- P1 ---------- */
test('P1. /upgrade as the Pro fixture never shows a checkout button while the plan loads', async ({ browser }) => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  test.setTimeout(150_000);
  const ctx = await signedInContext(browser, 'a');
  await ctx.addInitScript(() => {
    const w = window as unknown as { __co?: string[] };
    w.__co = [];
    const scan = () => { document.querySelectorAll('a,button').forEach(e => { const t = (e.textContent || '').trim(); const r = (e as HTMLElement).getBoundingClientRect(); if (/^(upgrade|subscribe|get pro|start|buy|checkout)\b|checkout/i.test(t) && r.width > 0 && r.height > 0 && !/current plan/i.test(t)) { const k = t.slice(0, 30); if (!w.__co!.includes(k)) w.__co!.push(k); } }); };
    new MutationObserver(scan).observe(document, { childList: true, subtree: true, attributes: false });
    setInterval(scan, 50);
  });
  const page = await ctx.newPage();
  try {
    await gotoSignedIn(page, '/upgrade'); await page.waitForTimeout(8_000);
    const r = await page.evaluate(() => ({ seen: (window as unknown as { __co?: string[] }).__co || [], text: document.body.innerText }));
    console.log(`[P1] checkout-like buttons ever visible: ${JSON.stringify(r.seen)}; current-plan shown=${/current plan/i.test(r.text)}`);
    expect(r.text.length, '/upgrade did not render for the Pro fixture').toBeGreaterThan(300);
    expect(/current plan/i.test(r.text), 'the Pro fixture must see "Current plan" once loaded (positive control)').toBe(true);
    expect(r.seen, `checkout buttons were shown to a Pro account: ${JSON.stringify(r.seen)}`).toEqual([]);
  } finally { await ctx.close(); }
});

/* ---------- F1 ---------- */
const covered = (page: Page) => page.evaluate(() => {
  const fabEl = document.querySelector('[data-testid="grok-launcher"]') as HTMLElement | null; const f = fabEl ? fabEl.getBoundingClientRect() : null;
  if (!f || f.width === 0) return { fab: null as null | { l: number; t: number; r: number; b: number }, hits: [] as Array<{ name: string; pct: number; named: string | null }> };
  const hits: Array<{ name: string; pct: number; named: string | null }> = [];
  document.querySelectorAll('a,button,[role="tab"],[role="button"],input,select').forEach(e => {
    if (e === fabEl || fabEl!.contains(e)) return;
    const r = (e as HTMLElement).getBoundingClientRect(); if (r.width < 6 || r.height < 6) return;
    const w = Math.max(0, Math.min(r.right, f.right) - Math.max(r.left, f.left)), h = Math.max(0, Math.min(r.bottom, f.bottom) - Math.max(r.top, f.top));
    const pct = Math.round((w * h) / (r.width * r.height) * 100); if (pct < 20) return;
    const name = ((e.getAttribute('aria-label') || e.textContent || e.className || e.tagName) + '').replace(/\s+/g, ' ').trim().slice(0, 36);
    const cls = String((e as HTMLElement).className || ''); const txt = (e.textContent || '').trim();
    const named = /\bBOOK\b/i.test(txt) && e.closest('nav,[role="tablist"],[class*="tab"]') ? 'BOOK tab' : /pb-star/.test(cls) ? 'playbook star' : /new play/i.test(txt) ? 'new play' : null;
    hits.push({ name, pct, named });
  });
  return { fab: { l: Math.round(f.left), t: Math.round(f.top), r: Math.round(f.right), b: Math.round(f.bottom) }, hits };
});
for (const path of ['/playbook', '/dashboard', '/arena']) {
  test(`F1. ${path}: what the Ask AI button covers at 390/641/768/1100/1280 and scroll 0/400/1200`, async ({ browser }) => {
    test.setTimeout(170_000);
    const all: Array<{ w: number; y: number; name: string; pct: number; named: string | null }> = []; let seenFab = 0;
    for (const w of [390, 641, 768, 1100, 1280]) {
      const ctx = await open(browser, w, 'dark'); const page = await ctx.newPage();
      try {
        await gotoGuarded(page, path); await page.waitForTimeout(9_000);
        for (const y of [0, 400, 1200]) {
          await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(900);
          const c = await covered(page); if (c.fab) seenFab++;
          for (const h of c.hits) all.push({ w, y, ...h });
        }
      } finally { await ctx.close(); }
    }
    const named = all.filter(a => a.named);
    console.log(`[F1] ${path} fabSeen=${seenFab}/15 coveredControls(>=20%)=${all.length} named=${JSON.stringify(named)} sample=${JSON.stringify(all.slice(0, 8))}`);
    expect(seenFab, 'the Ask AI button was never found: nothing measured').toBeGreaterThan(0);
    expect(named, `named controls covered by the Ask AI button: ${JSON.stringify(named)}`).toEqual([]);
  });
}
