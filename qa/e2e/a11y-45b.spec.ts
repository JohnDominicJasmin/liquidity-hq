/* QA #1185 item 45 follow-up, signed out on a deployed site: which Arena Tab stop shows nothing, which settings-free facts hold, and whether the phone menu closes on Escape. GETs only. Prints [P45b] lines. */
import { test } from '@playwright/test';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: reads a deployed site (-f base_url=<site>)');
test.describe.configure({ timeout: 240_000, retries: 0 });
const anon = async (browser: import('@playwright/test').Browser, width: number) => { const ctx = await browser.newContext({ viewport: { width, height: 900 } }); await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }); return ctx; };

test('stop without a visible change', async ({ browser }) => {
  const ctx = await anon(browser, 1280); const page = await ctx.newPage();
  try {
    await installPaidAiFence(page); await page.goto('/arena', { waitUntil: 'domcontentloaded', timeout: 150_000 }); await page.waitForTimeout(25_000);
    for (let i = 0; i < 90; i++) {
      await page.keyboard.press('Tab'); await page.waitForTimeout(200);
      const m = await page.evaluate(() => { const e = document.activeElement as HTMLElement | null; if (!e || e === document.body) return null; const c = getComputedStyle(e); const ring = (c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0) || (!!c.boxShadow && c.boxShadow !== 'none'); if (ring) return null; const r = e.getBoundingClientRect(); return { html: e.outerHTML.replace(/\s+/g, ' ').slice(0, 260), outline: `${c.outlineStyle} ${c.outlineWidth} ${c.outlineColor}`, focusVisible: e.matches(':focus-visible'), box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], parent: (e.parentElement?.className ?? '').toString().slice(0, 60) }; });
      if (m) { console.log(`[P45b] no ring at tab ${i + 1}: ${JSON.stringify(m)}`); await page.screenshot({ path: 'qa/.shots/p45-arena-focus.png', clip: { x: Math.max(0, m.box[0] - 60), y: Math.max(0, m.box[1] - 40), width: 220, height: 120 } }).catch(() => {}); }
    }
  } finally { await ctx.close().catch(() => {}); }
});

test('phone menu: Escape', async ({ browser }) => {
  const ctx = await anon(browser, 390); const page = await ctx.newPage();
  try {
    await installPaidAiFence(page); await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 150_000 }); await page.waitForTimeout(15_000);
    const state = () => page.evaluate(() => { const d = document.querySelector('[role="dialog"][aria-label*="avigation" i], [role="dialog"][aria-modal="true"]') as HTMLElement | null; if (!d) return null; const r = d.getBoundingClientRect(); return { inert: d.hasAttribute('inert'), hidden: d.getAttribute('aria-hidden'), x: Math.round(r.x), w: Math.round(r.width), visibility: getComputedStyle(d).visibility }; });
    const b = page.getByRole('button', { name: /open navigation menu/i }).first(); await b.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
    console.log(`[P45b] menu open: ${JSON.stringify(await state())}`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(900);
    console.log(`[P45b] after Escape: ${JSON.stringify(await state())} focusBack=${await b.evaluate((e) => e === document.activeElement)}`);
  } finally { await ctx.close().catch(() => {}); }
});
