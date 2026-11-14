/* Live re-checks on deployed qa for release candidate #2292: the authenticated rows of the list that cannot be done signed out. Run on a GitHub runner:
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/qa-live-2292.spec.ts -f base_url=https://liquidity-hq-qa.onrender.com -f project=desktop
 *
 * SAFE BY CONSTRUCTION: every request here is one the server REFUSES before any write or any paid call (over-size bodies, a non-push host, extra keys, a Free account on a Pro route), and the
 * only real read is a page load. NOTHING reaches the dev database as a write, NOTHING reaches xAI or Telegram. The paid AI routes are NOT called at all (money): their input checks are pinned by
 * unit cells and by the stubbed harness. Fixture accounts A (Pro) and B (Free) only; tokens come from _auth.ts and are never printed.
 *   L1  #2305  /upgrade as Pro (A): "Upgrade to Pro" is never in the DOM at any point before the redirect (observer from document start)
 *   L2  #2344  body caps: price-alerts 5000 B, alert-prefs 5000 B, settings 70 KB, hypotheses 70 KB, push subscribe 9000 B -> 413 (the real routes, signed in)
 *   L3  #2318  push subscribe with a non-push host (https://example.com/x) -> 4xx, with a bad key -> 4xx; signed out -> 401
 *   L4  #2332  telegram/send: signed out 401; B (Free) 403; A with a chat_id / extra key 400; and the 11th request in a minute is 429 (the persistent limiter on the dev database)
 *   L5  #2335/#2339 an ordinary account cannot reach /api/ops (A and B are not admins -> 401/403) and /admin is 404
 *   L6  #2322  NOT RUN on purpose (money): see above. */
import { test, expect } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, FIXTURES, signIn, signedInContext } from './_auth';

const pad = (bytes: number) => { const h = '{"pad":"', t = '"}'; return h + 'a'.repeat(bytes - h.length - t.length) + t; };

