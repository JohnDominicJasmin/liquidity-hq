/* Price sweep (#1552): every price-looking number on the public surfaces, per locale and viewer, with its context, plus the raw HTML
 * (meta, JSON-LD) searched for price strings. Run on a build BEFORE and AFTER the change and compare the two JSON files.
 * "35" alone is not a price ("35 signals" exists), so every hit is kept WITH its surrounding words for a human to classify.
 * usage: node price-sweep.mjs <qa|prod> <tag> [langs=en,ko,zh,ru,ar] [viewers=signed_out,free]
 * Screenshots (en only, 1280, dark+light, /upgrade and the landing pricing block) go to <OUT>/price-sweep/<tag>/ .          */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [, , bArg = 'qa', tag = 'before', langsArg = 'en,ko,zh,ru,ar', viewersArg = 'signed_out,free'] = process.argv;
const B = bArg === 'prod' ? PROD : QA; const dir = `${OUT}/price-sweep/${tag}`; mkdirSync(dir, { recursive: true });
const PATHS = ['/', '/upgrade', '/faq', '/terms', '/refund', '/about', '/arena', '/settings'];
const NUM = /(?:[$€£]\s?\d[\d.,]*|\d[\d.,]*\s?(?:\$|USD|USDT|달러|美元|دولار|₽|руб)|\b(?:35|350|49|490|20)\b)/g;
const rows = [];
const READ = (src) => {
  const t = document.body.innerText; const hits = []; const re = new RegExp(src, 'g'); let m;
  while ((m = re.exec(t))) hits.push({ n: m[0], ctx: t.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).replace(/\s+/g, ' ') });
  const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent || '');
  const metas = [...document.querySelectorAll('meta')].map((m) => `${m.getAttribute('name') || m.getAttribute('property')}=${m.getAttribute('content')}`).filter((x) => /\d/.test(x));
  return { hits, jsonLd: scripts.length, jsonLdPrice: scripts.filter((s) => /price|offer/i.test(s)).map((s) => s.slice(0, 200)), metaWithDigits: metas.map((x) => x.slice(0, 160)), upgradeCta: [...document.querySelectorAll('[data-testid^="checkout-cta"], button, a')].map((e) => (e.textContent || '').trim()).filter((x) => /\d/.test(x) && /\$|USD|\//.test(x)).slice(0, 12) };
};
const browser = await chromium.launch();
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({}));
  rows.push({ step: 'build', commit: v.commit, tag });
  for (const viewer of viewersArg.split(',')) for (const lang of langsArg.split(',')) {
    const ctx = await open(browser, { b: B, w: 1280, theme: 'dark', lang, signedIn: viewer !== 'signed_out', plan: 'free', settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
    const page = await ctx.newPage();
    for (const path of PATHS) {
      try {
        const resp = await page.goto(B.base + path, { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(2500);
        const html = await page.content();
        const r = await page.evaluate(READ, NUM.source);
        rows.push({ step: 'page', viewer, lang, path, status: resp?.status(), ...r, htmlDollar: [...new Set((html.match(/\$\s?\d[\d,.]*/g) || []))].slice(0, 20) });
      } catch (e) { rows.push({ step: 'ERROR', viewer, lang, path, error: String(e.message).slice(0, 160) }); }
    }
    await ctx.close(); writeFileSync(`${dir}/sweep.json`, JSON.stringify(rows, null, 1));
  }
  for (const theme of ['dark', 'light']) for (const viewer of ['signed_out', 'free']) {
    const ctx = await open(browser, { b: B, w: 1280, h: 900, theme, lang: 'en', signedIn: viewer !== 'signed_out', plan: 'free', settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
    const page = await ctx.newPage();
    try {
      await page.goto(B.base + '/upgrade', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(3000);
      await page.screenshot({ path: `${dir}/upgrade-${viewer}-${theme}.png`, fullPage: true });
      if (viewer === 'signed_out') {
        await page.goto(B.base + '/', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(2500);
        const pr = page.locator('#pricing, [id*="pricing"], section:has-text("/mo")').first();
        if (await pr.count()) { await pr.scrollIntoViewIfNeeded().catch(() => {}); await pr.screenshot({ path: `${dir}/landing-pricing-${theme}.png` }).catch(() => {}); }
        else await page.screenshot({ path: `${dir}/landing-full-${theme}.png`, fullPage: true });
      }
    } catch (e) { rows.push({ step: 'ERROR', shot: `${viewer}-${theme}`, error: String(e.message).slice(0, 160) }); }
    await ctx.close();
  }
} finally { await browser.close(); writeFileSync(`${dir}/sweep.json`, JSON.stringify(rows, null, 1)); }
const pages = rows.filter((r) => r.step === 'page'); console.log(`pages ${pages.length}, errors ${rows.filter((r) => r.step === 'ERROR').length}`);
for (const p of pages) { const keep = p.hits.filter((h) => /35|350|49|490/.test(h.n)); if (keep.length) console.log(`${p.viewer}/${p.lang}${p.path}: ${keep.map((h) => `[${h.ctx}]`).join(' ').slice(0, 300)}`); }
