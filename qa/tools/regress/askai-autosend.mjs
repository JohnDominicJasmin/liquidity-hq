/* #1631 owner decision (2026-10-21): "Ask LiquidityAI" must open the chat and send NOTHING until the user presses Send. BEFORE-the-fix evidence:
 * as Pro A and Free B on /arena, 1280 dark, every AI request answered locally (no spend), click the page's "Ask LiquidityAI" button and the
 * chart panel's "ASK AI", and count POST /api/grok-chat (and /api/grok) requests in the 6 s after each click. usage: node askai-autosend.mjs [accts=A,B] */
import { chromium, open, quiet, sleep, BASE, ROOT } from './rlib.mjs';
import { mkdirSync, appendFileSync } from 'node:fs';
const accts = (process.argv[2] || 'A,B').split(',');
const DIR = `${ROOT}/arena`; mkdirSync(DIR, { recursive: true });
const say = (o) => { console.log(JSON.stringify(o)); appendFileSync(`${ROOT}/_sweep/askai.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n'); };
const browser = await chromium.launch();
try {
  console.log('build', (await (await fetch(BASE + '/api/version')).json()).commit, new Date().toISOString());
  for (const acct of accts) for (const [label, re] of [['page button "Ask LiquidityAI"', /^Ask LiquidityAI$/], ['chart panel "ASK AI"', /^ASK AI$/]]) {
    const rec = []; const ctx = await open(browser, { acct, w: 1280, rec }); const page = await ctx.newPage(); const inflight = new Map();
    page.on('request', (r) => inflight.set(r, Date.now())); page.on('requestfinished', (r) => inflight.delete(r)); page.on('requestfailed', (r) => inflight.delete(r));
    await page.goto(BASE + '/arena?coin=btc&tf=1h', { waitUntil: 'load', timeout: 90_000 }); await quiet(page, inflight, 2500, 25_000); await sleep(1500);
    const before = rec.filter((n) => /\/api\/grok/.test(n.url)).length;
    const b = page.locator('button').filter({ hasText: re }).first(); const found = await b.count();
    if (found) { await b.click({ timeout: 5000 }).catch(() => {}); await sleep(6000); }
    const sent = rec.filter((n) => /\/api\/grok/.test(n.url)).slice(before).map((n) => `${n.m} ${n.url.replace(/\?.*$/, '')}`);
    const panel = await page.evaluate(() => { const p = document.querySelector('[data-testid="grok-panel"]'); const m = document.querySelector('[data-testid="grok-messages"]'); return { panelOpen: !!p && p.getBoundingClientRect().width > 0, messages: m ? (m.innerText || '').trim().slice(0, 160) : null, textarea: (document.querySelector('textarea[aria-label="Ask LiquidityAI"]')?.value || '').slice(0, 120) }; });
    await page.screenshot({ path: `${DIR}/askai-${acct}-${label.startsWith('page') ? 'page-button' : 'panel-button'}.jpg`, type: 'jpeg', quality: 70 });
    say({ acct, clicked: label, found: !!found, requestsSentByTheClick: sent, autoSent: sent.length > 0, ...panel });
    await ctx.close();
  }
} finally { await browser.close(); }
