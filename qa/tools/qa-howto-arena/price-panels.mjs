/* #1552: the prices that are NOT in the page text until a click: the /faq "How much does Pro cost" answer, and the /upgrade plan
 * buttons and checkout panels (monthly, annual, every 2 weeks). Free signed-in (plan stubbed), en, 1280, dark. Prints every price-looking token.
 * usage: node price-panels.mjs <qa|prod> */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
const B = (process.argv[2] === 'prod') ? PROD : QA;
const PR = /[$€£]\s?\d[\d.,]*(?:\/\w+)?|\b(?:35|350|49|490)\b(?!\.\d)/g;
const grab = (t) => (t.match(PR) || []).join(' ');
const browser = await chromium.launch();
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({})); console.log('build', v.commit);
  const ctx = await open(browser, { b: B, w: 1280, theme: 'dark', lang: 'en', signedIn: true, plan: 'free', settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
  const page = await ctx.newPage();
  await page.goto(B.base + '/faq', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(2500);
  const q = page.getByText(/how much does pro cost/i).first();
  console.log('FAQ question found:', await q.count());
  if (await q.count()) { await q.click({ timeout: 5000 }).catch(() => {}); await sleep(800); const ans = await page.evaluate(() => { const e = [...document.querySelectorAll('*')].find((x) => /how much does pro cost/i.test(x.textContent || '') && x.children.length < 4 && (x.textContent || '').length < 600); const box = e?.closest('details, [class*="faq"], li, div'); return (box?.innerText || e?.innerText || '').slice(0, 500); }); console.log('FAQ answer:', JSON.stringify(ans)); console.log('FAQ prices:', grab(ans)); }
  await page.goto(B.base + '/upgrade', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(3000);
  const reveal = page.locator('[data-testid="upgrade-reveal-plans"]'); if (await reveal.count()) { await reveal.click().catch(() => {}); await sleep(1200); }
  const btns = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="checkout-cta"]')].map((b) => ({ id: b.getAttribute('data-testid'), t: (b.innerText || '').replace(/\s+/g, ' ').trim() })));
  console.log('checkout buttons:', JSON.stringify(btns));
  for (const b of btns) { await page.locator(`[data-testid="${b.id}"]`).click({ timeout: 5000 }).catch(() => {}); await sleep(900); const p = await page.evaluate(() => (document.querySelector('[data-testid="checkout-method-panel"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 400)); console.log(b.id, '| panel:', JSON.stringify(p), '| prices:', grab(b.t + ' ' + p)); }
  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')); console.log('2 months free line:', JSON.stringify((body.match(/.{40}(?:2 months|two months|months free).{40}/i) || [''])[0]));
  await ctx.close();
} finally { await browser.close(); }
