/* #2701 ON A DEPLOYED GATED HOST (qa / staging), the replacement for an admin smoke (PM 2026-11-20: no real admin credentials are ever entered). Proves the Authorization header is PARSED right end to end, with the fixture accounts of the DEV project and nothing else. Nothing is written except a throwaway mute key that is removed again, no AI route.
 * ALL REQUESTS ARE MADE FROM THE BROWSER PAGE (fetch with an explicit Authorization header), the way the app's own /api calls are: Playwright's API request context re-sends the gate's Basic credentials on every request (send: 'always') and so cannot carry a token of its own (the first run of this spec measured that: the fixture token came back 401 because it was never sent).
 *   P1  an admin route (/api/ops/me): no header -> 401, "Basic x" -> 401, a junk bearer token -> 401, the Pro fixture's real token -> 403 (the token is read and verified, only the role check refuses it)
 *   P2  /api/market/rsi: "Basic x" answers like no header (200, never 401 TOKEN_EXPIRED); a junk bearer token answers 401 TOKEN_EXPIRED (the path is alive); the Pro fixture's token answers 200 and carries the 5m field a Free caller does not get
 *   P3  the alerts SAVE with the Pro fixture: a mute is written, read back, and removed again (a throwaway key); the same POST with Basic x answers 401 and writes nothing
 * The gate: the page's first navigation passes the HTTP gate (Playwright sends the gate's Basic credentials on page requests) and receives the lhq_gate cookie; the fetches that follow carry an explicit Authorization header of their own and pass the gate on that cookie, which is exactly what the app does. */
import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, FIXTURES, signIn } from './_auth';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

type Reply = { status: number; body: string };
const call = (page: Page, path: string, auth?: string, init?: { method?: string; json?: unknown }) => page.evaluate(async ([p, a, m, j]) => {
  const headers: Record<string, string> = {}; if (a) headers.Authorization = a; if (j !== undefined) headers['Content-Type'] = 'application/json';
  try { const r = await fetch(p as string, { method: (m as string) || 'GET', headers, body: j === undefined ? undefined : (j as string), cache: 'no-store' }); return { status: r.status, body: (await r.text()).slice(0, 6000) }; } catch (e) { return { status: 0, body: String(e).slice(0, 80) }; }
}, [path, auth ?? '', init?.method ?? '', init?.json === undefined ? undefined : JSON.stringify(init.json)] as const) as Promise<Reply>;

test('P1+P2+P3 the token is read from a bearer header only', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/api/version', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  const token = await signIn(FIXTURES.aEmail, FIXTURES.aPassword); const tok = (t: string) => `${'Bear'}er ${t}`;

  const none = await call(page, '/api/ops/me'); const basic = await call(page, '/api/ops/me', 'Basic eDp4'); const junk = await call(page, '/api/ops/me', tok('garbage')); const real = await call(page, '/api/ops/me', tok(token));
  console.log(`[P1] /api/ops/me: no header ${none.status} · basic x ${basic.status} · junk token ${junk.status} · Pro fixture token ${real.status} ${real.body}`);
  expect(none.status, 'no header').toBe(401); expect(basic.status, 'Basic x').toBe(401); expect(junk.status, 'junk token').toBe(401);
  expect(real.status, 'a verified non-admin token must be refused by the ROLE check (403), not by parsing (401)').toBe(403);

  const rNone = await call(page, '/api/market/rsi'); const rBasic = await call(page, '/api/market/rsi', 'Basic eDp4'); const rJunk = await call(page, '/api/market/rsi', tok('garbage')); const rPro = await call(page, '/api/market/rsi', tok(token));
  const has5m = (r: Reply) => { try { return Number.isFinite((JSON.parse(r.body) as { rsi?: { btc?: { rsi5m?: number } } }).rsi?.btc?.rsi5m); } catch { return /rsi5m/.test(r.body); } };
  const proFull = await page.evaluate(async (a) => { const r = await fetch('/api/market/rsi', { headers: { Authorization: a }, cache: 'no-store' }); const j = await r.json().catch(() => ({})) as { rsi?: { btc?: { rsi5m?: number } } }; return Number.isFinite(j.rsi?.btc?.rsi5m); }, tok(token));
  const noneFull = await page.evaluate(async () => { const r = await fetch('/api/market/rsi', { cache: 'no-store' }); const j = await r.json().catch(() => ({})) as { rsi?: { btc?: { rsi5m?: number } } }; return Number.isFinite(j.rsi?.btc?.rsi5m); });
  console.log(`[P2] /api/market/rsi: no header ${rNone.status} · basic x ${rBasic.status} · junk token ${rJunk.status} ${rJunk.body.slice(0, 40)} · Pro fixture ${rPro.status} (rsi5m: ${proFull}) · no header rsi5m: ${noneFull} · has5m(body prefix) ${has5m(rPro)}`);
  expect(rNone.status, 'no header').toBe(200); expect(rBasic.status, 'Basic x must read as an anonymous visitor').toBe(200);
  expect(rJunk.status, 'a token the auth server rejects').toBe(401); expect(rJunk.body).toContain('TOKEN_EXPIRED');
  expect(rPro.status, 'Pro fixture token').toBe(200); expect(proFull, 'the Pro caller does not get the 5m field').toBe(true); expect(noneFull, 'an anonymous caller got the Pro-only 5m field').toBe(false);

  const KEY = 'qa-2701-probe'; const auth = tok(token);
  const keys = async () => { const r = await call(page, '/api/alert-prefs', auth); let k: string[] = []; try { k = (JSON.parse(r.body) as { muted?: string[] }).muted ?? []; } catch { /* body cut */ } return { status: r.status, keys: k, raw: r.body }; };
  const before = await keys();
  const basicSave = await call(page, '/api/alert-prefs', 'Basic eDp4', { method: 'POST', json: { key: KEY, muted: true } }); const afterBasic = await keys();
  const save = await call(page, '/api/alert-prefs', auth, { method: 'POST', json: { key: KEY, muted: true } }); const saved = await keys();
  const clear = await call(page, '/api/alert-prefs', auth, { method: 'POST', json: { key: KEY, muted: false } }); const cleared = await keys();
  console.log(`[P3] read ${before.status} · basic save ${basicSave.status} (key present after: ${afterBasic.keys.includes(KEY)}) · token save ${save.status} (present: ${saved.keys.includes(KEY)}) · token clear ${clear.status} (present: ${cleared.keys.includes(KEY)})`);
  expect(before.status, `read: ${before.raw}`).toBe(200); expect(basicSave.status, 'Basic x must not save').toBe(401); expect(afterBasic.keys.includes(KEY)).toBe(false);
  expect(save.status).toBe(200); expect(saved.keys.includes(KEY), 'the mute did not land').toBe(true);
  expect(clear.status).toBe(200); expect(cleared.keys.includes(KEY), 'the throwaway mute was not removed').toBe(false);
});
