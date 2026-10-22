/* #1613 / #1617 (#1615, #1621) on qa: do the surfaces that talk about open interest agree? For each coin, on a cold load as a stubbed Pro viewer (said so: plan stubbed, no sign-in): the Arena card's Open Interest label and the figure beside it,
 * the Briefing tags and digest line, the Dashboard chip, and the prompt Quick Research would send (the POST to /api/grok is answered locally: no AI call is made) with its OI line. Text only, plus the OI lines pulled from each.
 * Then the loading behaviour: for the first 12 seconds of one Arena load, once a second: what the OI card shows (skeleton, dash, label), to see a label that flips. A block case: /api/proxy?type=oi-hist aborted.
 * usage: node oi-surfaces.mjs [qa|prod] [coins csv=btc,eth,xrp]                                                                                                                                       */
import { chromium, open, settle, sleep, QA, PROD } from './lib.mjs';
const [, , bArg = 'qa', coinsArg = 'btc,eth,xrp'] = process.argv; const B = bArg === 'prod' ? PROD : QA;
const OI = (t) => t.split('\n').map((s) => s.trim()).filter((s) => /\b(OI|open interest)\b/i.test(s)).slice(0, 8);
const browser = await chromium.launch();
try {
  console.log('build', (await (await fetch(B.base + '/api/version')).json().catch(() => ({}))).commit, new Date().toISOString());
  for (const coin of coinsArg.split(',')) {
    const prompts = []; const ctx = await open(browser, { b: B, w: 1280, theme: 'dark', signedIn: true, plan: 'pro', liveWs: true, settings: { default_coin: coin, default_tf: '1h', strategy_selection: [], strategy_params: {} },
      appStub: async (r, req, u) => { if (req.method() === 'POST' && /^\/api\/grok$/.test(u.pathname)) { prompts.push(req.postData() || ''); await r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"qa-stub","code":"RATE_LIMITED"}' }); return true; } return false; } });
    const page = await ctx.newPage(); const trace = [];
    await page.goto(`${B.base}/arena?coin=${coin}&tf=1h`, { waitUntil: 'commit', timeout: 120_000 });
    for (let i = 0; i < 12; i++) { trace.push(await page.evaluate(() => { const t = document.body.innerText.split('\n').map((s) => s.trim()); const i = t.findIndex((s) => /^open interest$/i.test(s)); return i >= 0 ? t.slice(i, i + 5).join(' / ') : '(no OI card yet)'; }).catch(() => '(busy)')); await sleep(1000); }
    await settle(page); await page.waitForFunction(() => document.querySelectorAll('canvas').length > 3, null, { timeout: 60_000 }).catch(() => {}); await sleep(6000);
    const arena = await page.evaluate(() => document.body.innerText); const q = page.locator('button', { hasText: /^quick$/i }).first(); if (await q.count()) await q.click({ timeout: 4000 }).catch(() => {}); await sleep(3500);
    const line = (prompts.join(' ').match(/OI Trend vs Price[^\\"]{0,120}/) || ['(not found in the request)'])[0].replace(/\\n/g, ' ');
    console.log(`\n=== ${coin} Arena: first 12 s of the OI card (one line a second)\n  ${trace.filter((x, i) => i === 0 || x !== trace[i - 1]).join('\n  ')}`);
    console.log(`  settled OI lines: ${JSON.stringify(OI(arena))}`); console.log(`  AI prompt line: ${line}`);
    for (const path of ['/dashboard', '/briefing']) { await page.goto(`${B.base}${path}`, { waitUntil: 'load', timeout: 120_000 }).catch(() => {}); await settle(page); await sleep(9000); console.log(`  ${path} OI lines: ${JSON.stringify(OI(await page.evaluate(() => document.body.innerText)))}`); }
    await ctx.close();
  }
  { // blocked OI history
    const ctx = await open(browser, { b: B, w: 1280, theme: 'dark', signedIn: true, plan: 'pro', liveWs: true, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
    await ctx.route('**/api/proxy?type=oi-hist*', (r) => r.abort('failed')); const page = await ctx.newPage();
    await page.goto(`${B.base}/arena?coin=btc&tf=1h`, { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(12_000);
    const t = await page.evaluate(() => { const l = document.body.innerText.split('\n').map((s) => s.trim()); const i = l.findIndex((s) => /^open interest$/i.test(s)); return i >= 0 ? l.slice(i, i + 5).join(' / ') : '(no OI card)'; });
    console.log(`\n=== BLOCKED /api/proxy?type=oi-hist, btc: OI card: ${t}`); await ctx.close();
  }
} finally { await browser.close(); }
