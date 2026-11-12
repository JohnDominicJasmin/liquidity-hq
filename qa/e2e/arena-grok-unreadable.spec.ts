/* #1263: an unreadable /api/grok answer must leave /arena usable, with a plain message.
 *
 * Two answers the page has to survive, both stubbed (ZERO AI SPEND: the route is fulfilled, so it never
 * runs and nothing is reserved or billed):
 *   U1  200 with body `{}`            - a proxy, cache, stale deploy or stub; lib/grok.ts refuses it as BAD_ANSWER
 *   U2  502 { code: 'BAD_ANSWER' }    - the route's own refusal, with no `refunded` flag (the fail-safe)
 *
 * For each: the read-error line shows the PLAIN message (not a raw "Cannot read properties of undefined"
 * and not the server's English), no uncaught page error fired, no blank result panel was left behind, and
 * the Quick button is usable again. The wording of the counted / not-counted sentences is
 * arena-bad-answer-copy's job; this file is about the page not breaking. Fence first, stub second. */
import { test, expect } from '@playwright/test';
import { installPaidAiFence, assertNoUnstubbedPaidAi } from './_no-paid-ai';
import { signedInContext, AUTH_READY, AUTH_SKIP_REASON } from './_auth';

const BASE = process.env.E2E_BASE_URL ?? '';
const PLAIN = /the AI could not give a clear verdict, so nothing is shown/i;
const RAW_CRASH = /cannot read properties|undefined|TypeError|\[object|BAD_ANSWER|PRO_REQUIRED/i;

const ANSWERS: Array<[string, { status: number; body: string }]> = [
  ['U1. 200 with an empty object body', { status: 200, body: '{}' }],
  ['U2. 502 BAD_ANSWER with no refunded flag', { status: 502, body: JSON.stringify({ error: 'The AI answer did not give a clear verdict, so it is not shown. Try again in a moment.', code: 'BAD_ANSWER' }) }],
];

test.describe('#1263 an unreadable AI answer leaves the Arena usable', () => {
  test.skip(!BASE, 'E2E_BASE_URL required');

  for (const [name, answer] of ANSWERS) {
    test(name, async ({ browser }) => {
      test.setTimeout(180_000);
      test.skip(!AUTH_READY, AUTH_SKIP_REASON);
      const ctx = await signedInContext(browser, 'a');
      const page = await ctx.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(String(e.message ?? e)));
      try {
        await installPaidAiFence(page);
        let hits = 0;
        await page.route('**/api/grok', async (route) => {
          if (route.request().method() !== 'POST') return route.fallback();
          hits++;
          await route.fulfill({ status: answer.status, contentType: 'application/json', body: answer.body });
        });

        await page.goto(`${BASE}/arena?coin=btc&tf=1h`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
        const quick = page.locator('button.arena-quick-btn');
        await expect(quick, 'the Quick button never became clickable, so no read was attempted').toBeEnabled({ timeout: 60_000 });
        await quick.click();

        const err = page.locator('.arena-err');
        await expect(err, 'no read-error line appeared: a blank state instead of a message').toBeVisible({ timeout: 60_000 });
        const text = (await err.innerText()).trim();
        console.log(`[grok ${answer.status}] message=${JSON.stringify(text.slice(0, 120))} hits=${hits} pageErrors=${pageErrors.length}`);

        expect(hits, 'the POST never reached the stub, so this cell measured something else').toBeGreaterThan(0);
        expect(text.length, 'the error line is empty').toBeGreaterThan(10);
        expect(text, `not the plain message. Got: ${JSON.stringify(text)}`).toMatch(PLAIN);
        expect(text, `a raw error or code leaked to the user. Got: ${JSON.stringify(text)}`).not.toMatch(RAW_CRASH);
        expect(pageErrors, `the page threw: ${pageErrors.join(' | ')}`).toEqual([]);

        // The page is usable again and nothing half-rendered leaked onto it.
        await expect(quick, 'Quick stayed disabled after the failed read').toBeEnabled({ timeout: 30_000 });
        const body = await page.locator('body').innerText();
        expect(body, 'undefined or NaN is on the page after the failed read').not.toMatch(/\bundefined\b|\bNaN\b/);

        assertNoUnstubbedPaidAi(page, 'arena-grok-unreadable');
      } finally {
        await ctx.close();
      }
    });
  }
});
