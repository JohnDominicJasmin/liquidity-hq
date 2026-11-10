/* #2065 / #1263 box 5: which sentence a BAD_ANSWER shows, and whether it is TRUE.
 *
 * The page tells someone who just spent a paid read whether it cost them one. That claim is keyed on
 * the server's `refunded` flag (`app/(main)/arena/page.tsx:1713`), so there are three states and the
 * third is the one worth the most:
 *
 *   refunded: true      -> ARENA_READ_BAD_ANSWER          "This read was not counted"
 *   refunded: false     -> ARENA_READ_BAD_ANSWER_COUNTED  "This read was counted, and trying again..."
 *   field ABSENT        -> ARENA_READ_BAD_ANSWER_COUNTED  (the fail-safe)
 *
 * C3 IS THE CELL THAT EARNS ITS KEEP. The keying is `refunded === true`, strict. A later
 * "simplification" to `refunded ?` or `!== false` would behave identically for C1 and C2 and break
 * ONLY C3 - and it would break it in the direction that tells a customer their money came back when
 * the server never said so. The malformed-200 guard in `lib/grok.ts` throws BAD_ANSWER with no flag,
 * so this state is reachable in production, not hypothetical.
 *
 * ZERO AI SPEND, DELIBERATELY. `/api/grok` is FULFILLED, so the route never runs: nothing is
 * reserved, nothing is refunded, no xAI call. The fence goes in FIRST and the stub second, because
 * Playwright matches the most recently registered handler - the reverse order would let the fence
 * abort the request this spec exists to answer (#1958, and `paidAiFenceParity`'s P4 pins it).
 *
 * WHAT THIS CANNOT TEST, so nobody reads it as more than it is: whether a REAL BAD_ANSWER actually
 * refunds. That needs xAI to return an unreadable verdict, which is not forcible and bills a Deep
 * read per attempt. Fulfilling the route means the server never reserves, so there is no refund to
 * observe. That half is pinned at source in `__tests__/grokBadAnswerRefunds.test.mts`.
 */
import { test, expect } from '@playwright/test';
import { installPaidAiFence, assertNoUnstubbedPaidAi } from './_no-paid-ai';
import { signedInContext, AUTH_READY, AUTH_SKIP_REASON } from './_auth';

const BASE = process.env.E2E_BASE_URL ?? '';

/* The two labels, from lib/labelDefaults.en.json. Only the DISTINGUISHING clause is matched: both
   strings open with "The AI could not give a clear verdict, so nothing is shown.", so a cell
   asserting that shared prefix would pass for either sentence and discriminate nothing. */
const SAYS_NOT_COUNTED = /this read was not counted/i;
const SAYS_COUNTED = /this read was counted, and trying again will use another one/i;

/* The server's own English, which #2065 exists to stop showing. Deceptively close to the label:
   "The AI ANSWER DID NOT give a clear verdict" (server) vs "The AI COULD NOT give a clear verdict"
   (label), so this has to be matched on the server's exact wording. */
const SERVER_SENTENCE = /the AI answer did not give a clear verdict|the AI read came back empty/i;

const USAGE = {
  deep_used: 4, deep_limit: 10,
  quick_used: 7, quick_limit: 50,
  chat_used: 0, chat_limit: 100,
  search_used: 0, search_limit: 100,
  briefing_used: 0, briefing_limit: 10,
};

function badAnswerBody(refunded?: boolean) {
  return JSON.stringify({
    error: 'The AI answer did not give a clear verdict, so it is not shown. Try again in a moment.',
    code: 'BAD_ANSWER',
    ...(refunded === undefined ? {} : { refunded }),
    usage: USAGE,
  });
}

