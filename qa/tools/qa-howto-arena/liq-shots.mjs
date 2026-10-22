/* BASELINE screenshots of /liq as it is today (#1595 compares a proposal with this). Prod, signed out, read-only (page loads only; analytics consent denied; the harness
 * fence answers every app write locally and aborts every non-market host). Desktop 1280 and phone 390, dark and light: first screen (viewport) and the whole page.
 * Also logs: build, the page's visible text outline (headings + the first 40 text lines), whether any line already explains a level, and sideways scroll.
 * usage: node liq-shots.mjs <qa|prod> [out-dir]                                                                                                     */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync } from 'node:fs';
const B = process.argv[2] === 'qa' ? QA : PROD; const dir = process.argv[3] || `${OUT}/liq-shots/${B.tag}`; mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({})); console.log('build', v.commit, v.branch, new Date().toISOString());
  for (const [theme, w] of [['dark', 1280], ['light', 1280], ['dark', 390], ['light', 390]]) {
    const ctx = await open(browser, { b: B, w, theme, signedIn: false, liveWs: true }); const page = await ctx.newPage(); const tag = `liq-${w === 390 ? 'mobile' : 'desktop'}${theme === 'light' ? '-light' : ''}`;
    try {
      await page.goto(B.base + '/liq', { waitUntil: 'load', timeout: 120_000 }); await settle(page);
      await page.waitForFunction(() => document.body.innerText.length > 800, null, { timeout: 45_000 }).catch(() => {}); await sleep(9000);
      /* The page says "Warming up" / "Real cluster data building" until its live Binance + Bybit feeds have enough volume. The first capture closed those sockets (the harness default), so it showed
         that state because of the harness, not the site: liveWs lets the feeds through, and this waits (up to 90 s) for the text to go and reports how long it took. */
      const t0 = Date.now(); const WARM = /Warming up|building from live/i;
      while (Date.now() - t0 < 90_000 && WARM.test(await page.evaluate(() => document.body.innerText))) await sleep(3000);
      console.log(`${tag}: warming/building text gone after ${Math.round((Date.now() - t0) / 1000)} s of extra waiting (90 = still there)`); await sleep(2000);
      const info = await page.evaluate(() => { const t = document.body.innerText.split('\n').map((s) => s.trim()).filter(Boolean); return { path: location.pathname, h: [...document.querySelectorAll('h1,h2,h3')].map((e) => e.innerText.trim()).filter(Boolean).slice(0, 14), lines: t.slice(0, 40), canvases: document.querySelectorAll('canvas').length, len: t.length, scroll: [document.documentElement.scrollWidth, innerWidth], why: t.filter((s) => /\b(why|matters|because)\b/i.test(s)).slice(0, 6) }; });
      console.log(`${tag}: path=${info.path} canvases=${info.canvases} textLines=${info.len} scrollW/innerW=${info.scroll.join('/')}`);
      console.log(`  headings: ${JSON.stringify(info.h)}`); console.log(`  lines mentioning why/matters/because: ${JSON.stringify(info.why)}`);
      if (theme === 'dark' && w === 1280) console.log(`  first lines: ${JSON.stringify(info.lines)}`);
      await page.screenshot({ path: `${dir}/${tag}-1-first-screen.png` }); await page.screenshot({ path: `${dir}/${tag}-2-full-page.png`, fullPage: true });
    } catch (e) { console.log(tag, 'ERROR', String(e.message).slice(0, 120)); }
    await ctx.close();
  }
} finally { await browser.close(); }
