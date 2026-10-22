/* #1564: no Refund Policy link or wording in the rendered footers. For each page the rendered DOM is searched for links to /refund and for the
 * words "refund policy", and the footer's link texts are listed; prod is the positive control (it must show the link). Also /refund's redirect.
 * 1280 and 390, dark. usage: node refund-check.mjs <qa|prod> */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
const B = process.argv[2] === 'prod' ? PROD : QA;
const PAGES = process.env.ONLYPAGE ? [process.env.ONLYPAGE] : ['/', '/faq', '/about', '/terms', '/privacy', '/contact', '/arena?coin=btc&tf=1h', '/dashboard'];
const READ = () => ({ hrefs: [...document.querySelectorAll('a[href]')].filter((a) => /\/refund/i.test(a.getAttribute('href') || '')).length, text: (document.body.innerText.match(/refund policy/gi) || []).length, footerLinks: [...document.querySelectorAll('footer a, [class*="footer"] a')].map((a) => (a.textContent || '').trim()).filter(Boolean).slice(0, 14).join(' | '), sentence: (document.body.innerText.match(/agree to our[^.]{0,140}/i) || [''])[0] });
const browser = await chromium.launch();
try {
  console.log('build', (await (await fetch(B.base + '/api/version')).json().catch(() => ({}))).commit);
  const r0 = await fetch(B.base + '/refund', { redirect: 'manual' }).catch(() => null); console.log('/refund ->', r0?.status, r0?.headers.get('location'));
  for (const w of [1280, 390]) {
    const ctx = await open(browser, { b: B, w, theme: 'dark', signedIn: !process.env.SO, plan: 'pro', settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } }); const page = await ctx.newPage();
    for (const p of PAGES) { try { await page.goto(B.base + p, { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(p.startsWith('/arena') ? 5000 : 2500); await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await sleep(400); const r = await page.evaluate(READ); console.log(`${w} ${p.padEnd(24)} links-to-/refund=${r.hrefs} "refund policy" text=${r.text} | ${r.sentence.slice(0, 110)}`); if (p === '/') console.log('   footer links:', r.footerLinks.slice(0, 160)); } catch (e) { console.log(w, p, 'ERROR', String(e.message).slice(0, 80)); } }
    await ctx.close();
  }
} finally { await browser.close(); }
