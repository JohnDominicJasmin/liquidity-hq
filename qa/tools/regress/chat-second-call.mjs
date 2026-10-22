/* What is the SECOND /api/grok-chat POST the Ask AI panel sends right after an answer (seen in the billed Free chat at 06:19:58)? No spend: as Free B
 * on /arena, every /api/grok-chat POST is answered locally with the real answer captured at 06:19 (ai/free-chat-btc-1h-response-1.txt), and every
 * POST body is recorded with its time. usage: node chat-second-call.mjs [acct=B] */
import { chromium, open, quiet, sleep, BASE, ROOT } from './rlib.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const acct = process.argv[2] || 'B';
const STUB = readFileSync(`${ROOT}/ai/free-chat-btc-1h-response-1.txt`, 'utf8');
const posts = [];
const appStub = async (r, req, u) => { if (req.method() === 'POST' && u.pathname === '/api/grok-chat') { posts.push({ at: new Date().toISOString(), body: req.postData() || '' }); await r.fulfill({ status: 200, contentType: 'application/json', body: STUB }); return true; } return false; };
const browser = await chromium.launch();
try {
  const ctx = await open(browser, { acct, w: 1280, appStub }); const page = await ctx.newPage(); const inflight = new Map();
  page.on('request', (r) => inflight.set(r, Date.now())); page.on('requestfinished', (r) => inflight.delete(r)); page.on('requestfailed', (r) => inflight.delete(r));
  await page.goto(BASE + '/arena?coin=btc&tf=1h', { waitUntil: 'load', timeout: 90_000 }); await quiet(page, inflight, 2500, 25_000); await sleep(1500);
  await page.getByTestId('grok-launcher').click({ timeout: 5000 }).catch(() => {}); await sleep(2000);
  const ta = page.locator('[data-testid="grok-panel"] textarea[aria-label="Ask LiquidityAI"]').first();
  await ta.click().catch(() => {}); await ta.fill('Summarize the current BTC 1h setup from the data you have: trend, funding rate, open interest and the key levels.').catch(() => {}); await sleep(400);
  const t0 = Date.now(); await page.locator('[data-testid="grok-panel"] button[aria-label="Send"]').first().click({ timeout: 5000 }).catch(() => {});
  await sleep(12_000);
  const summary = posts.map((p, i) => { let j = {}; try { j = JSON.parse(p.body); } catch { /* */ } return { n: i + 1, msAfterSend: Date.parse(p.at) - t0, mode: j.mode ?? null, keys: Object.keys(j), lastUserMessage: (j.messages || []).filter((m) => m.role === 'user').slice(-1)[0]?.content?.slice(0, 160) ?? null, systemStart: (j.messages || []).find((m) => m.role === 'system')?.content?.slice(0, 80) ?? null }; });
  mkdirSync(`${ROOT}/ai/_chat-second-call`, { recursive: true });
  writeFileSync(`${ROOT}/ai/_chat-second-call/posts.json`, JSON.stringify(posts, null, 1));
  console.log(JSON.stringify(summary, null, 1));
  await page.screenshot({ path: `${ROOT}/ai/_chat-second-call/panel.png` });
  await ctx.close();
} finally { await browser.close(); }
