import { test, expect } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, FIXTURES, SUPABASE_URL, SUPABASE_ANON } from './_auth';
import { startFailOnceServer } from './_shared';

/* #1309 item 10 / PR #1313's own "How to test (QA)" scenario, made automatic.
 *
 * THE BUG: app/api/alert-prefs/route.ts's GET answered `200 {muted: []}` on a
 * real DB read failure - indistinguishable from "this user genuinely has zero
 * mutes". app/alerts/page.tsx's seeding step read that as "brand-new user"
 * and POSTed the default mute set (everything but BTC/ETH/SOL) on top of
 * whatever the account had actually chosen, silently.
 *
 * THE FIX: the route answers a non-2xx status on failure instead, and the
 * page throws on a non-ok response, which routes into the existing
 * `.catch(() => setMuteLoadFailed(true))` - the amber "Couldn't load your
 * mute preferences" banner, already implemented but never reachable for this
 * failure mode - instead of into the seeding path.
 *
 * WHY THE SERVER-SIDE INJECTOR, NOT page.route ON THE BROWSER REQUEST. Faking
 * the /api/alert-prefs RESPONSE at the browser network layer would only
 * prove the CLIENT half of the fix (the `r.ok` check) - it never exercises
 * whether app/api/alert-prefs/route.ts's own GET handler actually turns a
 * real Supabase failure into a non-2xx status. qa/fail-once.cjs forces the
 * SERVER's own internal Supabase fetch to fail once, so the real route
 * handler's real try/catch runs, same as production would see.
 *
 * WHY THIS ALSO COVERS "a normal load is unchanged" IN THE SAME RUN.
 * fail-once fires exactly once per process, then passes every later request
 * through for real - so the SECOND load in this test, against the same
 * still-running server, is a genuine recovery, not a second mock. That is
 * also the stronger claim: not just "a fresh process behaves normally" but
 * "this exact process recovers within itself", which is what a user hitting
 * reload after a transient blip actually experiences.
 */

test.describe('#1309 item 10: alerts page must not re-seed mutes when the prefs read fails', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  test.skip(!!process.env.E2E_BASE_URL,
    'this spec spawns its own local server with a Node --require hook - it cannot run against a ' +
    'deployed service, the same limitation qa/server-intercept.mjs documents in playwright.config.ts');

  test('a forced GET /api/alert-prefs failure shows the load-failed banner and fires zero POSTs; the next load recovers unchanged', async ({ browser }) => {
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: FIXTURES.aEmail, password: FIXTURES.aPassword }),
    });
    const session = await authRes.json();
    expect(session?.access_token, `sign-in failed: HTTP ${authRes.status}`).toBeTruthy();
    const ref = new URL(SUPABASE_URL).hostname.split('.')[0];

    const server = await startFailOnceServer({ match: 'muted_alerts', status: 504 });
    const ctx = await browser.newContext({ baseURL: server.baseURL, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    let requests: { method: string }[] = [];
    page.on('request', req => {
      if (req.url().includes('/api/alert-prefs')) requests.push({ method: req.method() });
    });

    try {
      // Seeded on a loaded page, once - not addInitScript, which would
      // re-fire on the reload this test deliberately triggers.
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.evaluate(([k, v]) => localStorage.setItem(k as string, v as string), [
        `sb-${ref}-auth-token`,
        JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_in: session.expires_in,
          expires_at: Math.floor(Date.now() / 1000) + session.expires_in,
          token_type: 'bearer',
          user: session.user,
        }),
      ] as [string, string]);

      // ── First load: fail-once's ONE forced failure lands on this GET ──
      await page.goto('/alerts', { waitUntil: 'domcontentloaded' });
      // Polls rather than a fixed sleep: this hits a cold, just-started `next
      // start` process (no warm caches), which measured significantly slower
      // than a fixed 3s budget on the first attempt at writing this spec.
      await expect.poll(() => requests.some(r => r.method === 'GET'), {
        message: 'GET /api/alert-prefs was never attempted - the failure was not exercised, so this ' +
          'run measured nothing',
        timeout: 20_000,
      }).toBe(true);

      const postCalls = requests.filter(r => r.method === 'POST');
      expect(postCalls.length,
        `${postCalls.length} POST(s) fired to /api/alert-prefs during a FAILED read - this is the ` +
        'exact re-seeding bug item 10 describes: a DB hiccup must never look like a brand-new user ' +
        "and overwrite the account's real mute choices.").toBe(0);

      const banner = page.getByText(/Couldn't load your mute preferences/i);
      await expect(banner,
        'the load-failed banner never rendered - a failed read must never be silently treated as ' +
        'success').toBeVisible({ timeout: 10_000 });

      // ── Second load, same process: fail-once already fired once, so this ──
      // is a REAL request against the real backend, not another mock.
      requests = [];
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect.poll(() => requests.some(r => r.method === 'GET'), {
        message: 'GET /api/alert-prefs was never attempted on the recovery load',
        timeout: 20_000,
      }).toBe(true);

      await expect(banner,
        'the load-failed banner is still showing on a normal, unforced load - either the failure ' +
        'state never cleared or this load failed too, which this run cannot distinguish').toBeHidden({ timeout: 10_000 });
    } finally {
      await ctx.close();
      await server.stop();
    }
  });
});
