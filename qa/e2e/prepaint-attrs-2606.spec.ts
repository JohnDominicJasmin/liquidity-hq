/* ARE THE PRE-PAINT HINTS REALLY PRE-PAINT? (Dev's question after the landing-init finding.) The attributes the head scripts set on <html> must exist BEFORE the first paint: read at DOMContentLoaded (the earliest point a page script can observe, after every parser-inserted inline script has run) and at the first animation frame.
 *   PP1  signed in as the Pro fixture with a saved strategy in the cached settings (the CLS gate's SAVED-WARM seeding): data-sess, data-strat, data-theme at DCL and at the first rAF; a stored light theme must give data-theme="light" at DCL.
 *   PP2  signed in, cached settings holding NO strategy: data-sess and data-strat-none at DCL.
 *   PP3  signed out, theme stored as light: data-theme="light" at DCL (no flash of dark).
 * Informational prints for each load: every data-* attribute on <html> at DCL / first rAF / +3 s. Read-only. */
import { test, expect, type Browser } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';

const OBS = () => {
  const w = window as unknown as { __pp: Record<string, string> };
  w.__pp = {};
  const snap = () => Array.from(document.documentElement.attributes).filter((a) => a.name.startsWith('data-')).map((a) => `${a.name}=${a.value}`).join(' ');
  document.addEventListener('DOMContentLoaded', () => { w.__pp.dcl = snap(); requestAnimationFrame(() => { w.__pp.raf = snap(); }); });
  setTimeout(() => { w.__pp.late = snap(); }, 3000);
};
const read = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { __pp: Record<string, string> }).__pp);

async function signedIn(browser: Browser, settings: Record<string, unknown>, theme: string) {
  const ctx = await signedInContext(browser, 'a'); await ctx.addInitScript(OBS);
  await ctx.addInitScript(([s, t]) => { try { localStorage.setItem('lhq_settings_v1', s as string); localStorage.setItem('theme', t as string); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [JSON.stringify(settings), theme]);
  return ctx;
}

test('PP1 signed in, saved strategy cached, light theme: data-sess + data-strat + data-theme=light at DOMContentLoaded', async ({ browser }) => {
  test.setTimeout(150_000); test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  const ctx = await signedIn(browser, { arena_strategy: 'ema_stack' }, 'light'); const page = await ctx.newPage();
  try { await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); await page.waitForTimeout(6_000); const r = await read(page); console.log(`[PP] PP1 dcl: ${r.dcl} | raf: ${r.raf} | late: ${r.late}`);
    expect(r.dcl, 'data-sess at DCL').toContain('data-sess='); expect(r.dcl, 'data-strat at DCL').toContain('data-strat='); expect(r.dcl, 'data-theme=light at DCL').toContain('data-theme=light');
  } finally { await ctx.close(); }
});
test('PP2 signed in, cached settings with NO strategy: data-sess + data-strat-none at DOMContentLoaded', async ({ browser }) => {
  test.setTimeout(150_000); test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  const ctx = await signedIn(browser, { arena_strategy: null }, 'dark'); const page = await ctx.newPage();
  try { await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); await page.waitForTimeout(6_000); const r = await read(page); console.log(`[PP] PP2 dcl: ${r.dcl} | raf: ${r.raf} | late: ${r.late}`);
    expect(r.dcl, 'data-sess at DCL').toContain('data-sess='); expect(r.dcl, 'data-strat-none at DCL').toContain('data-strat-none');
  } finally { await ctx.close(); }
});
test('PP3 signed out, light theme stored: data-theme=light at DOMContentLoaded', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); await ctx.addInitScript(OBS); await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'light'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await ctx.newPage();
  try { await page.goto('/about', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(4_000); const r = await read(page); console.log(`[PP] PP3 dcl: ${r.dcl} | raf: ${r.raf} | late: ${r.late}`);
    expect(r.dcl, 'data-theme=light at DCL').toContain('data-theme=light');
  } finally { await ctx.close(); }
});
