import { chromium, open, quiet, sleep, BASE } from './rlib.mjs';
const browser = await chromium.launch();
try {
  const ctx = await open(browser, { acct: 'B', w: 1280 }); const page = await ctx.newPage(); const inflight = new Map();
  page.on('request', (r) => inflight.set(r, Date.now())); page.on('requestfinished', (r) => inflight.delete(r)); page.on('requestfailed', (r) => inflight.delete(r));
  await page.goto(BASE + '/arena?coin=btc&tf=1h', { waitUntil: 'load' }); await quiet(page, inflight, 2000, 20000); await sleep(1500);
  const info = await page.evaluate(() => [...document.querySelectorAll('button[aria-expanded]')].map((b) => ({ text: JSON.stringify(b.textContent.slice(0, 40)), inner: JSON.stringify((b.innerText || '').slice(0, 40)), exp: b.getAttribute('aria-expanded'), y: Math.round(b.getBoundingClientRect().top) })));
  console.log(JSON.stringify(info));
  const trig = page.locator('button[aria-expanded]').nth(info.findIndex((x) => /BTC/.test(x.inner)));
  await trig.click(); await sleep(1200);
  const list = await page.evaluate(() => { const t = [...document.querySelectorAll('button[aria-expanded="true"]')].find((x) => /BTC/.test(x.innerText)); let box = t; for (let i = 0; i < 4 && box; i++) box = box.parentElement; const rows = box ? [...box.querySelectorAll('*')].filter((e) => e.children.length === 0 && /^[A-Z0-9]{2,8}$/.test((e.textContent || '').trim())).map((e) => ({ t: e.textContent.trim(), tag: e.tagName, clickable: !!e.closest('button,[role="button"],[role="option"],a,[onclick]'), parentTag: e.parentElement?.tagName, role: e.closest('[role]')?.getAttribute('role') })).slice(0, 12) : []; return { found: !!t, rows }; });
  console.log(JSON.stringify(list));
  const sample = await page.evaluate(() => { const el = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === 'ETH'); if (!el) return null; const chain = []; let x = el; for (let i = 0; i < 6 && x; i++, x = x.parentElement) chain.push(`${x.tagName}${x.getAttribute('role') ? '[' + x.getAttribute('role') + ']' : ''}${x.onclick ? '(onclick)' : ''} cursor=${getComputedStyle(x).cursor}`); return chain; });
  console.log(JSON.stringify(sample));
  await ctx.close();
} finally { await browser.close(); }
