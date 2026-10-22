/* PM's control: does the page scroll sideways (documentElement.scrollWidth > viewport)? A prod 4936037 | B qa 136c472.
 * Cases: /dashboard 768 en + ru; /arena 1280 + 390 ru. Warm-up load first. Synthetic Free session, same fence as the
 * pairs harness. Language via localStorage 'lhq_lang_v1' AND the mocked user_settings.language (LanguageSync reads it).
 * usage: node control-overflow-ru.mjs <outdir>                                                                    */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const BUILDS = [{ tag: 'A-prod', base: 'https://liquidity-hq.com', ref: 'qdpwhnvmhqgzijuwopso' }, { tag: 'B-qa', base: 'https://liquidity-hq-qa.onrender.com', ref: 'wdtjhrilakoitfcezxpx' }];
const CASES = [['/dashboard', 768, 1024, 'en'], ['/dashboard', 768, 1024, 'ru'], ['/arena', 1280, 800, 'ru'], ['/arena', 390, 844, 'ru']];
const UID = '00000000-0000-4000-8000-00000000fa4e';
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'x', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const MARKET = /binance|bybit|okx|coinbase|deribit|coingecko|kraken|fonts\.|gstatic/;
const out = [];
async function run(browser, b, [p, w, h, lang], measure) {
  const APP = new URL(b.base).host, SB = `${b.ref}.supabase.co`;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(([k, v, l]) => { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem('lhq_lang_v1', l); localStorage.setItem(k, v); }, [`sb-${b.ref}-auth-token`, session, lang]);
  await ctx.routeWebSocket((u) => new URL(u).host === SB, (ws) => ws.close());
  const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
  await ctx.route('**/*', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (u.host === APP) { if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue(); let f = []; try { f = Object.keys(JSON.parse(req.postData() || '{}')).filter((k) => k !== 'knownAsOf'); } catch { /* */ } return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: f, rejected: [], settings: {} }) }); }
    if (u.host === SB) {
      if (req.method() === 'GET' && /user_onboarding/.test(u.pathname)) return row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
      if (req.method() === 'GET' && /user_subscriptions/.test(u.pathname)) return row(r, { user_id: UID, role: 'free', trial_ends_at: null });
      if (req.method() === 'GET' && /user_settings/.test(u.pathname)) return row(r, { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', watchlist: [], language: lang, field_updated_at: {} });
      return r.abort('failed');
    }
    if (req.method() === 'GET' && req.resourceType() !== 'document' && MARKET.test(u.host)) return r.continue();
    return r.abort('failed');
  });
  const page = await ctx.newPage();
  await page.goto(b.base + p, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForTimeout(8000);
  if (measure) {
    const m = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth, sw = document.documentElement.scrollWidth;
      const wide = [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > vw + 1).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} right=${Math.round(e.getBoundingClientRect().right)}`);
      return { lang: document.documentElement.lang, viewport: vw, scrollWidth: sw, overWide: sw > vw, widestOffenders: wide };
    });
    const v = await (await fetch(b.base + '/api/version')).json();
    await page.screenshot({ path: `${OUT}/${b.tag}-${p.slice(1)}-${w}-${lang}.png` });
    out.push({ build: b.tag, commit: v.commit, page: p, width: w, askedLang: lang, ...m });
  }
  await ctx.close();
}
const browser = await chromium.launch();
try {
  for (const b of BUILDS) await run(browser, b, CASES[0], false);
  for (const c of CASES) for (const b of BUILDS) await run(browser, b, c, true);
} finally { await browser.close(); writeFileSync(`${OUT}/control.json`, JSON.stringify(out, null, 1)); for (const o of out) console.log(JSON.stringify(o)); }
