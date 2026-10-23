import { test, expect } from '@playwright/test';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

/* #1631 E (#1665): a chat opened on Arena with no conversation yet asks about ARENA's coin. Before #1665 it started on BTC whatever the
 * page showed, so on the XRP page a Pro user spent a credit on BTC.
 *
 * PM's open item on #1665, done here: a HARD load of /arena?coin=xrp, then the chat opened from the launcher. Not from Ask AI: Ask AI
 * hands the chat its coin itself, so it would pass for the wrong reason.
 *
 * Why the hard load is the case that matters: Arena announces its coin once, in an effect ('page-coin', app/arena/page.tsx), and GrokChat
 * starts listening in its own effect. On a client-side visit GrokChat is already listening. On a hard load both mount at once, and the
 * event is only caught if Arena's content commits after GrokChat's listener (today Arena's <Suspense> gives that order). If the order
 * ever flips, nothing errors: the chat quietly falls back to the Dashboard's coin.
 *
 * NO AI CREDITS: /api/grok-chat is stubbed (POST answers in #1665's shape, GET answers a usage row), so nothing reaches xAI. The oracle is
 * the OUTGOING request's context.coin, the coin the server would write the prompt for, not the panel's label. */

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

test('a hard-loaded /arena?coin=xrp: the chat opened from the launcher asks about XRP', async ({ browser }) => {
  const ctx = await signedInContext(browser, 'a');
  const page = await ctx.newPage();
  try {
    const sent: Array<{ context?: { coin?: string }; messages?: Array<{ role: string }> }> = [];
    await installPaidAiFence(page);   // #1632: refuse any paid AI path this spec has not stubbed
    await page.route('**/api/grok-chat', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ chat_used: 0, chat_limit: 50, search_used: 0, search_limit: 10 }) });
      }
      sent.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'stubbed reply', followUps: [], citations: [], _usage: null }) });
    });

    await gotoSignedIn(page, '/arena?coin=xrp'); // a full page load, not a client-side visit
    await expect(page, 'Arena dropped the coin from the URL - the page is not showing XRP').toHaveURL(/[?&]coin=xrp\b/);

    const launcher = page.locator('[data-testid="grok-launcher"]');
    await expect(launcher, 'the chat launcher never rendered - this run measured nothing').toBeVisible({ timeout: 15_000 });
    await launcher.click();
    const input = page.locator('textarea').first();
    await expect(input).toBeVisible({ timeout: 5_000 });
    await input.fill('Trend direction?');
    await input.press('Enter');

    await expect.poll(() => sent.length, { message: 'no /api/grok-chat request was sent after asking a question', timeout: 10_000 }).toBeGreaterThan(0);
    expect(sent[0].context?.coin, 'on the XRP page the chat asked about another coin: the page-coin hand-off was missed on a hard load (#1631 E)').toBe('xrp');
    expect((sent[0].messages ?? []).some((m) => m.role === 'system'), 'the browser sent a system turn: since #1665 the server writes the prompt').toBe(false);
  } finally {
    await ctx.close();
  }
});
