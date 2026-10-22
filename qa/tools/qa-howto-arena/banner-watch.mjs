/* #1598 follow-up: at 390 px the REAL trial account showed no banner in trial-banner.mjs (waits of ~4 s), while 1280 dark did. Watch one cold load for 30 s, once a second: is the banner there, and where is the loading state. Real session as the seeded trial account (env files, not printed). usage: node banner-watch.mjs [width=390] [theme=dark] */
import { chromium, open, settle, sleep, QA } from './lib.mjs';
import { readFileSync, existsSync } from 'node:fs';
const [, , wArg = '390', theme = 'dark'] = process.argv; const B = QA;
const REPO = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq'; const env = {};
for (const f of ['.env.e2e.local', '.env.local']) { const p = `${REPO}/${f}`; if (!existsSync(p)) continue; for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.replace(/^\uFEFF/, '')); if (m && !(m[1] in env)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); } }
const mint = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: env.E2E_USER_T_EMAIL, password: env.E2E_USER_T_PASSWORD }) });
const s = await mint.json(); const session = { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: Math.floor(Date.now() / 1000) + s.expires_in, token_type: 'bearer', user: s.user };
const browser = await chromium.launch();
try {
  const rec = []; const ctx = await open(browser, { b: B, w: Number(wArg), theme, signedIn: true, realSession: session, rec, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
  const page = await ctx.newPage(); await page.goto(`${B.base}/arena`, { waitUntil: 'commit', timeout: 120_000 }); const t0 = Date.now();
  for (let i = 0; i < 30; i++) { const r = await page.evaluate(() => ({ banner: !![...document.querySelectorAll('[role="status"]')].find((e) => /trial/i.test(e.textContent || '')), planChip: (document.querySelector('.strat-aux')?.textContent || '').trim().slice(0, 20), trialChip: /TRIAL/.test(document.body.innerText.slice(0, 2000)) })).catch(() => null); console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s`, JSON.stringify(r)); await sleep(1000); }
  console.log('plan-row reads:', rec.filter((x) => /user_subscriptions/.test(x.p)).length);
  await page.screenshot({ path: `${process.env.TEMP || 'C:/Users/Dominic/AppData/Local/Temp'}/banner-watch-${wArg}-${theme}.png`, fullPage: false });
  await ctx.close();
} finally { await browser.close(); }
