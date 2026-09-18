import { test, expect } from '@playwright/test';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON, SUPABASE_URL } from './_auth';

/* #1348 items 3 and 18 (from #1347's audit) - the same underlying gap seen
 * from two angles:
 *
 * Item 3: components/GrokChat.tsx:584 - `setChatSelection(ev.detail.selection
 * ?? [])`. The 'grok-chat' event's `selection` field is only ever populated
 * by app/arena/page.tsx (:1528-1530). components/EMASignal.tsx:32 and
 * app/news/page.tsx (askGrok, :62-69) dispatch it with no `selection` field
 * at all.
 *
 * Item 18 (PM/DevOps, #1347): GrokChat has no direct settings access of its
 * own - `chatSelection` starts at `[]` (useState) and is ONLY ever populated
 * by the 'strategy-selection-changed' event, which ONLY Arena dispatches
 * (app/arena/page.tsx:373-375). So a user who never visits Arena in a given
 * session gets a chat that reasons from "nothing selected," regardless of
 * what is actually saved on their account.
 *
 * PM's explicit warning, followed here: navigating through Arena first would
 * let client state carry and pass this test for the wrong reason (item 3's
 * mechanism, not item 18's). This file does NOT visit Arena at all - fresh
 * sign-in, straight to /news, open the chat from there.
 *
 * NOT an AI-credit-costing run: /api/grok-chat is intercepted and stubbed,
 * so no real call reaches xAI. This inspects the OUTGOING request body for
 * whether the system context mentions the saved indicator - the same
 * "assert the request, not the card" methodology as item 1, applied here
 * for free since a mock suffices (the defect is in what gets INTO the
 * request, not in Grok's response).
 */

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

async function resetStrategySelection(page: import('@playwright/test').Page, selection: string[]) {
  const result = await page.evaluate(async (sel) => {
    const raw = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    const token = raw ? JSON.parse(localStorage.getItem(raw)!).access_token : null;
    const now = new Date().toISOString();
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ strategy_selection: sel, knownAsOf: { strategy_selection: now } }),
    });
    const body = await res.json();
    localStorage.removeItem('lhq_settings_v1');
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('lhq_settings_unconfirmed_v1')) localStorage.removeItem(k);
    }
    return { status: res.status, accepted: body.accepted as string[] | undefined };
  }, selection);
  expect(result.accepted, `strategy_selection reset was rejected by the concurrency guard: ${JSON.stringify(result)}`)
    .toContain('strategy_selection');
}

test.describe('LiquidityAI must know a real saved selection even without an Arena visit this session (#1348 items 3/18)', () => {
  test('opening the chat from the news page, with no prior Arena visit, still reasons from the account\'s real saved indicator', async ({ browser }) => {
    // Confirmed live defect (#1348 items 3/18), no fix landed yet -
    // test.fail() keeps the suite green while it's true, and turns loudly
    // red the moment a fix makes this test unexpectedly pass, so Dev's own
    // pre-push hook doesn't fail on the very fix this test exists for.
    // Remove this line as part of that fix, not before.
    test.fail();
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      // Seed a real saved selection on the account FIRST, from a page that
      // is not Arena, so this session never triggers Arena's live-sync
      // dispatch at all.
      await gotoSignedIn(page, '/about');
      await resetStrategySelection(page, ['SMA']);

      let grokChatBody: any = null;
      await page.route('**/api/grok-chat', route => {
        grokChatBody = route.request().postDataJSON();
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ choices: [{ message: { content: 'stubbed reply' } }] }),
        });
      });

      // Fresh load, straight to news - NO Arena visit anywhere in this test.
      // Opens via the global FAB (data-testid="grok-launcher",
      // GrokChat.tsx:692-697) rather than a per-article "Ask AI" card - the
      // news feed can render with zero cards on this environment (no
      // catalysts scanned yet), which would make the test measure nothing
      // through no fault of the mechanism under test. The FAB is GrokChat's
      // own UI, always present, and opens with no coin/prompt/selection
      // argument at all - if anything, a cleaner instance of item 18's gap
      // than a per-article button, since it carries even less context in.
      const launcher = page.locator('[data-testid="grok-launcher"]');
      await expect(launcher, 'the global Ask AI launcher never rendered - this run measured nothing').toBeVisible({ timeout: 15_000 });
      await launcher.click();

      const input = page.locator('textarea').first();
      await expect(input).toBeVisible({ timeout: 5_000 });
      await input.fill('What do you think of BTC right now?');
      await input.press('Enter');

      await expect.poll(() => grokChatBody !== null, {
        message: 'no /api/grok-chat request was ever sent after opening the chat and sending a message',
        timeout: 10_000,
      }).toBe(true);

      const systemMsg: string = grokChatBody?.messages?.find((m: { role: string }) => m.role === 'system')?.content ?? '';
      expect(systemMsg, 'the account\'s real saved SMA selection never reached the chat\'s system context because this session never visited Arena - GrokChat has no other way to learn a saved selection (#1347 item 18)')
        .toMatch(/weighing these indicators[\s\S]*SMA/i);
    } finally {
      await ctx.close();
    }
  });
});
