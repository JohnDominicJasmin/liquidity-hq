/* #1640 language: the signed-out landing's switch (components/LanguageSwitcher.tsx). It is not the app's "Change language" menu: a button showing
 * the current language opens links to /, /ko and /zh (no Russian or Arabic on the landing, #138). For each: open the switch, follow the link, and
 * read the URL, html lang and the share of that script on the page; then back to English. 1280 dark, signed out, reads only.
 * usage: node landing-switch.mjs                                                                                                                  */
import { chromium, open, quiet, sleep, BASE, ROOT } from './rlib.mjs';
import { mkdirSync, appendFileSync } from 'node:fs';
const DIR = `${ROOT}/language`; mkdirSync(DIR, { recursive: true });
const LOG = `${ROOT}/_sweep/i18n.jsonl`;
const browser = await chromium.launch();
try {
  const build = (await (await fetch(BASE + '/api/version')).json()).commit;
  const ctx = await open(browser, { acct: 'anon', w: 1280, theme: 'dark', rec: [] }); const page = await ctx.newPage(); const inflight = new Map();
  page.on('request', (r) => inflight.set(r, Date.now())); page.on('requestfinished', (r) => inflight.delete(r)); page.on('requestfailed', (r) => inflight.delete(r));
  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 90_000 }); await quiet(page, inflight, 2000, 20_000); await sleep(1500);
  const steps = [];
  for (const [label, link, script] of [['한국어', '/ko', '[가-힣]'], ['中文', '/zh', '[一-鿿]'], ['English', '/', '^']]) {
    const sw = page.locator('button[aria-expanded]').filter({ hasText: /English|한국어|中文/ }).first();
    const found = await sw.count(); if (found) { await sw.click({ timeout: 5000 }).catch(() => {}); await sleep(600); }
    const opt = page.locator(`a[href="${link}"]`).filter({ hasText: label }).first(); const optFound = await opt.count();
    if (optFound) { await opt.click({ timeout: 5000 }).catch(() => {}); await page.waitForLoadState('load').catch(() => {}); await quiet(page, inflight, 2000, 20_000); await sleep(1500); }
    const st = await page.evaluate((src) => { const t = document.body.innerText; const m = t.match(new RegExp(src, 'g')) || []; return { path: location.pathname, htmlLang: document.documentElement.lang, scriptShare: Math.round(1000 * m.length / Math.max(1, t.length)) / 10 }; }, script);
    await page.screenshot({ path: `${DIR}/landing-switch-${link.replace(/\W/g, '') || 'en'}.jpg`, type: 'jpeg', quality: 70 });
    steps.push({ label, switchFound: !!found, optionFound: !!optFound, ...st, PASS: st.path === link && (link === '/' ? st.htmlLang === 'en' : st.htmlLang === link.slice(1)) });
  }
  const row = { at: new Date().toISOString(), part: 'landing-switch', build, steps, PASS: steps.every((s) => s.PASS) };
  console.log(JSON.stringify(row)); appendFileSync(LOG, JSON.stringify(row) + '\n');
  await ctx.close();
} finally { await browser.close(); }
