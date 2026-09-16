import { test, expect } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, FIXTURES, SUPABASE_URL, SUPABASE_ANON } from './_auth';
import { gotoGuarded } from './_shared';

/* Antislop audit 001 (#1309), items 23/24/25 (AS-F). Written and confirmed
 * RED against `dev` BEFORE Dev's fix lands, per PM/DevOps's request - each
 * assertion here documents the exact CURRENT (buggy) behavior it expects to
 * see, not the fixed behavior. Flips green when AS-F merges; do not "fix"
 * a red result here by loosening an assertion instead of waiting for the
 * app-code fix.
 */

async function signIn(email: string, password: string) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const session = await res.json();
  expect(session?.access_token, `sign-in failed for ${email}: HTTP ${res.status}`).toBeTruthy();
  return session as { access_token: string; refresh_token: string; expires_in: number; user: unknown };
}

test.describe('Antislop audit 001 - AS-F (#1309 items 23, 24, 25)', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  test('item 23: SetupChecklist renders exactly once on /dashboard, not twice', async ({ browser }) => {
    const session = await signIn(FIXTURES.aEmail, FIXTURES.aPassword);
    const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.evaluate(([k, v]) => localStorage.setItem(k as string, v as string), [
        `sb-${ref}-auth-token`,
        JSON.stringify({
          access_token: session.access_token, refresh_token: session.refresh_token,
          expires_in: session.expires_in, expires_at: Math.floor(Date.now() / 1000) + session.expires_in,
          token_type: 'bearer', user: session.user,
        }),
      ] as [string, string]);

      await gotoGuarded(page, '/dashboard');
      // .ob-checklist is SetupChecklist.tsx's own root class, both its
      // collapsed-pill and expanded shapes - shared with nothing else.
      const checklists = page.locator('.ob-checklist');
      await expect(checklists.first(),
        'the checklist never rendered at all - check the fixture account still has an incomplete ' +
        'checklist and tour_seen=true, or this run measures nothing about the duplicate').toBeVisible({ timeout: 15_000 });
      const count = await checklists.count();
      // AppShell.tsx:167 (app-wide) AND DashboardTerminal.tsx:537
      // (dashboard-specific) both mount it today - CURRENTLY 2. This test
      // asserts the FIXED value (1) and is expected RED until AS-F removes
      // one of the two mount points.
      expect(count, `expected exactly one SetupChecklist on /dashboard, found ${count} - two copies ` +
        'sitting at the same fixed position is why dismissing one appears to do nothing (item 23)').toBe(1);
    } finally {
      await ctx.close();
    }
  });

  test('item 25: Fear & Greed history requests a well-formed limit=30 and the 30-day sparkline renders', async ({ browser }) => {
    const session = await signIn(FIXTURES.aEmail, FIXTURES.aPassword);
    const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const fngRequests: string[] = [];
    page.on('request', req => {
      const u = req.url();
      if (u.includes('/api/proxy') && u.includes('type=fng')) fngRequests.push(u);
    });
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.evaluate(([k, v]) => localStorage.setItem(k as string, v as string), [
        `sb-${ref}-auth-token`,
        JSON.stringify({
          access_token: session.access_token, refresh_token: session.refresh_token,
          expires_in: session.expires_in, expires_at: Math.floor(Date.now() / 1000) + session.expires_in,
          token_type: 'bearer', user: session.user,
        }),
      ] as [string, string]);
      // Fresh per run - MarketConditionsWidget.tsx's useFngHistory() serves a
      // 6h localStorage cache first, which would hide the network request
      // (and any stale cached history) entirely.
      await page.evaluate(() => localStorage.removeItem('lhq_fng_history'));

      await gotoGuarded(page, '/dashboard');
      await expect.poll(() => fngRequests.length > 0, {
        message: 'no /api/proxy?type=fng request was made at all - this run measured nothing',
        timeout: 15_000,
      }).toBe(true);

      // components/MarketConditionsWidget.tsx:74 sends
      // '?type=fng&?limit=30&format=json' - the second literal `?` makes the
      // actual query key `?limit`, not `limit`, so the server-side proxy's
      // `searchParams.get('limit')` reads null and forwards no limit at all.
      // CURRENTLY every captured URL contains the broken '&?limit=' and NONE
      // contains a well-formed 'limit=30'. Expected RED until AS-F fixes the typo.
      const wellFormed = fngRequests.filter(u => /[?&]limit=30(&|$)/.test(u) && !u.includes('&?limit'));
      expect(wellFormed.length,
        `none of the ${fngRequests.length} fng request(s) had a well-formed limit=30 param - ` +
        `captured: ${fngRequests.join(', ')}`).toBeGreaterThan(0);

      // Sparkline.tsx renders an empty <div> (no <svg>) for points.length < 2 -
      // a 1-value response (today's reading only, the broken query's effective
      // result) cannot produce a real trend line. Locating by proximity to the
      // F&G gauge rather than a global svg count, since the page has many
      // other sparklines/charts.
      const fngSection = page.locator('text=/Fear.{0,3}Greed/i').first().locator('xpath=ancestor::div[1]');
      await expect(fngSection.locator('svg polyline'),
        'the 30-day trend sparkline never rendered (no <svg><polyline> found near the Fear & Greed ' +
        'gauge) - consistent with the history request never actually returning multi-day data').toBeVisible({ timeout: 10_000 });
    } finally {
      await ctx.close();
    }
  });

  test('item 24: a rapid click burst on StrategyPanel\'s QUICK button fires exactly one /api/grok request', async ({ browser }) => {
    const session = await signIn(FIXTURES.aEmail, FIXTURES.aPassword);
    const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    let grokCalls = 0;
    // Intercepted and never actually sent to xAI - this is a real paid call
    // per click that reaches it, and the whole point of this test is that a
    // buggy build makes MORE than one. A short delay keeps the first "call"
    // in flight long enough for a rapid-click burst to land inside the
    // window a real request would occupy.
    await page.route('**/api/grok', async route => {
      grokCalls++;
      await new Promise(r => setTimeout(r, 800));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signal: 'WAIT', confidence: 50, reasoning: 'stub' }) });
    });
    // Also mocked, deterministically - readMarket() fetches real candles
    // BEFORE ever reaching /api/grok, and the first attempt at this test
    // showed exactly 1 grok call even against unfixed code, which turned out
    // to be real-network variance in this klines call racing 3 concurrent
    // identical requests (2 of 3 silently failing before ever reaching the
    // grok step), not a working guard - a false green for the wrong reason.
    // A fast, deterministic candle response removes that variable, so this
    // test isolates the click-guard behavior specifically.
    const fakeCandle = (i: number) => [Date.now() - (300 - i) * 60_000, 100, 101, 99, 100.5, 10];
    await page.route('**/api/market/klines**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Array.from({ length: 300 }, (_, i) => fakeCandle(i))) }),
    );
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.evaluate(([k, v]) => localStorage.setItem(k as string, v as string), [
        `sb-${ref}-auth-token`,
        JSON.stringify({
          access_token: session.access_token, refresh_token: session.refresh_token,
          expires_in: session.expires_in, expires_at: Math.floor(Date.now() / 1000) + session.expires_in,
          token_type: 'bearer', user: session.user,
        }),
      ] as [string, string]);

      await gotoGuarded(page, '/arena');
      // StrategyPanel.tsx:398 - literal "QUICK", distinct from the main
      // page's own "Quick Research" fire button (which DOES already check
      // `disabled={readLoading}` - this test is specifically about the
      // panel's buttons, which call the shared runStrategy() with no such
      // guard at all, per StrategyPanel.tsx:398-399 and app/arena/page.tsx:1212).
      const quickBtn = page.getByRole('button', { name: 'QUICK', exact: true });
      await expect(quickBtn, 'StrategyPanel\'s QUICK button never rendered - this run measured nothing')
        .toBeVisible({ timeout: 15_000 });

      for (let i = 0; i < 3; i++) {
        await quickBtn.click({ force: true });
      }
      await page.waitForTimeout(1_500); // let every fired request's 800ms mock delay resolve

      // CURRENTLY not reliably 1 - neither runStrategy() nor readMarket()
      // checks any in-flight state, and StrategyPanel is never passed
      // readLoading to disable itself, so how many of the 3 clicks land
      // before React processes the first one's state update is a genuine
      // race, not a fixed number. Measured 2 and 5 across repeated isolated
      // runs while writing this test, and (once, running this file back to
      // back with the other two tests above) a lucky 1 - the same shape of
      // variance reconnect-cdp.spec.ts documents for its own real race.
      // Expected RED, but not deterministically every single run, until
      // AS-F adds a shared guard that makes the count always exactly 1.
      expect(grokCalls, `expected exactly 1 /api/grok request from 3 rapid clicks, got ${grokCalls} - a ` +
        'click while a read is already running must not start another paid AI call (item 24)').toBe(1);
    } finally {
      await ctx.close();
    }
  });
});
