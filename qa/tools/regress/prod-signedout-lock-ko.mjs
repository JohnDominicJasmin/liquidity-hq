/* #1663 / #1475: what a SIGNED-OUT Korean visitor sees on production's Arena for a locked coin (XRP). Read-only: no sign-in, no
 * writes, one page load per locale. Every host except liquidity-hq.com is blocked (allowlist), so nothing third-party loads.
 * Records the signal panel's text, the Quick/Deep titles and <html lang>, plus a screenshot. Does NOT use rlib (rlib refuses prod). */
import { chromium as pwChromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { guarded } from './memguard.mjs';

const chromium = guarded(pwChromium);
const PROD = 'https://liquidity-hq.com';
const DIR = `${process.env.QA_ROOT || new URL('../../../../qa-evidence', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')}/prod-signedout-lock`; // #1690: was an absolute path
mkdirSync(DIR, { recursive: true });
const out = [];
const browser = await chromium.launch();
try {
  for (const loc of (process.argv[2] ?? 'ko').split(',')) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const blocked = new Set();
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === 'liquidity-hq.com' || u.hostname === 'www.liquidity-hq.com') return route.continue();
      blocked.add(u.hostname); return route.abort();
    });
    await ctx.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); } catch { /* ignore */ } }, loc);
    const page = await ctx.newPage();
    const res = await page.goto(`${PROD}/arena?coin=xrp`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(12_000);
    const r = await page.evaluate(() => {
      const t = document.body.innerText;
      const btn = (name) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)?.getAttribute('title') ?? null;
      return {
        htmlLang: document.documentElement.lang,
        signUpLine: t.includes('Sign up free to see signals on more coins'),
        lockLineKo: t.includes('Pro에서 이용할 수 있습니다'),
        quickTitle: btn('QUICK') ?? btn('빠른 리서치'),
        hangulShare: Math.round(1000 * ((t.match(/[\uac00-\ud7a3]/g) ?? []).length) / Math.max(1, t.length)) / 10,
      };
    });
    await page.screenshot({ path: `${DIR}/arena-xrp-${loc}.png`, fullPage: false });
    out.push({ loc, status: res?.status(), ...r, blocked: [...blocked].sort() });
    await ctx.close();
  }
} finally {
  await browser.close();
}
writeFileSync(`${DIR}/result.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
