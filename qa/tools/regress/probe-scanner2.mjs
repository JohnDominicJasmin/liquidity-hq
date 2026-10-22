import { chromium, open, quiet, sleep, BASE, ROOT } from './rlib.mjs';
const browser = await chromium.launch();
try {
  const ctx = await open(browser, { acct: 'B', w: 1280 }); const page = await ctx.newPage(); const inflight = new Map();
  page.on('request', (r) => inflight.set(r, Date.now())); page.on('requestfinished', (r) => inflight.delete(r)); page.on('requestfailed', (r) => inflight.delete(r));
  await page.goto(BASE + '/arena?coin=btc&tf=1h', { waitUntil: 'load' }); await quiet(page, inflight, 2000, 20000); await sleep(1500);
  const trig = page.locator('xpath=//button[normalize-space(.)="Meme"]/../following-sibling::div[1]//button[@aria-expanded]').first();
  console.log('count', await trig.count(), 'expanded before', await trig.getAttribute('aria-expanded'));
  await trig.click(); await sleep(1500);
  console.log('expanded after click', await trig.getAttribute('aria-expanded'));
  const r = await page.evaluate(() => { const meme = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Meme'); const wrap = meme.parentElement.nextElementSibling; const t = wrap.querySelector('button[aria-expanded]'); const anc = []; let x = t; for (let i = 0; i < 6 && x; i++, x = x.parentElement) anc.push(`${i}:${x.tagName} kids=${x.children.length} btns=${x.querySelectorAll('button').length} text=${JSON.stringify((x.innerText || '').slice(0, 60))}`); return { wrapText: (wrap.innerText || '').slice(0, 300), wrapButtons: wrap.querySelectorAll('button').length, anc }; });
  console.log(JSON.stringify(r, null, 1));
  await page.screenshot({ path: `${ROOT}/arena/_probe-scanner-open.jpg`, type: 'jpeg', quality: 70 });
  await ctx.close();
} finally { await browser.close(); }