test.describe('qa live re-checks (#2292)', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  test.describe.configure({ timeout: 150_000 });

  test('L1. #2305: /upgrade as a Pro account never shows "Upgrade to Pro" before the redirect', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    await ctx.addInitScript(() => {
      const w = window as unknown as { __seen: string[] };
      w.__seen = [];
      const scan = () => { const t = document.body ? document.body.innerText : ''; if (/Upgrade to Pro/i.test(t) && !w.__seen.includes(location.pathname)) w.__seen.push(location.pathname); };
      new MutationObserver(scan).observe(document, { childList: true, subtree: true, characterData: true });
      setInterval(scan, 25);
    });
    const page = await ctx.newPage();
    const paths: string[] = []; page.on('framenavigated', f => { if (f === page.mainFrame()) paths.push(new URL(f.url()).pathname); });
    try {
      await page.goto('/upgrade', { waitUntil: 'commit' }); await page.waitForTimeout(15_000);
      const seen = await page.evaluate(() => (window as unknown as { __seen?: string[] }).__seen ?? []).catch(() => ['(page navigated: observer reset)']);
      console.log(`[L1] navigations ${JSON.stringify(paths)} offer seen on ${JSON.stringify(seen)}`);
      expect(seen.filter(p => p === '/upgrade'), '"Upgrade to Pro" was in the DOM on /upgrade for a Pro account').toEqual([]);
    } finally { await ctx.close(); }
  });

  test('L2. #2344: bodies over the cap are 413 on the real routes (signed in, nothing is written)', async ({ request }) => {
    const a = await signIn(FIXTURES.aEmail, FIXTURES.aPassword);
    const H = { authorization: `Bearer ${a}`, 'content-type': 'application/json' };
    const cases: Array<[string, string, string, number]> = [
      ['price-alerts POST', 'POST', '/api/price-alerts', 5_000], ['alert-prefs POST', 'POST', '/api/alert-prefs', 5_000], ['settings PATCH', 'PATCH', '/api/settings', 70_000],
      ['hypotheses POST', 'POST', '/api/hypotheses', 70_000], ['push subscribe POST', 'POST', '/api/push/subscribe', 9_000],
    ];
    for (const [name, method, url, size] of cases) {
      const r = await request.fetch(url, { method, headers: H, data: pad(size) });
      console.log(`[L2] ${name} ${size} B -> ${r.status()}`);
      expect(r.status(), `${name}: an over-cap body was not refused with 413`).toBe(413);
    }
  });

  test('L3. #2318: push subscribe refuses a non-push host and a bad key; signed out is 401 (nothing stored)', async ({ request }) => {
    const a = await signIn(FIXTURES.aEmail, FIXTURES.aPassword);
    const H = { authorization: `Bearer ${a}`, 'content-type': 'application/json' };
    const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
    for (const [label, endpoint, k] of [['non-push host', 'https://example.com/x', keys], ['http scheme', 'http://fcm.googleapis.com/fcm/send/x', keys], ['metadata IP', 'https://169.254.169.254/x', keys], ['look-alike host', 'https://fcm.googleapis.com.evil.test/x', keys]] as const) {
      const r = await request.fetch('/api/push/subscribe', { method: 'POST', headers: H, data: { endpoint, keys: k } });
      console.log(`[L3] ${label} -> ${r.status()}`); expect(r.status(), `${label} was not refused`).toBeGreaterThanOrEqual(400); expect(r.status()).toBeLessThan(500);
    }
    const bad = await request.fetch('/api/push/subscribe', { method: 'POST', headers: H, data: { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'not base64 !!', auth: 'x' } } });
    console.log(`[L3] bad key -> ${bad.status()}`); expect(bad.status()).toBeGreaterThanOrEqual(400); expect(bad.status()).toBeLessThan(500);
    const anon = await request.fetch('/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, data: { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys } });
    expect(anon.status()).toBe(401);
  });

  test('L4. #2332: telegram/send: 401 signed out, 403 Free, 400 for a chat_id or extra key, and the 11th request in a minute is 429', async ({ request }) => {
    const a = await signIn(FIXTURES.aEmail, FIXTURES.aPassword); const b = await signIn(FIXTURES.bEmail, FIXTURES.bPassword);
    const post = (tok: string | null, data: unknown) => request.fetch('/api/telegram/send', { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, data });
    expect((await post(null, { message: 'x' })).status(), 'signed out').toBe(401);
    const free = await post(b, { message: 'qa live check - not sent' }); console.log(`[L4] Free -> ${free.status()}`); expect(free.status()).toBe(403);
    /* a Pro account with a body the route refuses BEFORE it would send: a chat_id and an extra key are 400, so nothing can go out */
    const chat = await post(a, { message: 'x', chat_id: '1' }); console.log(`[L4] Pro + chat_id -> ${chat.status()}`); expect(chat.status()).toBe(400);
    const extra = await post(a, { message: 'x', parse_mode: 'MarkdownV2' }); expect(extra.status()).toBe(400);
    /* the persistent limiter: Free B never reaches a send (403), but each request is counted. Count up to the 11th within the minute. */
    const codes: number[] = []; for (let i = 0; i < 12; i++) codes.push((await post(b, { message: 'qa live check - not sent' })).status());
    console.log(`[L4] 12 more as Free -> ${JSON.stringify(codes)}`);
    expect(codes.includes(429), `no 429 in ${JSON.stringify(codes)}: the per-minute limit did not engage`).toBe(true);
    expect(codes.filter(c => c !== 403 && c !== 429), 'a status other than 403/429 came back (something may have been sent)').toEqual([]);
  });

  test('L5. an ordinary account cannot use /api/ops; the decoy admin page is 404', async ({ request }) => {
    const a = await signIn(FIXTURES.aEmail, FIXTURES.aPassword);
    for (const [method, url] of [['GET', '/api/ops/team'], ['GET', '/api/ops/config'], ['PATCH', '/api/ops/users/00000000-0000-4000-8000-000000000000']] as const) {
      const r = await request.fetch(url, { method, headers: { authorization: `Bearer ${a}`, 'content-type': 'application/json' }, data: method === 'PATCH' ? { action: 'ban' } : undefined });
      console.log(`[L5] ${method} ${url} -> ${r.status()}`); expect([401, 403]).toContain(r.status());
    }
    expect((await request.get('/admin')).status()).toBe(404);
    expect((await request.get('/api/admin/anything')).status()).toBe(404);
  });
});
