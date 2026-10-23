/* ONE real Deep read on qa, captured with the source data of the same moment, so every number in the answer can be traced (#1651, the
 * owner's method: "AI says ABC, and then you do the research about it").
 *
 * COSTS ONE BILLED AI CALL and nothing else: rlib answers every other AI request locally, writes stay refused, and the allowance is a
 * single path. Planned rather than repeated - a Deep read carries the numeric claims, the dated catalysts and the verdict together, so one
 * call covers all three of the checks asked for.
 *
 * It verifies NOTHING by itself. It writes two files - the answer, and the sources read from the venues directly within seconds of it -
 * for a human to compare. A script that graded its own evidence would be the thing this exercise exists to avoid.
 * usage: node ai-answer-verify.mjs [coin=btc] [tf=1h] [mode=deep|quick]
 */
import { chromium, open, quiet, sleep, BASE, ROOT, assertMarketDataReached } from './rlib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const coin = (process.argv[2] || 'btc').toLowerCase();
const tf = process.argv[3] || '1h';
const mode = (process.argv[4] || 'deep').toLowerCase();
/* PHASE A, the default: the AI request is answered LOCALLY, so this costs nothing and still captures the CONTEXT the page gives the
   model - every number in it can be traced to a venue. If the page tells the model something untrue, the answer is wrong whatever the
   model does, and that is checkable for free. PHASE B (`real` as the 4th argument) lets the one call through and captures the answer. */
const real = process.argv.slice(2).includes('real');
const DIR = `${ROOT}/ai-verify`; mkdirSync(DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const SYM = { btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT', xrp: 'XRPUSDT' }[coin] ?? 'BTCUSDT';

/* The venues, read directly. Bybit for price/OI/ratio (the dashboard's source since #1696), Binance for funding and the long/short
   account ratio it alone publishes. Read AFTER the answer lands, so the comparison is against data no older than the read. */
async function sources() {
  const get = async (url) => { try { const r = await fetch(url, { cache: 'no-store' }); return { ok: r.ok, status: r.status, body: await r.json() }; } catch (e) { return { ok: false, error: String(e).slice(0, 120) }; } };
  const [kline, oi, ratio, fundBy, fundBi, tick] = await Promise.all([
    get(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${SYM}&interval=60&limit=200`),
    get(`https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${SYM}&intervalTime=5min&limit=13`),
    get(`https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${SYM}&period=1h&limit=1`),
    get(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${SYM}`),
    get(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${SYM}`),
    get(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${SYM}`),
  ]);
  return { at: new Date().toISOString(), symbol: SYM, kline, openInterest: oi, accountRatio: ratio, fundingBybit: fundBy, fundingBinance: fundBi, spotTicker: tick };
}

const rec = [];
const browser = await chromium.launch();
try {
  const build = (await (await fetch(BASE + '/api/version')).json()).commit;
  /* The ONE allowance: POST /api/grok, the read itself. Everything else AI-shaped stays answered locally by the fence. */
  const ctx = await open(browser, { acct: 'A', w: 1280, rec, ...(real ? { allowAI: /^\/api\/grok$/ } : {}) });
  const page = await ctx.newPage();
  const sent = [];
  page.on('request', (r) => { if (/\/api\/grok$/.test(new URL(r.url()).pathname) && r.method() === 'POST') sent.push(r.postData() ?? ''); });
  const answers = [];
  page.on('response', async (r) => {
    if (/\/api\/grok$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST') {
      answers.push(await r.json().catch(() => ({ unparseable: true })));
    }
  });

  const inflight = new Map();
  page.on('request', (r) => inflight.set(r, Date.now()));
  page.on('requestfinished', (r) => inflight.delete(r));
  page.on('requestfailed', (r) => inflight.delete(r));

  await page.goto(`${BASE}/arena?coin=${coin}&tf=${tf}`, { waitUntil: 'load', timeout: 90_000 });
  await quiet(page, inflight, 2500, 40_000); await sleep(3000);
  assertMarketDataReached(ctx, 'ai-answer-verify');

  const btn = page.getByRole('button', { name: mode === 'deep' ? 'DEEP' : 'QUICK', exact: true });
  if (!(await btn.count())) throw new Error(`the ${mode.toUpperCase()} button is not on the page as account A`);
  await btn.first().click({ timeout: 10_000 });

  /* Deep takes a while. Wait for the signal card, then for the text to stop growing, so a partial render is not captured as the answer. */
  if (real) await page.locator('.arena-signal-card').first().waitFor({ state: 'visible', timeout: 180_000 });
  else await sleep(8000);   // phase A: the local answer is refused by the page, so there is no card to wait for
  let prev = '', stable = 0;
  for (let i = 0; i < 60 && stable < 3; i++) {
    await sleep(2000);
    const now = await page.locator('main').innerText().catch(() => '');
    stable = now === prev ? stable + 1 : 0; prev = now;
  }

  const shown = await page.evaluate(() => {
    const txt = (sel) => Array.from(document.querySelectorAll(sel)).map((e) => e.innerText.trim()).filter(Boolean);
    return {
      signalCard: txt('.arena-signal-card').join('\n---\n'),
      links: Array.from(document.querySelectorAll('main a[href^="http"]')).map((a) => ({ href: a.href, text: a.innerText.trim().slice(0, 120) })),
      mainText: document.querySelector('main')?.innerText ?? '',
    };
  });
  await page.screenshot({ path: `${DIR}/${stamp}-${coin}-${tf}-${mode}.jpg`, type: 'jpeg', quality: 70, fullPage: true });

  const src = await sources();
  writeFileSync(`${DIR}/${stamp}-answer.json`, JSON.stringify({ build, coin, tf, mode, phase: real ? 'B real answer' : 'A context only, no AI spend', at: new Date().toISOString(), requestSent: sent, apiAnswer: answers, shown }, null, 1));
  writeFileSync(`${DIR}/${stamp}-sources.json`, JSON.stringify(src, null, 1));
  console.log(JSON.stringify({ build, coin, tf, mode, aiRequests: rec.filter((n) => /\/api\/grok/.test(n.url)).map((n) => `${n.kind} ${n.m} ${n.url.replace(/\?.*$/, '')}`), answerFile: `${DIR}/${stamp}-answer.json`, sourcesFile: `${DIR}/${stamp}-sources.json` }, null, 1));
  await ctx.close();
} finally { await browser.close(); }
