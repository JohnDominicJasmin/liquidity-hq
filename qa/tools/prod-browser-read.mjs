/* Production, signed-out, public pages only: what /upgrade shows, and the two FAQ answers. Clicks only open an accordion. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const H = 'https://liquidity-hq.com';
const b = await chromium.launch();
for (const v of [{ n: 'desktop', vp: { width: 1280, height: 900 }, m: false }, { n: 'phone', vp: { width: 390, height: 844 }, m: true }]) {
  const ctx = await b.newContext({ viewport: v.vp, isMobile: v.m, hasTouch: v.m, deviceScaleFactor: v.m ? 2 : 1, colorScheme: 'light' });
  await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'light'); } catch {} });
  const page = await ctx.newPage();
  await page.goto(H + '/upgrade', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(8000);
  const dec = page.getByRole('button', { name: 'Decline' }); if (await dec.count()) { await dec.first().click(); await page.waitForTimeout(600); }
  const info = await page.evaluate(() => ({ url: location.href, theme: document.documentElement.getAttribute('data-theme'), text: document.body.innerText }));
  const lines = info.text.split('\n').map((s) => s.trim()).filter(Boolean);
  const keep = lines.filter((l) => /\$\d|coming soon|Get Pro|store|notify|month|weeks|year|Sign|checkout|live/i.test(l) && !/NBC|Lawmakers|·/.test(l));
  console.log(`/upgrade ${v.n}: url=${info.url} data-theme=${info.theme}`); for (const l of keep.slice(0, 16)) console.log('    ' + l.slice(0, 150));
  await page.evaluate(() => { for (const el of document.querySelectorAll('*')) { if (getComputedStyle(el).position === 'fixed') el.style.visibility = 'hidden'; } });
  await page.screenshot({ path: `${OUT}/prod-upgrade-light-${v.n}-fullpage.png`, fullPage: true });
  if (v.n === 'desktop') {
    await page.goto(H + '/faq', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(6000);
    for (const q of ['How much does Pro cost?', 'How do I cancel or change my plan?']) {
      const btn = page.getByText(q, { exact: false }).first();
      await btn.click({ timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(700);
      const ans = await page.evaluate((qq) => { const el = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && (e.textContent || '').includes(qq)); const p = el && (el.closest('[class*="faq"], li, div')); return p ? p.innerText.replace(/\s+/g, ' ').slice(0, 320) : '(not found)'; }, q);
      console.log(`FAQ "${q}" -> ${ans}`);
    }
  }
  await ctx.close();
}
await b.close();
