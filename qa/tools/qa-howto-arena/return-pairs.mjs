/* #1622 (#1614): the /upgrade return line over (status, payment) pairs, as a REAL Free test account on qa (credentials from the gitignored env files, not printed). Each pair is a fresh page load, waited until the
 * page has left its loading state (up to 15 s) before the banner is read, because the first run of this check read too early and saw nothing for a pair that does show it. Nothing is clicked or typed.
 * usage: node return-pairs.mjs [qa|prod]                                                                                                                                                      */
import { chromium, open, settle, sleep, QA, PROD } from './lib.mjs';
import { readFileSync, existsSync } from 'node:fs';
const B = process.argv[2] === 'prod' ? PROD : QA;
const REPO = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const env = {}; for (const f of ['.env.e2e.local', '.env.local']) { const p = `${REPO}/${f}`; if (!existsSync(p)) continue; for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.replace(/^\uFEFF/, '')); if (m && !(m[1] in env)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); } }
const email = env.E2E_USER_B_EMAIL; const password = env.E2E_USER_B_PASSWORD; const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL; const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!email || !password || new URL(SB_URL).hostname.split('.')[0] !== B.ref) { console.log('missing fixture settings or wrong project'); process.exit(1); }
const mint = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
if (!mint.ok) { console.log('sign-in failed', mint.status); process.exit(1); }
const s = await mint.json(); const session = { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: Math.floor(Date.now() / 1000) + s.expires_in, token_type: 'bearer', user: s.user };
const PAIRS = [['succeeded', 'pay_abc123', 'succeeded'], ['succeeded', null, false], ['succeeded', '', false], ['succeeded', 'x', false], ['succeeded', 'pay_', false], ['succeeded', 'pay_a%20b', false], ['succeeded', 'pay_x%3Cb%3E', false], ['failed', null, 'failed'], ['canceled', null, 'canceled'], ['anything', null, false], [null, 'pay_abc123', false]];
const browser = await chromium.launch(); let bad = 0;
try {
  console.log('build', (await (await fetch(B.base + '/api/version')).json().catch(() => ({}))).commit, new Date().toISOString());
  for (const [st, pay, expect] of PAIRS) {
    const ctx = await open(browser, { b: B, w: 1280, theme: 'dark', signedIn: true, realSession: session, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
    const page = await ctx.newPage(); const q = [st !== null ? `status=${st}` : null, pay !== null ? `payment=${pay}` : null].filter(Boolean).join('&');
    await page.goto(`${B.base}/upgrade${q ? '?' + q : ''}`, { waitUntil: 'load', timeout: 120_000 }); await settle(page);
    await page.waitForFunction(() => !!document.querySelector('[data-testid="upgrade-reveal-plans"], [data-testid^="checkout-cta"]'), null, { timeout: 15_000 }).catch(() => {}); await sleep(2500);
    const r = await page.evaluate(() => { const e = document.querySelector('[data-testid="upgrade-return-banner"]'); return e ? { status: e.getAttribute('data-status'), text: (e.textContent || '').trim().slice(0, 70) } : null; });
    const got = r ? r.status : false; const ok = got === expect; if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ?${q || '(none)'}  -> ${r ? JSON.stringify(r) : 'no banner'}  (expected ${expect || 'no banner'})`);
    await ctx.close();
  }
  console.log(bad === 0 ? 'ALL PAIRS AS EXPECTED' : `${bad} PAIR(S) NOT AS EXPECTED`);
} finally { await browser.close(); }
