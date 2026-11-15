/* A PROBE: HOW LONG DOES THE PLAN READ TAKE AFTER A SIGNED-IN /arena LOAD? (release 2 CI: the 'Upgrade to Pro' modal opened because the Pro fixture's plan was still unresolved when a timeframe was clicked.)
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/entitlement-timing-probe.spec.ts -f base_url=https://liquidity-hq-qa.onrender.com -f project=desktop
 * Signed in as fixture A (Pro) and B (Free), 5 fresh loads each: logs, per load, the start and duration of every request to the subscriptions table (user_subscriptions) and the time until the header shows the plan badge ([PLAN]).
 * Reads only, nothing written. */
import { test } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

for (const who of ['a', 'b'] as const) test(`plan read timing (${who === 'a' ? 'Pro' : 'Free'})`, async ({ browser }) => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON); test.setTimeout(300_000);
  for (let run = 1; run <= 5; run++) {
    const ctx = await signedInContext(browser, who); await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await ctx.newPage(); await page.setViewportSize({ width: 1280, height: 900 }); await installPaidAiFence(page);
    const t0 = Date.now(); const reads: string[] = [];
    page.on('requestfinished', async (r) => { if (/user_subscriptions/.test(r.url())) { const t = r.timing(); reads.push(`start ${Math.round(r.timing().startTime ? 0 : 0) + (Date.now() - t0)}ms dur ${Math.round(t.responseEnd)}ms`); } });
    try {
      await page.goto('/arena?coin=btc&tf=1h', { waitUntil: 'commit' });
      let badgeAt: number | null = null; const sel = who === 'a' ? '.plan-badge-pro' : '.plan-badge-free';
      for (let i = 0; i < 300 && badgeAt === null; i++) { if (await page.locator(sel).first().isVisible().catch(() => false)) badgeAt = Date.now() - t0; else await page.waitForTimeout(100); }
      console.log(`[PLAN] ${who} load ${run}: badge visible at ${badgeAt === null ? 'NEVER (30 s)' : badgeAt + ' ms'}; subscription reads finished: ${JSON.stringify(reads)}`);
    } finally { await ctx.close(); }
  }
});
