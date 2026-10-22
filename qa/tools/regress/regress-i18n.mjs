/* #1640 language pass: (1) the nav language switch itself (EN button -> Korean, Chinese, Russian, back to English), signed out on / and as Pro A on
 * /dashboard; (2) untranslated text: every page in en, ko, zh and ru at 1280 dark. Signed-out for the public pages; Pro A for the app pages, with A's
 * settings row read for real and only its `language` field answered as the locale under test (a read, nothing written), so A's saved English does not
 * pull the page back. A line counts as UNTRANSLATED when it appears identically on the English page and has at least two Latin words of 3+ letters
 * that are not tickers, brand names or units. Market content (news headlines, coin names) is listed apart as "data, not copy" by page.
 * usage: node regress-i18n.mjs [parts=switch,scan] [langs=ko,zh,ru] [pages csv=all]                                                           */
import { chromium, open, quiet, sleep, BASE, ROOT } from './rlib.mjs';
import { PAGES } from './pages.mjs';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
const parts = (process.argv[2] || 'switch,scan').split(',');
const langs = (process.argv[3] || 'ko,zh,ru').split(',');
const pages = process.argv[4] ? process.argv[4].split(',') : PAGES.filter((p) => !['/ko', '/zh'].includes(p));
const DIR = `${ROOT}/language`; mkdirSync(DIR, { recursive: true });
const LOG = `${ROOT}/_sweep/i18n.jsonl`;
const say = (o) => { console.log(JSON.stringify(o).slice(0, 600)); appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n'); };
const PUBLIC = new Set(['/', '/login', '/login?signup=1', '/forgot-password', '/reset-password', '/about', '/contact', '/faq', '/disclaimer', '/privacy', '/terms', '/refund', '/offline', '/upgrade', '/learn', '/playbook', '/hours']);
const ALLOW = /^(LiquidityHQ|LiquidityAI|Grok|Telegram|Bybit|Binance|OKX|Coinbase|Whop|Supabase|Google|Twitter|Discord|TradingView|Pro|PRO|BTC|ETH|SOL|XRP|USDT|USD|EMA|RSI|SMA|MACD|ATR|VWAP|CVD|GEX|OI|FOMC|CPI|NFP|PCE|GDP|PPI|AI|API|UTC|PnL|ROI|TP|SL|DeFi|Meme|Alts|Majors|Long|Short|LONG|SHORT|Squeeze|Flush|[A-Z]{2,6}|\d.*)$/;
const browser = await chromium.launch();
const LINES = () => [...new Set(document.body.innerText.split('\n').map((s) => s.trim().replace(/\s+/g, ' ')).filter((s) => s.length >= 6 && s.length <= 220))];
async function load(path, acct, lang) {
  const sbStub = lang && acct !== 'anon' ? async (r, req, u) => { if (req.method() === 'GET' && /user_settings/.test(u.pathname)) { const resp = await r.fetch(); let body; try { body = await resp.json(); } catch { return false; } const patch = (x) => (x && typeof x === 'object' ? { ...x, language: lang } : x); body = Array.isArray(body) ? body.map(patch) : patch(body); await r.fulfill({ response: resp, json: body }); return true; } return false; } : undefined;
  const ctx = await open(browser, { acct, w: 1280, theme: 'dark', lang, sbStub }); const page = await ctx.newPage(); const inflight = new Map();
  page.on('request', (r) => inflight.set(r, Date.now())); page.on('requestfinished', (r) => inflight.delete(r)); page.on('requestfailed', (r) => inflight.delete(r));
  await page.goto(BASE + path, { waitUntil: 'load', timeout: 90_000 }); await quiet(page, inflight, 2000, 20_000); await sleep(1500);
  return { ctx, page };
}
const englishish = (line) => { const words = line.split(/[\s/·|,.:;()!?"'“”‘’\-–—]+/).filter((w) => /^[A-Za-z][a-z]{2,}$/.test(w) && !ALLOW.test(w)); return words.length >= 2; };
try {
  console.log('build', (await (await fetch(BASE + '/api/version')).json()).commit, new Date().toISOString());
  if (parts.includes('switch')) for (const [acct, path] of [['anon', '/'], ['A', '/dashboard']]) {
    const rec = []; const ctx = await open(browser, { acct, w: 1280, theme: 'dark', rec }); const page = await ctx.newPage();
    await page.goto(BASE + path, { waitUntil: 'load', timeout: 90_000 }); await sleep(9000);
    const out = [];
    for (const [label, re, script] of [['Korean', /한국어/, /[가-힣]/], ['Chinese', /中文/, /[一-鿿]/], ['Russian', /Русский/, /[Ѐ-ӿ]/], ['English', /English/, /^/]]) {
      await page.locator('button[aria-label="Change language"]').first().click({ timeout: 5000 }).catch(() => {}); await sleep(700);
      const opt = page.locator('button, [role="menuitem"], [role="option"], a').filter({ hasText: re }).first(); const found = await opt.count();
      if (found) { await opt.click({ timeout: 5000 }).catch(() => {}); await sleep(3500); }
      const st = await page.evaluate((src) => ({ stored: localStorage.getItem('lhq_lang_v1'), htmlLang: document.documentElement.lang, scriptShare: (() => { const t = document.body.innerText; const m = t.match(new RegExp(src, 'g')) || []; return Math.round(1000 * m.length / Math.max(1, t.length)) / 10; })(), navButton: document.querySelector('button[aria-label="Change language"]')?.innerText?.trim() }), script.source === '^' ? '[A-Za-z]' : script.source);
      await page.screenshot({ path: `${DIR}/switch-${acct}-${label}.jpg`, type: 'jpeg', quality: 70 });
      out.push({ label, optionFound: !!found, ...st });
    }
    await page.reload({ waitUntil: 'load' }); await sleep(6000); const afterReload = await page.evaluate(() => ({ stored: localStorage.getItem('lhq_lang_v1'), htmlLang: document.documentElement.lang }));
    say({ part: 'switch', acct, path, steps: out, afterReloadOnEnglish: afterReload, settingsWrites: rec.filter((n) => /settings/.test(n.url)).length });
    await ctx.close();
  }
  if (parts.includes('scan')) {
    const summary = {};
    for (const p of pages) {
      const acct = PUBLIC.has(p) ? 'anon' : (process.env.I18N_ACCT || 'A'); // I18N_ACCT=T for what only a trial sees (the trial banner, 20261021b)
      const en = await load(p, acct, null); const enLines = new Set(await en.page.evaluate(LINES)); await en.ctx.close();
      for (const lang of langs) {
        const L = await load(p, acct, lang); const lines = await L.page.evaluate(LINES); const htmlLang = await L.page.evaluate(() => document.documentElement.lang);
        await L.page.screenshot({ path: `${DIR}/${lang}-${p === '/' ? 'landing' : p.replace(/^\//, '').replace(/[^a-z0-9-]+/gi, '-')}.jpg`, type: 'jpeg', quality: 60 });
        await L.ctx.close();
        const untranslated = lines.filter((l) => enLines.has(l) && englishish(l));
        const englishNotOnEn = lines.filter((l) => !enLines.has(l) && englishish(l) && !/[가-힣一-鿿Ѐ-ӿ]/.test(l));
        summary[`${lang} ${p}`] = untranslated.length;
        say({ part: 'scan', lang, page: p, acct, htmlLang, lines: lines.length, untranslatedCount: untranslated.length, untranslated: untranslated.slice(0, 40), otherEnglishLines: englishNotOnEn.slice(0, 10) });
      }
    }
    writeFileSync(`${DIR}/_untranslated-summary.json`, JSON.stringify(summary, null, 1));
  }
} finally { await browser.close(); }
