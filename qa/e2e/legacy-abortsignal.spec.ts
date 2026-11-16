/* A BROWSER WITHOUT AbortSignal.timeout / AbortSignal.any (Safari before 16, older WebViews) - the code-review defect on #2408: lib/supabase.ts called AbortSignal.timeout unguarded, so every browser
 * Supabase READ threw before it was sent. Chromium has the API, so the init script below DELETES both from the page before any app code runs, which is what an old Safari looks like to the app.
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/legacy-abortsignal.spec.ts -f base_url=<url> -f project=desktop
 * Fixture A (Pro), reads only. EXPECTED: on a build with the bug the plan never resolves (no PRO badge) and a page error names AbortSignal; on the fixed build the badge appears and there is no such error.
 * Unit twin: __tests__/fetchWithDeadlineLegacyBrowser.test.mts (calls the real function with the API removed). */
import { test, expect } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installSyntheticSocket } from './_fixtures';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

test('a browser with no AbortSignal.timeout / .any still reads the plan and the account (fixture A)', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await signedInContext(browser, 'a');
  await ctx.addInitScript(() => {
    try { Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true, writable: true }); } catch { /* already gone */ }
    try { Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true, writable: true }); } catch { /* already gone */ }
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await installSyntheticSocket(page);
  await installPaidAiFence(page);
  try {
    await gotoSignedIn(page, '/arena');
    const gone = await page.evaluate(() => ({ timeout: typeof (AbortSignal as unknown as { timeout?: unknown }).timeout, any: typeof (AbortSignal as unknown as { any?: unknown }).any }));
    expect(gone, 'the init script did not remove the API, so this run is not simulating an old browser and proves nothing').toEqual({ timeout: 'undefined', any: 'undefined' });
    await expect(page.locator('.plan-badge-pro').first(), 'the Pro plan never resolved with AbortSignal.timeout missing: every Supabase read is throwing (the #2408 review defect)').toBeVisible({ timeout: 45_000 });
    const abortErrors = errors.filter((m) => /AbortSignal/i.test(m));
    expect(abortErrors, `page errors naming AbortSignal: ${abortErrors.join(' | ')}`).toHaveLength(0);
  } finally { await ctx.close(); }
});
