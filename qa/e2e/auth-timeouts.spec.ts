/* #1173 row 1: how long does the app wait before it gives up on the signed-in state? MEASURED, not read from the constants.
 *
 * AuthProvider bounds two things in a row: the SESSION read (SESSION_RESOLVE_MS = 8 s, one deadline for the chain) and, once a user is known, the
 * ENTITLEMENTS read (ENTITLEMENTS_OVERALL_BUDGET_MS = 22 s over up to a few attempts). If the session read succeeds slowly and the entitlements read
 * then hangs, the two stack. The tracker's claim is "about 22.7 s" (it counted only the entitlements leg); Dev's arithmetic for the worst case is ~30 s.
 *
 *   A1  session healthy, the entitlements read HANGS (every attempt): seconds from navigation to the LAST entitlements attempt being given up
 *   A2  session read SLOW (the token refresh is held 6.5 s, then passed through) AND the entitlements read hangs: the stacked total
 *
 * WHAT IS TIMED: the entitlements request is the `user_subscriptions` REST read. Its first request marks the moment a user was resolved (the entitlements
 * leg starts); its last failure marks the moment the app stopped trying. The UI gives no signal of its own at that moment (the plan badge stays BLANK on a
 * cold start with nothing cached, by design), so the network edge is the only honest clock. Fixture A, the deployed qa site, nothing billed.
 * The token refresh in A2 is the REAL one (held, then continued), so it rotates fixture A's refresh token for this run only. */
import { test, expect, type Page } from '@playwright/test';
import { signedInContext, AUTH_READY, AUTH_SKIP_REASON } from './_auth';

const SUBS = /user_subscriptions/;
const TOKEN_REFRESH = /\/auth\/v1\/token\?grant_type=refresh_token/;

async function measure(page: Page, label: string) {
  const starts: number[] = []; const fails: number[] = [];
  page.on('request', r => { if (SUBS.test(r.url())) starts.push(Date.now()); });
  page.on('requestfailed', r => { if (SUBS.test(r.url())) fails.push(Date.now()); });
  const t0 = Date.now();
  await page.goto('/arena', { waitUntil: 'domcontentloaded' });
  // wait for the entitlements leg to START, then for it to go quiet: no new attempt and no failure for 4 s after at least one failure
  const deadline = Date.now() + 75_000;
  let lastActivity = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    const act = Math.max(starts[starts.length - 1] ?? 0, fails[fails.length - 1] ?? 0);
    lastActivity = act;
    if (fails.length > 0 && Date.now() - act > 4_000 && starts.length <= fails.length) break;
  }
  const sec = (t: number) => Math.round((t - t0) / 100) / 10;
  const out = {
    firstEntitlementsRequestAt: starts.length ? sec(starts[0]) : null,
    attempts: starts.length,
    lastGiveUpAt: fails.length ? sec(fails[fails.length - 1]) : null,
    legSeconds: starts.length && fails.length ? Math.round((fails[fails.length - 1] - starts[0]) / 100) / 10 : null,
  };
  // eslint-disable-next-line no-console
  console.log(`[${label}] ${JSON.stringify(out)} lastActivityAt=${sec(lastActivity)}`);
  return out;
}

test.describe('#1173 how long the signed-in state is awaited', () => {
  test.describe.configure({ timeout: 150_000 });
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  test('A1. session healthy, entitlements hung: seconds until the last attempt is given up', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    await ctx.route(SUBS, () => { /* never answered */ });
    const page = await ctx.newPage();
    try {
      const m = await measure(page, 'A1');
      expect(m.firstEntitlementsRequestAt, 'no entitlements request was made, so nothing was timed (is fixture A signed in?)').not.toBeNull();
      expect(m.lastGiveUpAt, 'the entitlements read was never given up within 75 s: the budget did not hold').not.toBeNull();
    } finally { await ctx.close(); }
  });

  test('A2. session read held 6.5 s, entitlements hung: the stacked total', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    // force the refresh path: the seeded access token is already expired, so getSession must call the network
    await ctx.addInitScript(() => {
      try {
        for (const k of Object.keys(localStorage)) if (/^sb-.*-auth-token$/.test(k)) {
          const v = JSON.parse(localStorage.getItem(k) || '{}'); v.expires_at = 1; localStorage.setItem(k, JSON.stringify(v));
        }
      } catch { /* none */ }
    });
    let refreshSeen = 0;
    await ctx.route(TOKEN_REFRESH, async (route) => { refreshSeen++; await new Promise(r => setTimeout(r, 6_500)); await route.continue(); });
    await ctx.route(SUBS, () => { /* never answered */ });
    const page = await ctx.newPage();
    try {
      const m = await measure(page, 'A2');
      // eslint-disable-next-line no-console
      console.log(`[A2] refresh calls seen=${refreshSeen}`);
      expect(refreshSeen, 'the token refresh was never called, so the session leg was not slowed: nothing stacked').toBeGreaterThan(0);
      expect(m.firstEntitlementsRequestAt, 'no entitlements request was made').not.toBeNull();
      expect(m.lastGiveUpAt, 'the entitlements read was never given up within 75 s').not.toBeNull();
    } finally { await ctx.close(); }
  });
});
