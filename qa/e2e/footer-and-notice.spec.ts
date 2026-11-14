/* #2357: /arena layout shift, both states. (a) a SIGNED-IN visitor's footer waits for the onboarding read, so it no longer paints in view and drops; a failed read does not hold it forever. (b) the signed-out
 * "Sign in to run Quick and Deep analysis" notice sits UNDER the chart, not above it. Signed in as fixture A where noted; nothing is written (the onboarding read is delayed or failed, never changed).
 *   FW1  signed in: while the onboarding read is delayed the footer is ABSENT, once it answers the footer is there
 *   FW2  signed in: a FAILED onboarding read (500) does not hold the footer: it still appears
 *   FW3  signed out: the footer appears with NO onboarding request at all
 *   FW4  / and /login still have no platform footer (unchanged)
 *   FN1  signed out on /arena: the sign-in notice is below the chart workspace, not above it, and the chart's top does not move when it appears
 * NOT covered: the CLS number (qa/e2e/cls-arena-probe*.spec.ts on deployed qa). */
import { test, expect } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { gotoGuarded } from './_shared';

const ONBOARDING = /\/rest\/v1\/lhq_(dev_)?user_onboarding\?/;

test.describe('footer wait and sign-in notice (#2357)', () => {
  test.describe.configure({ timeout: 150_000 });

  test('FW1. signed in: the footer is absent while the onboarding read is outstanding and present after it', async ({ browser }) => {
    test.skip(!AUTH_READY, AUTH_SKIP_REASON);
    const ctx = await signedInContext(browser, 'a'); const page = await ctx.newPage();
    let release: () => void = () => {}; const gate = new Promise<void>(r => { release = r; }); let requested = false;
    await page.route(ONBOARDING, async route => { if (route.request().method() !== 'GET') return route.fallback(); requested = true; await gate; return route.fallback(); });
    try {
      await gotoSignedIn(page, '/about').catch(() => { /* gotoSignedIn may wait for the app shell: the onboarding read is gated below */ });
      await page.waitForTimeout(4_000);
      console.log(`[FW1] onboarding requested: ${requested}; footer present while held: ${await page.locator('.pf-footer').count()}`);
      expect(requested, 'the page never asked for the onboarding row').toBe(true);
      expect(await page.locator('.pf-footer').count(), 'the footer painted while the onboarding read was still outstanding').toBe(0);
      release(); await expect(page.locator('.pf-footer'), 'the footer never appeared after the onboarding read answered').toBeVisible({ timeout: 30_000 });
    } finally { release(); await ctx.close(); }
  });

  test('FW2. signed in: a failed onboarding read does not hold the footer', async ({ browser }) => {
    test.skip(!AUTH_READY, AUTH_SKIP_REASON);
    const ctx = await signedInContext(browser, 'a'); const page = await ctx.newPage();
    await page.route(ONBOARDING, route => route.request().method() === 'GET' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"stub"}' }) : route.fallback());
    try { await gotoSignedIn(page, '/about').catch(() => {}); await expect(page.locator('.pf-footer'), 'the footer is held forever by a failed read').toBeVisible({ timeout: 40_000 }); } finally { await ctx.close(); }
  });

  test('FW3. signed out: the footer appears and the page asks for no onboarding row', async ({ page }) => {
    let asked = 0; page.on('request', r => { if (ONBOARDING.test(r.url())) asked++; });
    await gotoGuarded(page, '/about'); await expect(page.locator('.pf-footer')).toBeVisible({ timeout: 40_000 });
    console.log(`[FW3] onboarding requests signed out: ${asked}`); expect(asked, 'a signed-out visitor asked for an onboarding row').toBe(0);
  });

  test('FW4. / and /login have no platform footer, as before', async ({ page }) => {
    for (const p of ['/', '/login']) { await gotoGuarded(page, p); await page.waitForTimeout(6_000); expect(await page.locator('.pf-footer').count(), `${p} shows the platform footer`).toBe(0); }
  });

  test('FN1. signed out on /arena: the sign-in notice is under the chart workspace, and the workspace top does not move when it appears', async ({ page }) => {
    await page.addInitScript(() => { const w = window as unknown as { __tops: number[] }; w.__tops = []; const iv = setInterval(() => { const ws = document.querySelector('.arena-ws'); if (ws) w.__tops.push(Math.round(ws.getBoundingClientRect().top + scrollY)); }, 50); setTimeout(() => clearInterval(iv), 14_000); });
    await gotoGuarded(page, '/arena'); const notice = page.locator('.usage-auth-notice'); await expect(notice, 'no sign-in notice on /arena signed out').toBeVisible({ timeout: 40_000 }); await page.waitForTimeout(8_000);
    const g = await page.evaluate(() => { const n = document.querySelector('.usage-auth-notice')!.getBoundingClientRect(); const ws = document.querySelector('.arena-ws')!.getBoundingClientRect(); const tops = (window as unknown as { __tops: number[] }).__tops; return { noticeTop: Math.round(n.top + scrollY), wsBottom: Math.round(ws.bottom + scrollY), tops: [...new Set(tops)] }; });
    console.log(`[FN1] ${JSON.stringify(g)}`);
    expect(g.noticeTop, 'the notice is above the chart workspace').toBeGreaterThanOrEqual(g.wsBottom - 2);
    expect(g.tops.length === 0 || Math.max(...g.tops) - Math.min(...g.tops) <= 12, `the chart workspace's top moved by ${g.tops.length ? Math.max(...g.tops) - Math.min(...g.tops) : 0}px while the page loaded: ${JSON.stringify(g.tops)}`).toBe(true);
  });
});
