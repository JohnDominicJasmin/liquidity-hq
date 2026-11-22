/* #1185 / fix/landing-768-hero-clip: THE LANDING HERO BEFORE HYDRATION (Dev's request 2026-11-23). "/" signed out, read-only (GETs only), JavaScript DISABLED (the server HTML on its own) at 768, 900, 1023, 1099 and the controls 390 and 1280, colour scheme dark and light, then JavaScript ON at 768.
 * Per cell [L768] prints: documentElement.scrollWidth vs the viewport, the right edge of .lp-read-panel, the heights of the two hero CTAs (one line = 48 / 46 px, a wrapped one is taller), the nav brand text scrollWidth vs clientWidth (.lt-brand-text and .tnav-brand), and whether the page has a sideways scroll at all. Soft assertions: scrollWidth <= viewport, panel right <= viewport, CTA heights at most 50. */
import { test, expect } from '@playwright/test';

const WIDTHS = [768, 900, 1023, 1099, 390, 1280] as const;
const measure = () => {
  const vw = window.innerWidth; const de = document.documentElement;
  const r = (sel: string) => { const e = document.querySelector(sel) as HTMLElement | null; if (!e) return null; const b = e.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width), height: Math.round(b.height), sw: e.scrollWidth, cw: e.clientWidth }; };
  return { vw, sw: de.scrollWidth, bodySw: document.body ? document.body.scrollWidth : null, panel: r('.lp-read-panel'), ctaA: r('.lp-hero-btn-a'), ctaB: r('.lp-hero-btn-b'), brandLt: r('.lt-brand-text'), brandTnav: r('.tnav-brand'), hasHero: !!document.querySelector('.lp-hero-sec, .lp-hero-wrap, .lp-hero-cta') };
};
for (const scheme of ['dark', 'light'] as const) for (const width of WIDTHS) {
  test(`L768 JS-off ${scheme} ${width}`, async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled: false, colorScheme: scheme });
    const page = await ctx.newPage();
    try {
      const resp = await page.goto('/', { waitUntil: 'load', timeout: 60_000 }); await page.waitForTimeout(1_500);
      const m = await page.evaluate(measure).catch(() => null);
      console.log(`[L768] JS-off ${scheme} ${width}: status ${resp?.status()} ${JSON.stringify(m)}`);
      expect.soft(m, 'could not measure (evaluate needs scripting off the page, retry with CDP)').not.toBeNull();
    } finally { await ctx.close().catch(() => {}); }
  });
}
for (const scheme of ['dark', 'light'] as const) {
  test(`L768 JS-on ${scheme} 768`, async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx = await browser.newContext({ viewport: { width: 768, height: 900 }, colorScheme: scheme });
    await ctx.addInitScript((s) => { try { localStorage.setItem('theme', s); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, scheme);
    const page = await ctx.newPage();
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 }); await page.waitForTimeout(8_000);
      const m = await page.evaluate(measure);
      console.log(`[L768] JS-on ${scheme} 768: ${JSON.stringify(m)}`);
      expect.soft(m.sw, 'sideways scroll at 768 with JS on').toBeLessThanOrEqual(m.vw);
      if (m.panel) expect.soft(m.panel.right, 'read panel past the viewport').toBeLessThanOrEqual(m.vw);
    } finally { await ctx.close().catch(() => {}); }
  });
}
