/* #1520 How to test 1-5 on qa. Direct GETs of /api/market/rsi (public route, no credentials) plus /arena in the browser:
 * signed out, synthetic Free session (fake token -> the real server treats it as not entitled), and a Pro stub whose
 * /api/market/rsi response is the REAL response with rsi5m added (stubbed, to check the client renders a served 5m).
 * usage: node t-rsi.mjs */
import { chromium, open, settle, sleep, jlog, OUT, version } from './lib.mjs';
const L = jlog('rsi.json');
const BASE = 'https://liquidity-hq-qa.onrender.com';
const sum = (body) => { const m = body?.rsi ?? {}; const c = Object.values(m); return { coins: c.length, with5m: c.filter((v) => v && 'rsi5m' in v).length, with1h: c.filter((v) => v && 'rsi1h' in v).length, btcKeys: Object.keys(m.btc ?? {}).sort() }; };
const CARD = () => {
  const card = [...document.querySelectorAll('.edge-card')].find((c) => (c.textContent || '').includes('Multi-Timeframe Alignment')); if (!card) return null;
  const rows = [...card.querySelectorAll('div')].filter((d) => d.style.gridTemplateColumns === '28px 1fr 34px 84px' && d.children.length === 4 && !/TF/i.test(d.children[0].innerText)).map((d) => ({ tf: d.children[0].innerText.trim(), val: d.children[2].innerText.trim(), bias: d.children[3].innerText.trim(), blurred: !!d.querySelector('[style*="blur"]') }));
  const badge = card.querySelector(':scope > div > span'); return { rows, verdict: badge?.innerText ?? null };
};
async function run(browser, name, o) {
  const errors = []; const seen = [];
  const ctx = await open(browser, o); const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  page.on('response', async (r) => { if (r.url().includes('/api/market/rsi')) { const h = r.headers(); let b = null; try { b = await r.json(); } catch { /* */ } seen.push({ status: r.status(), auth: r.request().headers()['authorization'] ? 'Bearer present' : 'none', cc: h['cache-control'], vary: h['vary'], ...sum(b) }); } });
  await page.goto(BASE + '/arena', { waitUntil: 'load', timeout: 120_000 }); await settle(page);
  await page.waitForFunction(() => [...document.querySelectorAll('.edge-card')].some((c) => (c.textContent || '').includes('Multi-Timeframe Alignment')), null, { timeout: 30_000 }).catch(() => {});
  await sleep(6000);
  const c = page.locator('.edge-card', { hasText: 'Multi-Timeframe Alignment' }).first(); if (await c.count()) await c.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(500);
  const card = await page.evaluate(CARD);
  await page.screenshot({ path: `${OUT}/1520-${name}-card-1280.png` });
  L.say({ job: name, rsiResponses: seen, card, consoleErrors: errors.filter((e) => !/Failed to load resource|net::ERR_FAILED|ERR_ABORTED|WebSocket/i.test(e)), consoleErrorsAll: errors.length });
  await ctx.close();
}
const browser = await chromium.launch();
try {
  L.say({ served: await version() });
  for (const [label, h] of [['no header', {}], ['bogus bearer', { authorization: 'Bearer qa.not-a-real-token' }]]) {
    const r = await fetch(BASE + '/api/market/rsi', { headers: h }); const b = await r.json().catch(() => null);
    L.say({ job: 'direct', label, status: r.status, cc: r.headers.get('cache-control'), vary: r.headers.get('vary'), ...sum(b) });
  }
  await run(browser, 's1-signed-out', { signedIn: false });
  await run(browser, 's2-free', { plan: 'free' });
  const proStub = async (r, req, u) => { if (u.pathname !== '/api/market/rsi') return false; const real = await r.fetch(); const b = await real.json(); for (const v of Object.values(b.rsi ?? {})) if (v && typeof v === 'object') v.rsi5m = 42.0; await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': real.headers()['cache-control'] ?? '', vary: real.headers()['vary'] ?? '' }, body: JSON.stringify(b) }); return true; };
  await run(browser, 's3-pro-stubbed-rsi5m', { plan: 'pro', appStub: proStub });
} catch (e) { L.say({ crash: String(e).slice(0, 400) }); } finally { await browser.close(); L.save(); }
