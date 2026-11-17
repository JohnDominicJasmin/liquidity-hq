/* LANDING OVERFLOW SAMPLING (the fix for "/" scrolling sideways at phone width while the server HTML is still the wide hero, #2504). Signed out, read only.
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f base_url=<url> -f project=desktop -f screenshots=true -f "spec=--grep=LO:"
 *   LO:<theme>:<width>:<net>   "/" at 360 / 390 / 768 / 1280 / 1440, light and dark, normal and slow 3G (CDP 400 kbps, 400 ms RTT; slow runs the phone widths only)
 * The page is sampled at THREE moments after navigation starts answering: as soon as the first bytes parse ("0 s", before hydration), 5 s, and 30 s. At each: document width vs viewport, and every non-fixed element whose right edge is past the viewport.
 * PHONE WIDTHS (<= 768): docW must equal the viewport at all three moments and nothing may sit past the edge. DESKTOP WIDTHS (1280, 1440): the hero geometry is PRINTED (heading, Start button, LIVE READ panel rectangles) so the fixed build can be compared with production number for number; docW must still equal the viewport.
 * Each prints one [LANDING] line; the cell fails on a phone-width overflow at any of the three moments. A settled full-page screenshot is saved at 390 / 768 / 1280 / 1440 (qa/.shots/landing-<theme>-<width>.png). */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { settleForShot } from './_settle';

mkdirSync('qa/.shots', { recursive: true });
const WIDTHS = [360, 390, 768, 1280, 1440] as const;

const sample = (page: Page) => page.evaluate(() => {
  const vw = window.innerWidth; const all = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
  const fixedUp = (e: HTMLElement) => { for (let p: HTMLElement | null = e; p && p !== document.body; p = p.parentElement) { const pos = getComputedStyle(p).position; if (pos === 'fixed' || pos === 'sticky') return true; } return false; };
  const fitsClip = (e: HTMLElement) => { for (let p = e.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) { if (getComputedStyle(p).overflowX !== 'visible' && p.getBoundingClientRect().right <= vw + 1) return true; } return false; };
  const past = all.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !fixedUp(e) && r.right > vw + 1 && !fitsClip(e); });
  const box = (el: Element | null | undefined) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  const cta = Array.from(document.querySelectorAll('a')).find((a) => /get started|start free|начать|시작|开始/i.test(a.textContent || ''));
  const live = Array.from(document.querySelectorAll('span')).find((s) => /live read\s*·/i.test(s.textContent || ''));
  return { vw, docW: document.documentElement.scrollWidth, bodyW: document.body.scrollWidth, past: past.length, pastList: past.slice(0, 4).map((e) => `${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : ''} right=${Math.round(e.getBoundingClientRect().right)}`), h1: box(document.querySelector('.lp-hero-h1')), cta: box(cta), live: box(live?.closest('div')), hydrated: !!document.querySelector('[data-hydrated], .lp-hero-h1')?.isConnected };
});

for (const theme of ['light', 'dark'] as const) for (const width of WIDTHS) for (const net of ['normal', 'slow'] as const) {
  if (net === 'slow' && width > 768) continue;
  const title = `LO:${theme}:${width}:${net}`;
  test(title, async ({ browser }) => {
    test.setTimeout(net === 'slow' ? 240_000 : 120_000);
    const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : width < 1000 ? 1024 : 900 } });
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, theme);
    const page = await ctx.newPage();
    if (net === 'slow') { const c = await ctx.newCDPSession(page); await c.send('Network.enable'); await c.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: Math.round((400 * 1024) / 8), uploadThroughput: Math.round((200 * 1024) / 8) }); }
    try {
      const t0 = Date.now();
      await page.goto('/', { waitUntil: 'commit', timeout: 120_000 });
      await page.waitForFunction(() => !!document.querySelector('.lp-hero-h1') || document.readyState !== 'loading', null, { timeout: 120_000 }).catch(() => {});
      const s0 = await sample(page); const at0 = Date.now() - t0;
      await page.waitForTimeout(5_000); const s5 = await sample(page);
      await page.waitForTimeout(25_000); const s30 = await sample(page);
      const rec = { title, firstSampleAfterMs: at0, s0: { docW: s0.docW, vw: s0.vw, past: s0.past, pastList: s0.pastList }, s5: { docW: s5.docW, vw: s5.vw, past: s5.past, pastList: s5.pastList }, s30: { docW: s30.docW, vw: s30.vw, past: s30.past, pastList: s30.pastList }, hero30: { h1: s30.h1, cta: s30.cta, live: s30.live } };
      console.log(`[LANDING] ${JSON.stringify(rec)}`);
      if (width === 390 || width === 768 || width === 1280 || width === 1440) { if (net === 'normal') { await settleForShot(page, title).catch(() => {}); await page.screenshot({ path: `qa/.shots/landing-${theme}-${width}.png`, fullPage: true, timeout: 20_000 }).catch(() => {}); } }
      for (const [label, s] of [['first parse', s0], ['5 s', s5], ['30 s', s30]] as const) {
        expect(s.docW, `landing at ${width} (${theme}, ${net}) is ${s.docW}px wide in a ${s.vw}px viewport ${label} after load: ${s.pastList.join(' | ')}`).toBeLessThanOrEqual(s.vw);
        if (width <= 768) expect(s.past, `elements sit past the right edge ${label} after load at ${width}: ${s.pastList.join(' | ')}`).toBe(0);
      }
    } finally { await ctx.close(); }
  });
}
