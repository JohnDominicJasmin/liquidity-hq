/* PR #1585 at page level: Quick Research with /api/grok answered by a STUB (the request is answered locally; no AI call is made). A stub is a stub: it shows what
 * the page does with an empty, partial, HTML or complete answer, not what a real AI failure looks like.
 * Variants: empty ({}), result-empty ({"result":{}}), partial ({"result":{"signal":"FLAT","confidence":40}}), html (200 text/html), full (a complete read), 429.
 * Reads: the error/notice text near the top of the Arena (TypeError text, "came back empty", "Binance data unavailable"), whether a read (signal) rendered,
 * whether the page still works (a timeframe click changes the highlighted button). Screenshot of the page top and the read area.
 * usage: node grok-stub.mjs <qa|prod> <variant> [width=1280] [theme=dark]                                                                    */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync } from 'node:fs';
const [, , bArg = 'qa', variant = 'empty', wArg = '1280', theme = 'dark'] = process.argv; const B = bArg === 'prod' ? PROD : QA; const w = Number(wArg); const dir = `${OUT}/grok-stub/${B.tag}`; mkdirSync(dir, { recursive: true });
const FULL = { result: { signal: 'BULLISH', confidence: 70, bias: 'Bullish', waitFor: 'qa stub: nothing to wait for', raidSetup: 'qa stub setup', raidTarget: 'qa stub target', raidTrigger: 'qa stub trigger', catalysts: ['qa stub catalyst'], reasoning: 'qa stub reasoning' } };
const ANSWERS = { empty: { status: 200, type: 'application/json', body: '{}' }, 'result-empty': { status: 200, type: 'application/json', body: '{"result":{}}' }, partial: { status: 200, type: 'application/json', body: '{"result":{"signal":"FLAT","confidence":40}}' }, html: { status: 200, type: 'text/html', body: '<html><body>qa stub gateway page</body></html>' }, full: { status: 200, type: 'application/json', body: JSON.stringify(FULL) }, '429': { status: 429, type: 'application/json', body: '{"error":"qa-stub","code":"RATE_LIMITED"}' } };
const A = ANSWERS[variant]; if (!A) { console.log('unknown variant', variant); process.exit(1); }
const browser = await chromium.launch();
try {
  console.log('build', (await (await fetch(B.base + '/api/version')).json().catch(() => ({}))).commit, '| variant', variant, '| width', w, theme);
  let grokCalls = 0;
  const ctx = await open(browser, { b: B, w, theme, signedIn: true, plan: 'pro', liveWs: true, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} },
    appStub: async (r, req, u) => { if (req.method() === 'POST' && /^\/api\/grok$/.test(u.pathname)) { grokCalls++; await r.fulfill({ status: A.status, contentType: A.type, body: A.body }); return true; } return false; } });
  const page = await ctx.newPage();
  await page.goto(`${B.base}/arena?coin=btc&tf=1h`, { waitUntil: 'load', timeout: 120_000 }); await settle(page);
  await page.waitForFunction(() => document.querySelectorAll('canvas').length > 3, null, { timeout: 60_000 }).catch(() => {}); await sleep(9000);
  await page.locator('button', { hasText: /^quick$/i }).first().click({ timeout: 5000 }).catch(() => {}); await sleep(7000);
  const r = await page.evaluate(() => { const t = document.body.innerText.replace(/\s+/g, ' '); const m = t.match(/Cannot read properties[^.]{0,80}|The AI read came back empty[^.]{0,40}\.?|Binance data unavailable[^.]{0,40}|PRO_REQUIRED|Too many requests[^.]{0,40}|rate limit[^.]{0,40}/i); const sig = (t.match(/\b(STRONG BUY|STRONG SELL|BUY|SELL|FLAT|WAIT|NO TRADE)\b[^A-Za-z]{0,6}\d{1,3}\s?%/) || [''])[0]; const after = (t.match(/Ask LiquidityAI\s+(.{0,150})/) || [, ''])[1]; return { notice: m ? m[0] : null, readShown: sig || null, qaStubText: /qa stub/.test(t), afterButtons: after }; });
  const before = await page.evaluate(() => (document.querySelector('.klc-tf-btn.on')?.textContent || '').trim()); await page.locator('.klc-tf-btn', { hasText: /^15m$/ }).first().click({ timeout: 5000 }).catch(() => {}); await sleep(2500); const after = await page.evaluate(() => (document.querySelector('.klc-tf-btn.on')?.textContent || '').trim());
  await page.screenshot({ path: `${dir}/${variant}-${theme}-${w}.png`, fullPage: true }).catch(() => {});
  console.log(`/api/grok calls=${grokCalls} | notice=${JSON.stringify(r.notice)} | read shown=${JSON.stringify(r.readShown)} | stub text on page=${r.qaStubText} | text after buttons="${r.afterButtons}" | page still works (timeframe ${before} -> ${after})`);
  await ctx.close();
} finally { await browser.close(); }