test.describe('#2065 the BAD_ANSWER line tells the truth about the charge', () => {
  test.skip(!BASE, 'E2E_BASE_URL required');

  for (const [name, refunded, expected, forbidden] of [
    ['C1. refunded:true says the read was NOT counted', true, SAYS_NOT_COUNTED, SAYS_COUNTED],
    ['C2. refunded:false says the read WAS counted', false, SAYS_COUNTED, SAYS_NOT_COUNTED],
    ['C3. the flag ABSENT says the read WAS counted - the fail-safe a truthy check would break', undefined, SAYS_COUNTED, SAYS_NOT_COUNTED],
  ] as const) {
    test(name, async ({ browser }) => {
      test.setTimeout(180_000);
      test.skip(!AUTH_READY, AUTH_SKIP_REASON);

      const ctx = await signedInContext(browser, 'a');
      const page = await ctx.newPage();
      try {
        await installPaidAiFence(page);
        /* AFTER the fence on purpose - this stub must outrank it for this one path. */
        let hits = 0;
        await page.route('**/api/grok', async (route) => {
          if (route.request().method() !== 'POST') return route.fallback();
          hits++;
          await route.fulfill({ status: 502, contentType: 'application/json', body: badAnswerBody(refunded) });
        });

        await page.goto(`${BASE}/arena?coin=btc&tf=1h`, { waitUntil: 'domcontentloaded', timeout: 120_000 });

        const quick = page.locator('button.arena-quick-btn');
        await expect(quick, 'the Quick button never became clickable, so no read was attempted').toBeEnabled({ timeout: 60_000 });
        await quick.click();

        const err = page.locator('.arena-err');
        await expect(err, 'no read-error line appeared at all').toBeVisible({ timeout: 60_000 });
        const text = (await err.innerText()).trim();

        /* CONTROL: the stub must actually have been reached. Without this, an empty .arena-err from
           some unrelated failure would satisfy the "forbidden" assertion below and read as a pass. */
        expect(hits, 'the POST to /api/grok never reached the stub, so this cell measured something else').toBeGreaterThan(0);

        expect(text, `expected the other sentence. Got: ${JSON.stringify(text)}`).toMatch(expected);
        expect(text, `the WRONG sentence is shown for refunded=${String(refunded)}. Got: ${JSON.stringify(text)}`).not.toMatch(forbidden);
        expect(text, "the server's own English sentence is being shown - that is the defect #2065 fixed").not.toMatch(SERVER_SENTENCE);

        assertNoUnstubbedPaidAi(page, 'arena-bad-answer-copy');
      } finally {
        await ctx.close();
      }
    });
  }

  test('C4. the corrected usage from the error body is applied, so the copy and the counter agree', async ({ browser }) => {
    test.setTimeout(180_000);
    test.skip(!AUTH_READY, AUTH_SKIP_REASON);

    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      await installPaidAiFence(page);
      await page.route('**/api/grok', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({ status: 502, contentType: 'application/json', body: badAnswerBody(true) });
      });

      await page.goto(`${BASE}/arena?coin=btc&tf=1h`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      const quick = page.locator('button.arena-quick-btn');
      await expect(quick).toBeEnabled({ timeout: 60_000 });
      await quick.click();
      await expect(page.locator('.arena-err')).toBeVisible({ timeout: 60_000 });

      /* The point: returning early WITHOUT applying the usage would leave the meter showing the read
         as spent while the line says it was not counted - the copy and the number contradicting each
         other on the same screen, which is worse than either alone. The numbers in USAGE are
         deliberately odd (7/50, 4/10) so they cannot coincide with whatever the account really has. */
      const meter = page.locator('#usage-meter');
      await expect(meter, 'the usage meter did not render, so this cell cannot see the counter').toBeVisible({ timeout: 30_000 });
      await expect
        .poll(async () => (await meter.innerText()).replace(/\s+/g, ' '), {
          message: 'the meter never showed the corrected usage from the error body',
          timeout: 20_000,
        })
        .toMatch(/7\s*\/\s*50|4\s*\/\s*10/);

      assertNoUnstubbedPaidAi(page, 'arena-bad-answer-copy');
    } finally {
      await ctx.close();
    }
  });
});
