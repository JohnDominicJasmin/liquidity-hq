/* #1606 (#1610) follow-up: /upgrade?status=succeeded showed NO banner in upgrade-embed.mjs while ?status=failed and ?status=canceled did. Watch it for 30 s as a REAL Free test account on qa: once a second, is the
 * return banner in the page, is the page showing its loading state, what is the URL, and how many times has the page asked for the plan row. Nothing is clicked or typed. Credentials stay in the env files.
 * usage: node return-probe.mjs [query=status=succeeded&payment=pay_qa] [qa|prod]                                                                                                                         */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
const [, , q = 'status=succeeded&payment=pay_qa', bArg = 'qa'] = process.argv; const B = bArg === 'prod' ? PROD : QA; const dir = `${OUT}/return-probe`; mkdirSync(dir, { recursive: true });
const REPO = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const env = {}; for (const f of ['.env.e2e.local', '.env.local']) { const p = `${REPO}/${f}`; if (!existsSync(p)) continue; for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.replace(/^\uFEFF/, '')); if (m && !(m[1] in env)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); } }
const email = env.E2E_USER_B_EMAIL; const password = env.E2E_USER_B_PASSWORD; const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL; const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!email || !password || new URL(SB_URL).hostname.split('.')[0] !== B.ref) { console.log('missing fixture settings or wrong project'); process.exit(1); }
const mint = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
if (!mint.ok) { console.log('sign-in failed', mint.status); process.exit(1); }
const s = await mint.json(); const session = { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: Math.floor(Date.now() / 1000) + s.expires_in, token_type: 'bearer', user: s.user };
const browser = await chromium.launch();
try {
  const rec = []; const ctx = await open(browser, { b: B, w: 1280, theme: 'dark', signedIn: true, realSession: session, rec, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} } });
  const page = await ctx.newPage(); const urls = [];
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) urls.push(f.url().replace(/^https?:\/\/[^/]+/, '')); });
  await page.goto(`${B.base}/upgrade?${q}`, { waitUntil: 'commit', timeout: 120_000 });
  const t0 = Date.now(); const trace = [];
  for (let i = 0; i < 30; i++) {
    const r = await page.evaluate(() => ({ banner: (document.querySelector('[data-testid="upgrade-return-banner"]')?.textContent || '').trim().slice(0, 60) || null, loadingState: /loading/i.test(document.body.innerText.slice(0, 400)), hasPlans: !!document.querySelector('[data-testid="upgrade-reveal-plans"]') || !!document.querySelector('[data-testid^="checkout-cta"]'), path: location.pathname + location.search })).catch(() => null);
    trace.push(`${((Date.now() - t0) / 1000).toFixed(0)}s ${r ? `banner=${JSON.stringify(r.banner)} loading=${r.loadingState} plans=${r.hasPlans} ${r.path}` : '(page busy)'}`);
    if (i === 3) await page.screenshot({ path: `${dir}/t4s.png`, fullPage: true }).catch(() => {});
    await sleep(1000);
  }
  console.log(trace.join('\n')); console.log('main-frame navigations:', JSON.stringify(urls));
  console.log('plan-row reads by the page:', rec.filter((x) => /user_subscriptions/.test(x.p)).length);
  await ctx.close();
} finally { await browser.close(); }
