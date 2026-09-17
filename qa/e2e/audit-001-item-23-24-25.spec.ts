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
      // Polls specifically for the HISTORY request (the "30" is the
      // distinguishing constant, broken or not: '&?limit=30' pre-fix,
      // '&limit=30' post-fix), not just any fng request - MarketProvider.tsx
      // makes its OWN, unrelated 'limit=2' fng call app-wide (the current-
      // value gauge, not the history), and it can easily fire first. The
      // first version of this test polled on "any fng request" and could
      // resolve on that one alone, silently skipping the actual assertion
      // if the history call happened to fire slightly later - a false green
      // waiting to happen once AS-F landed, caught by running this test
      // against #1319's fix branch before trusting it.
      await expect.poll(() => fngRequests.some(u => u.includes('limit=30')), {
        message: `no /api/proxy?type=fng request containing 'limit=30' was ever made (captured: ` +
          `${fngRequests.join(', ') || 'none'}) - this run measured nothing about the history call`,
        timeout: 15_000,
      }).toBe(true);

      // components/MarketConditionsWidget.tsx:74 sent '?type=fng&?limit=30&format=json'
      // pre-fix - the second literal `?` made the actual query key `?limit`,
      // not `limit`, so the server-side proxy's `searchParams.get('limit')`
      // read null and forwarded no limit at all. Expected RED (every
      // captured URL contains '&?limit=' and none is well-formed) until
      // AS-F fixes the typo to '&limit=30'.
      const wellFormed = fngRequests.filter(u => /[?&]limit=30(&|$)/.test(u) && !u.includes('&?limit'));
      expect(wellFormed.length,
        `none of the ${fngRequests.length} fng request(s) had a well-formed limit=30 param - ` +
        `captured: ${fngRequests.join(', ')}`).toBeGreaterThan(0);

      // Sparkline.tsx renders an empty <div> (no <svg>) for points.length < 2 -
      // a 1-value response (today's reading only, the broken query's effective
      // result) cannot produce a real trend line. Scoped to
      // MarketConditionsWidget.tsx's own panel specifically - the dashboard's
      // Market Read strip ALSO shows a "FEAR & GREED" label (a different,
      // unrelated widget showing today's single value only, no history), and
      // a bare text match on "Fear & Greed" finds that one first, which is
      // what the first version of this assertion did.
      const mcwPanel = page.locator('.av-rail-panel', { hasText: 'Market conditions' });
      await expect(mcwPanel, 'MarketConditionsWidget (.av-rail-panel "Market conditions") never ' +
        'rendered on /dashboard - this run measured nothing').toBeVisible({ timeout: 10_000 });
      await expect(mcwPanel.locator('svg polyline'),
        'the 30-day trend sparkline never rendered inside MarketConditionsWidget (no <svg><polyline> ' +
        'found) - consistent with the history request never actually returning multi-day data').toBeVisible({ timeout: 10_000 });
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
    //
    // GET vs POST matters here: app/api/grok/route.ts serves BOTH a GET
    // (usage lookup - lib/grok.ts's fetchGrokUsage, fired on mount by
    // GrokUsageProvider, root-wide, for every signed-in visitor) and the
    // POST this test actually cares about (the paid analysis call). Both
    // share the URL, so an unfiltered route() handler counts the mount-time
    // usage check as if it were a second analysis run - a false failure
    // this test itself would report as a guard regression. First run of
    // this exact rewrite did exactly that: grokCalls reached 3 against the
    // real, working #1338 fix (1 legitimate POST + 2 GETs from usage
    // fetches on '/' and '/arena' mount) before this method filter was
    // added. Same class of false-signal risk the klines mock comment above
    // already calls out for a different endpoint - filtering to the method
    // that matters removes the variable instead of reasoning around it.
    await page.route('**/api/grok', async route => {
      if (route.request().method() !== 'POST') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ usage: null }) });
        return;
      }
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
      // panel's buttons, which call the shared runStrategy() with a guard
      // added by AS-F: `disabled={running}`, StrategyPanel.tsx:404).
      const quickBtn = page.getByRole('button', { name: 'QUICK', exact: true });
      await expect(quickBtn, 'StrategyPanel\'s QUICK button never rendered - this run measured nothing')
        .toBeVisible({ timeout: 15_000 });

      // REWRITTEN after AS-F's real fix landed (StrategyPanel.tsx:404,
      // `disabled={running}`) - the original version force-clicked 3 times
      // rapidly and counted requests, which matched the PRE-fix component
      // (no guard at all, any click reaches onRun). Against the real fix,
      // that methodology itself became unreliable: `{force:true}` bypasses
      // Playwright's own actionability checks, but a genuinely `disabled`
      // native <button> still won't dispatch a click event to its handler
      // regardless - so once the first click flips `running` (and the
      // button disabled) a subsequent force-click doesn't reach onRun at
      // all, and depending on exactly when React committs that state
      // update relative to click #2/#3, the locator itself can become
      // temporarily hard to resolve/click, producing test-side timeouts
      // that have nothing to do with whether the guard is working. Found
      // running this against a remote target during a release promotion:
      // 2/2 reproductions of `locator.click: Timeout 30000ms exceeded`,
      // not a real product regression - the guard was working correctly
      // the whole time. Testing the actual mechanism directly (disabled
      // state + call count) instead of inferring it through a race of
      // forced clicks fixes the flakiness at its root, not just this one
      // click's timing.
      await quickBtn.click();
      await expect(quickBtn, 'QUICK must become disabled the instant a read starts - a click while ' +
        'one is already running must not be able to start another paid AI call (item 24)').toBeDisabled({ timeout: 2_000 });

      // A second click while genuinely disabled - even forced - must not
      // reach onRun. This is what actually proves the guard works, rather
      // than assuming a disabled button can't be clicked.
      await quickBtn.click({ force: true }).catch(() => {}); // a disabled native button may refuse the click outright; either outcome is fine, only grokCalls matters below
      await expect.poll(() => grokCalls, {
        message: `expected exactly 1 /api/grok request after clicking QUICK while disabled, got ${grokCalls}`,
      }).toBe(1);

      // Let the in-flight (mocked, 800ms) request resolve, then confirm the
      // button re-enables and the count still hasn't moved from the earlier
      // disabled-click attempt.
      await expect(quickBtn, 'QUICK must re-enable once the read finishes').toBeEnabled({ timeout: 2_000 });
      expect(grokCalls, `expected exactly 1 /api/grok request total, got ${grokCalls} - a ` +
        'click while a read is already running must not start another paid AI call (item 24)').toBe(1);
    } finally {
      await ctx.close();
    }
  });
});
