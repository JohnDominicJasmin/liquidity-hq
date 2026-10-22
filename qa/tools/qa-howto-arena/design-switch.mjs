/* #1111: does ?design=current still change anything on production? For /, /dashboard and /arena, signed out (read-only page loads): load the page with and without ?design=current in fresh contexts and compare
 * the <html> and <body> attributes and classes, the localStorage KEY NAMES (any design key, sticky or not), and the visible text (length and a hash of the text with digits removed, since prices move).
 * Then load the plain page again in the SAME context as the ?design=current visit, to see whether anything stuck. usage: node design-switch.mjs [qa|prod]                                              */
import { chromium, open, settle, sleep, QA, PROD } from './lib.mjs';
import crypto from 'node:crypto';
const B = process.argv[2] === 'qa' ? QA : PROD;
const browser = await chromium.launch();
const snap = (page) => page.evaluate(() => ({ html: document.documentElement.className + ' | ' + [...document.documentElement.attributes].map((a) => a.name + '=' + a.value.slice(0, 30)).join(','), body: document.body.className + ' | ' + [...document.body.attributes].map((a) => a.name).join(','), ls: Object.keys(localStorage).sort(), text: document.body.innerText.replace(/[\d.,]+/g, '#').replace(/\s+/g, ' '), path: location.pathname + location.search }));
const h = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
try {
  console.log('build', (await (await fetch(B.base + '/api/version')).json().catch(() => ({}))).commit, B.tag, new Date().toISOString());
  for (const path of ['/', '/dashboard', '/arena']) {
    const out = {};
    for (const q of ['', '?design=current']) {
      const ctx = await open(browser, { b: B, w: 1280, theme: 'dark', signedIn: false }); const page = await ctx.newPage();
      await page.goto(B.base + path + q, { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(7000);
      out[q || 'plain'] = await snap(page);
      if (q) { await page.goto(B.base + path, { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(5000); out['plain-after-design-visit'] = await snap(page); }
      await ctx.close();
    }
    const a = out.plain, b = out['?design=current'], c = out['plain-after-design-visit'];
    const keysDesign = [...b.ls, ...c.ls].filter((k) => /design/i.test(k));
    console.log(`${path}: html same=${a.html === b.html}, body same=${a.body === b.body}, localStorage keys same=${JSON.stringify(a.ls) === JSON.stringify(b.ls)}, design-like keys=${JSON.stringify(keysDesign)}, text same=${h(a.text) === h(b.text)} (len ${a.text.length} vs ${b.text.length}), plain-after-visit text same as plain=${h(a.text) === h(c.text)}, url kept="${b.path}"`);
    if (a.html !== b.html) console.log('   html plain:', a.html.slice(0, 160), '\n   html design:', b.html.slice(0, 160));
  }
} finally { await browser.close(); }
