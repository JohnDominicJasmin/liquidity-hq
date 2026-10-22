/* #1630 / #1638 / #1642, after Dev promotes them to qa: how the ops pages show spare account C whose user_subscriptions row has been set (by me, one
 * approved row write) to role 'pro' with current_period_end = now - 49 h. READ-ONLY here: as the seeded ADMIN account (real session, writes OFF),
 * GET /api/ops/users/<C> and /api/ops/overview, and the /ops/users/<C> page: C must show Free, not count as Pro, and have no Revoke button.
 * usage: node ops-c-lapse.mjs <C user id> [label=after-write]                                                                                       */
import { chromium, open, quiet, sleep, session, BASE, ROOT } from './rlib.mjs';
import { mkdirSync, appendFileSync } from 'node:fs';
const [, , cId, label = 'after-write'] = process.argv;
if (!/^[0-9a-f-]{36}$/.test(cId || '')) { console.log('usage: node ops-c-lapse.mjs <C user id> [label]'); process.exit(1); }
const DIR = `${ROOT}/_c-lapse`; mkdirSync(DIR, { recursive: true });
const say = (o) => { console.log(JSON.stringify(o)); appendFileSync(`${DIR}/results.jsonl`, JSON.stringify({ at: new Date().toISOString(), label, ...o }) + '\n'); };
const s = await session('ADMIN');
const get = async (p) => { const r = await fetch(BASE + p, { headers: { Authorization: `Bearer ${s.access_token}` } }); let j = null; try { j = await r.json(); } catch { /* */ } return { status: r.status, j }; };
console.log('build', (await (await fetch(BASE + '/api/version')).json()).commit, new Date().toISOString());
const detail = await get(`/api/ops/users/${cId}`);
say({ step: 'GET /api/ops/users/<C>', status: detail.status, subscription: detail.j?.subscription ?? null });
const overview = await get('/api/ops/overview');
say({ step: 'GET /api/ops/overview', status: overview.status, proUsers: overview.j?.proUsers ?? null, activePaying: overview.j?.activePaying ?? null, totalUsers: overview.j?.totalUsers ?? null });
const browser = await chromium.launch();
try {
  const ctx = await open(browser, { acct: 'ADMIN', w: 1280 }); const page = await ctx.newPage(); const inflight = new Map();
  page.on('request', (r) => inflight.set(r, Date.now())); page.on('requestfinished', (r) => inflight.delete(r)); page.on('requestfailed', (r) => inflight.delete(r));
  await page.goto(`${BASE}/ops/users/${cId}`, { waitUntil: 'load', timeout: 90_000 }); await quiet(page, inflight, 2500, 25_000); await sleep(2000);
  const ui = await page.evaluate(() => ({ text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 600), revoke: [...document.querySelectorAll('button')].some((b) => /Revoke Pro/i.test(b.innerText)), grant: [...document.querySelectorAll('button')].some((b) => /Grant Pro/i.test(b.innerText)), proBadge: /\bPRO\b/.test(document.body.innerText) }));
  await page.screenshot({ path: `${DIR}/ops-user-C-${label}.jpg`, type: 'jpeg', quality: 70, fullPage: true });
  say({ step: 'page /ops/users/<C>', revokeButton: ui.revoke, grantButton: ui.grant, proBadgeAnywhere: ui.proBadge, text: ui.text });
  await ctx.close();
} finally { await browser.close(); }
