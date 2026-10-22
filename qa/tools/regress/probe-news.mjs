/* Why ask5 found no news Ask button: what /news shows as Pro A (cards, tabs, ask buttons, empty/error text), plus a screenshot. Writes off. */
import { chromium, open, quiet, sleep, BASE, ROOT } from './rlib.mjs';
const browser = await chromium.launch();
try {
  const rec = []; const ctx = await open(browser, { acct: 'A', w: 1280, rec }); const page = await ctx.newPage(); const inflight = new Map();
  page.on('request', (r) => inflight.set(r, Date.now())); page.on('requestfinished', (r) => inflight.delete(r)); page.on('requestfailed', (r) => inflight.delete(r));
  await page.goto(BASE + '/news', { waitUntil: 'load', timeout: 90_000 }); await quiet(page, inflight, 2500, 30_000);
  for (const wait of [0, 15_000]) {
    await sleep(wait);
    const s = await page.evaluate(() => ({
      url: location.href,
      cards: document.querySelectorAll('[class*="ncard"]').length,
      askBtns: document.querySelectorAll('.ncard-ask-btn').length,
      badges: [...document.querySelectorAll('.ncard-type-badge')].slice(0, 8).map((e) => e.textContent),
      tabs: [...document.querySelectorAll('[role="tab"], button[aria-pressed]')].slice(0, 12).map((e) => `${e.textContent?.trim()}${e.getAttribute('aria-selected') === 'true' || e.getAttribute('aria-pressed') === 'true' ? '*' : ''}`),
      text: document.querySelector('main')?.innerText.slice(0, 900),
    }));
    console.log(JSON.stringify({ afterMs: wait, ...s }));
  }
  const supa = rec.filter((n) => /supabase|news/i.test(n.url)).slice(0, 15).map((n) => `${n.m} ${n.status ?? ''} ${n.url.replace(/\?.*$/, '').slice(-80)}`);
  console.log(JSON.stringify({ requests: supa }));
  await page.screenshot({ path: `${ROOT}/ask5/news-probe.jpg`, type: 'jpeg', quality: 70 });
  await ctx.close();
} finally { await browser.close(); }
