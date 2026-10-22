import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
const BASE = 'https://liquidity-hq.com';
const b = await chromium.launch();
for (const [w, h] of [[390, 844], [1280, 800]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.host === 'liquidity-hq.com' && ['GET', 'HEAD'].includes(r.request().method())) return r.continue(); return r.abort('failed'); });
  const p = await ctx.newPage(); await p.goto(BASE + '/upgrade', { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction(() => /launching soon|coming soon|Upgrade to Pro/i.test(document.body.innerText), null, { timeout: 60000 }).catch(() => {}); await p.waitForTimeout(1500);
  const r = await p.evaluate(() => ({ buttonsInMain: [...document.querySelectorAll('main button, [data-testid^="checkout-"], [data-testid="upgrade-reveal-plans"]')].map((e) => e.getAttribute('data-testid') || (e.textContent || '').trim().slice(0, 30)), soon: /launching soon|coming soon/i.test(document.body.innerText), scrollW: document.documentElement.scrollWidth }));
  console.log(JSON.stringify({ w, ...r, version: (await (await fetch(BASE + '/api/version')).json()).commit }));
  await ctx.close();
}
await b.close();
