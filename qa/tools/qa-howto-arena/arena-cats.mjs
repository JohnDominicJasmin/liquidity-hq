/* #1597: the Arena coin category buttons (All / Majors / Alts / DeFi/AI / Meme). Source (app/arena/page.tsx): the buttons set `coinCat`, which filters ONLY the rows of the coin list that opens from the
 * scanner bar (the bar with the selected coin chip and the arrow). Expected rows = CAT_FILTER_COINS. For each viewer x width x category this:
 *   - clicks the category button, records the button's highlight, the URL, and whether ANY visible text OUTSIDE the category buttons and the coin bar changed (what a user sees without opening the list),
 *   - opens the coin list and reads the coin symbols in its rows, compared with the expected set (missing / extra),
 *   - screenshots the page (list closed) and the open list.
 * Plan is STUBBED for the signed-in viewer (no sign-in). usage: node arena-cats.mjs <qa|prod> [out-dir]                                                                          */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const B = process.argv[2] === 'prod' ? PROD : QA; const dir = process.argv[3] || `${OUT}/arena-cats/${B.tag}`; mkdirSync(dir, { recursive: true });
const EXPECT = {
  all: 'btc eth sol xrp bnb hype near sui doge avax link ada dot atom wif pepe bonk ltc bch trx xlm etc fil arb op apt sei inj tia aave uni ldo rune gmx crv stx jup wld render tao fet ondo pyth ena dydx sand mana gmt xau spx'.split(' '),
  majors: 'btc eth sol xrp bnb ltc bch ada'.split(' '),
  alts: 'near sui avax link dot atom arb op apt sei inj tia trx xlm etc fil stx'.split(' '),
  defi: 'hype aave uni ldo rune gmx crv jup wld render tao fet ondo pyth ena dydx xau spx'.split(' '),
  meme: 'doge pepe wif bonk gmt sand mana'.split(' '),
};
const browser = await chromium.launch(); const out = [];
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({})); console.log('build', v.commit, v.branch, new Date().toISOString());
  for (const [viewer, w] of [['signed-out', 1280], ['free', 1280], ['signed-out', 390], ['free', 390]]) {
    const ctx = await open(browser, { b: B, w, theme: 'dark', signedIn: viewer !== 'signed-out', plan: 'free', liveWs: true, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 80)));
    try {
      await page.goto(B.base + '/arena?coin=btc&tf=1h', { waitUntil: 'load', timeout: 120_000 }); await settle(page);
      await page.waitForFunction(() => document.querySelectorAll('canvas').length > 3, null, { timeout: 60_000 }).catch(() => {}); await sleep(8000);
      /* The coin bar's button (it carries the selected-coin chip, "BTC"). NOT the first aria-expanded button on the page: that is the "Scanners" menu in the top bar (the first run opened that by mistake and read zero rows). */
      const bar = page.locator('button[aria-expanded]').filter({ hasText: /BTC/ }).first();
      for (const cat of ['all', 'majors', 'alts', 'defi', 'meme']) {
        const tag = `${viewer}-${w === 390 ? 'mobile' : 'desktop'}-${cat}`;
        // the five category buttons are the .gsc-tf-btn row that sits directly above the coin bar
        const btns = page.locator('button.gsc-tf-btn').filter({ hasText: /^(All|Majors|Alts|DeFi.*|Meme)$/i });
        const idx = ['all', 'majors', 'alts', 'defi', 'meme'].indexOf(cat);
        if (await btns.count() < 5) { console.log(tag, 'category buttons found:', await btns.count()); continue; }
        const textOutside = () => page.evaluate(() => { const clone = document.body.cloneNode(true); clone.querySelectorAll('button.gsc-tf-btn, canvas, script, style').forEach((e) => e.remove()); return clone.innerText.replace(/\s+/g, ' ').replace(/\d[\d,.]*/g, '#').slice(0, 6000); });
        const before = await textOutside(); const urlBefore = page.url();
        await btns.nth(idx).click({ timeout: 5000 }); await sleep(1500);
        const after = await textOutside(); const on = await btns.evaluateAll((els) => els.map((e) => e.classList.contains('on')));
        await page.screenshot({ path: `${dir}/${tag}-1-list-closed.png`, fullPage: false });
        await bar.scrollIntoViewIfNeeded().catch(() => {}); await bar.click({ timeout: 5000 }).catch(() => {}); await sleep(1500);
        const rows = await page.locator('button.scanner-flyout-grid').evaluateAll((els) => els.map((e) => (e.innerText.split('\n')[0] || '').trim().toLowerCase()));
        const exp = EXPECT[cat]; const missing = exp.filter((c) => !rows.includes(c)); const extra = rows.filter((c) => !exp.includes(c));
        await page.screenshot({ path: `${dir}/${tag}-2-list-open.png`, fullPage: false });
        const r = { tag, highlightedIndex: on.indexOf(true), onCount: on.filter(Boolean).length, urlChanged: page.url() !== urlBefore, visibleTextChangedOutsideButtons: before !== after, rows: rows.length, expected: exp.length, missing, extra, errs: errs.length };
        out.push(r); console.log(JSON.stringify(r));
        if (await page.locator('button.scanner-flyout-grid').count()) { await bar.click({ timeout: 3000 }).catch(() => {}); await sleep(600); } // close the list again if it is open
      }
    } catch (e) { console.log(viewer, w, 'ERROR', String(e.message).slice(0, 140)); }
    await ctx.close();
  }
} finally { await browser.close(); writeFileSync(`${dir}/result.json`, JSON.stringify(out, null, 1)); }
