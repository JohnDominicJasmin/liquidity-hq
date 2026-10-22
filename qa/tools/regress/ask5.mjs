/* #1668 RC check (#1631 owner decision): every "Ask" entry point opens the chat PREFILLED and sends NOTHING until Send; Send makes exactly one
 * POST /api/grok-chat. Five buttons: Arena page "Ask LiquidityAI", the chart panel "ASK AI", EMA signal "Explain signal" (all /arena), a news
 * headline's and a whale card's "Ask LiquidityAI" (/news). As Pro A, 1280. NO AI SPEND: rlib answers every /api/grok* request locally
 * (POST = app-write-local, paid GET = ai-get-local) and records it. usage: node ask5.mjs [acct=A] */
import { chromium, open, quiet, sleep, BASE, ROOT } from './rlib.mjs';
import { mkdirSync, appendFileSync } from 'node:fs';
const acct = process.argv[2] || 'A';
const only = process.argv[3] ? new RegExp(process.argv[3], 'i') : null; // optional: run only the buttons whose label matches
const DIR = `${ROOT}/ask5`; mkdirSync(DIR, { recursive: true });
const say = (o) => { console.log(JSON.stringify(o)); appendFileSync(`${ROOT}/_sweep/ask5.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n'); };
/* The dev project's news table has had no row since 2026-08-03 (QA, 2026-10-22), so qa's /news is always empty and has no Ask button. Stand-ins,
   browser-side only (no database write): the news read answers two fresh red-severity rows, and a whale card comes from one synthetic
   'whale-trade' event (MarketProvider dispatches the same event for a real large trade). They test the button wiring, not the feeds. */
async function stubNews(page) {
  const now = Date.now();
  const rows = [0, 1].map((i) => ({ dedup_key: `qa-standin-${now}-${i}`, headline: `QA stand-in headline ${i + 1}: Fed holds rates steady`, source: 'Reuters',
    published_at: new Date(now - (i + 1) * 60_000).toISOString(), severity: 'red', cat: null, link: null, image: null }));
  await page.route(/\/rest\/v1\/lhq_dev_news\b/, (r) => r.request().method() === 'GET'
    ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) }) : r.fallback());
}
async function fakeWhale(page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('whale-trade',
    { detail: { id: 987654321, symbol: 'BTC', side: 'BUY', usdValue: 5_000_000, price: 100_000, qty: 50, ts: Date.now() } })));
  await sleep(1500);
}
const BUTTONS = [
  { label: 'arena page "Ask LiquidityAI"', path: '/arena?coin=btc&tf=1h', find: (p) => p.locator('button').filter({ hasText: /^Ask LiquidityAI$/ }).first() },
  { label: 'chart panel "ASK AI"', path: '/arena?coin=btc&tf=1h', find: (p) => p.locator('button').filter({ hasText: /^ASK AI$/ }).first() },
  { label: 'EMA signal "Explain signal"', path: '/arena?coin=btc&tf=1h', find: (p) => p.locator('button').filter({ hasText: /^Explain signal$/ }).first() },
  { label: 'news headline "Ask LiquidityAI"', path: '/news', before: stubNews, find: (p) => p.locator('.ncard-ask-btn').filter({ hasNot: p.locator('xpath=ancestor::*[.//*[contains(@class,"ncard-type-badge") and contains(., "Whale")]][1]') }).first() },
  { label: 'news whale "Ask LiquidityAI"', path: '/news', after: fakeWhale, find: (p) => p.locator('.ncard-type-badge', { hasText: /Whale/ }).first().locator('xpath=ancestor::*[.//button[contains(@class,"ncard-ask-btn")]][1]').locator('.ncard-ask-btn').first() },
];
const ai = (rec, from) => rec.slice(from).filter((n) => /\/api\/grok/.test(n.url)).map((n) => `${n.m} ${n.url.replace(/\?.*$/, '')}`);
const browser = await chromium.launch();
try {
  console.log('build', (await (await fetch(BASE + '/api/version')).json()).commit, new Date().toISOString());
  for (const b of BUTTONS.filter((x) => !only || only.test(x.label))) {
    const rec = []; const ctx = await open(browser, { acct, w: 1280, rec }); const page = await ctx.newPage(); const inflight = new Map();
    page.on('request', (r) => inflight.set(r, Date.now())); page.on('requestfinished', (r) => inflight.delete(r)); page.on('requestfailed', (r) => inflight.delete(r));
    if (b.before) await b.before(page);
    await page.goto(BASE + b.path, { waitUntil: 'load', timeout: 90_000 }); await quiet(page, inflight, 2500, 30_000); await sleep(2000);
    if (b.after) await b.after(page);
    const btn = b.find(page); const found = (await btn.count()) > 0;
    let onClick = [], onSend = [], prefilled = '', panelOpen = false;
    if (found) {
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      const c0 = rec.length; await btn.click({ timeout: 8000 }); await sleep(6000);
      onClick = ai(rec, c0).filter((x) => x.startsWith('POST'));
      prefilled = (await page.locator('textarea[aria-label="Ask LiquidityAI"]').inputValue().catch(() => '')).slice(0, 100);
      panelOpen = await page.evaluate(() => { const p = document.querySelector('[data-testid="grok-panel"]'); return !!p && p.getBoundingClientRect().width > 0; });
      const s0 = rec.length; await page.locator('button[aria-label="Send"]').first().click({ timeout: 8000 }).catch(() => {}); await sleep(5000);
      onSend = ai(rec, s0).filter((x) => x.startsWith('POST'));
      await page.screenshot({ path: `${DIR}/${b.label.replace(/[^a-z0-9]+/gi, '-')}.jpg`, type: 'jpeg', quality: 70 });
    }
    const pass = found && onClick.length === 0 && panelOpen && prefilled.length > 0 && onSend.length === 1 && onSend[0] === 'POST /api/grok-chat';
    say({ acct, button: b.label, found, panelOpen, prefilled, postsOnClick: onClick, postsOnSend: onSend, verdict: found ? (pass ? 'PASS' : 'FAIL') : 'NOT PRESENT' });
    await ctx.close();
  }
} finally { await browser.close(); }
