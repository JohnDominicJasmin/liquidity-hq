/* #1625 / #1628: read the OFFICIAL release schedules in a real browser page (bls.gov answers scripts with 403) and dump the text rows for 2026-2027, so the checked-in table (lib/econSchedule.ts) can be compared row by row by a second reader.
 * Read-only GET page loads of public agency pages; nothing is submitted. Output: one JSON file per source with the raw text lines containing a 2026/2027 date, and a status per page.
 * usage: node official-dates.mjs <out-dir>                                                                                                                                                     */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
const dir = process.argv[2] || '.'; mkdirSync(dir, { recursive: true });
const PAGES = {
  bls_cpi: 'https://www.bls.gov/schedule/news_release/cpi.htm', bls_empsit: 'https://www.bls.gov/schedule/news_release/empsit.htm', bls_ppi: 'https://www.bls.gov/schedule/news_release/ppi.htm',
  bea: 'https://www.bea.gov/news/schedule', census_retail: 'https://www.census.gov/retail/release_schedule.html', fed_fomc: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const browser = await chromium.launch();
try {
  for (const [name, url] of Object.entries(PAGES)) {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: 'en-US' }); const page = await ctx.newPage();
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }); await page.waitForTimeout(5000);
      const status = resp?.status(); const title = await page.title();
      const text = await page.evaluate(() => document.body.innerText);
      const lines = text.split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => /(2026|2027)/.test(s));
      writeFileSync(`${dir}/${name}.json`, JSON.stringify({ url, status, title, totalChars: text.length, lines }, null, 1));
      console.log(`${name}: HTTP ${status} | title "${title.slice(0, 60)}" | ${text.length} chars | ${lines.length} lines with 2026/2027`);
    } catch (e) { console.log(`${name}: ERROR ${String(e.message).slice(0, 100)}`); }
    await ctx.close();
  }
} finally { await browser.close(); }
