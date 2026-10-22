/* #1598 (#1618): the Pro trial banner on qa. REAL seeded TRIAL account (E2E_USER_T_*, dev project; session minted like the committed fixtures; credentials from the gitignored env files, never printed) for the real days
 * left; a STUBBED trial plan row (said so) for the last-3-days cases. Per case: is the banner there, its text, is there an x, its size; then:
 *   dismiss   click the x -> gone; reload -> still gone; keyboard: Tab to the x and press Enter on a fresh load; stored value is today's local date
 *   yesterday the stored day set to yesterday -> the banner is back
 *   urgent    stubbed trial ending in 3, 2 and 1 days (and 4 for the boundary): banner shown, NO x, even with today's date stored
 *   layout    for the real trial account on a cold load: banner box top/height at first paint vs after settle (a jump = layout shift), at 1280 and 390, dark and light
 * Photos: banner with x, dismissed, and urgent, 1280 and 390, dark and light. usage: node trial-banner.mjs [qa|prod] [out-dir]                                                                              */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
const [, , bArg = 'qa', outArg] = process.argv; const B = bArg === 'prod' ? PROD : QA; const dir = outArg || `${OUT}/trial-banner`; mkdirSync(dir, { recursive: true });
const REPO = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const env = {}; for (const f of ['.env.e2e.local', '.env.local']) { const p = `${REPO}/${f}`; if (!existsSync(p)) continue; for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.replace(/^\uFEFF/, '')); if (m && !(m[1] in env)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); } }
const email = env.E2E_USER_T_EMAIL; const password = env.E2E_USER_T_PASSWORD; const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL; const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!email || !password || new URL(SB_URL).hostname.split('.')[0] !== B.ref) { console.log('missing fixture settings or wrong project'); process.exit(1); }
const mint = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
if (!mint.ok) { console.log('sign-in failed', mint.status); process.exit(1); }
const s = await mint.json(); const session = { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: Math.floor(Date.now() / 1000) + s.expires_in, token_type: 'bearer', user: s.user };
const KEY = 'lhq_trial_banner_dismissed';
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = localDay(new Date()); const yest = localDay(new Date(Date.now() - 86400_000));
const READ = () => { const b = document.querySelector('[role="status"]'); const cand = [...document.querySelectorAll('[role="status"]')].find((e) => /trial/i.test(e.textContent || '')); const x = document.querySelector('[data-testid="trial-banner-dismiss"]'); const r = cand ? cand.getBoundingClientRect() : null; const xr = x ? x.getBoundingClientRect() : null; return { banner: !!cand, text: cand ? (cand.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90) : null, x: !!x, xSize: xr ? [Math.round(xr.width), Math.round(xr.height)] : null, xLabel: x ? x.getAttribute('aria-label') : null, top: r ? Math.round(r.top) : null, h: r ? Math.round(r.height) : null, stored: (() => { try { return localStorage.getItem('lhq_trial_banner_dismissed'); } catch { return 'blocked'; } })(), scroll: [document.documentElement.scrollWidth, innerWidth] }; };
const browser = await chromium.launch(); const rows = []; const say = (o) => { rows.push(o); console.log(JSON.stringify(o)); };
const mk = (o) => open(browser, { b: B, signedIn: true, settings: { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} }, ...o });
try {
  console.log('build', (await (await fetch(B.base + '/api/version')).json().catch(() => ({}))).commit, '| today(local)=', today, new Date().toISOString());
  for (const [w, theme] of [[1280, 'dark'], [1280, 'light'], [390, 'dark'], [390, 'light']]) {
    const tag = `${theme}-${w}`;
    // 1. REAL trial account, fresh browser: banner with x, and first-paint vs settled position
    let ctx = await mk({ w, theme, realSession: session }); let page = await ctx.newPage();
    await page.goto(`${B.base}/arena`, { waitUntil: 'commit', timeout: 120_000 });
    const early = []; for (let i = 0; i < 24; i++) { early.push(await page.evaluate(() => { const c = [...document.querySelectorAll('[role="status"]')].find((e) => /trial/i.test(e.textContent || '')); const h = document.querySelector('h1'); return { banner: !!c, h1Top: h ? Math.round(h.getBoundingClientRect().top) : null }; }).catch(() => null)); await sleep(500); }
    await settle(page); await sleep(4000);
    const a = await page.evaluate(READ); const firstBanner = early.findIndex((e) => e && e.banner); const h1Tops = [...new Set(early.filter((e) => e && e.h1Top !== null).map((e) => e.h1Top))];
    say({ tag, case: 'real trial, fresh', ...a, bannerFirstSeenAtMs: firstBanner < 0 ? null : firstBanner * 500, h1TopValuesDuringLoad: h1Tops });
    await page.screenshot({ path: `${dir}/banner-with-x-${tag}.png` });
    // 2. dismiss by click, reload (stays hidden), the stored value
    await page.locator('[data-testid="trial-banner-dismiss"]').click({ timeout: 5000 }).catch(() => {}); await sleep(800);
    const b = await page.evaluate(READ); say({ tag, case: 'after clicking x', banner: b.banner, stored: b.stored, storedIsToday: b.stored === today });
    await page.screenshot({ path: `${dir}/banner-dismissed-${tag}.png` });
    await page.reload({ waitUntil: 'load' }); await settle(page); await sleep(12000); const c = await page.evaluate(READ); say({ tag, case: 'after reload', banner: c.banner });
    await page.goto(`${B.base}/dashboard`, { waitUntil: 'load' }); await settle(page); await sleep(12000); const c2 = await page.evaluate(READ); say({ tag, case: 'other page (dashboard)', banner: c2.banner });
    await ctx.close();
    // 3. stored yesterday -> back; then keyboard dismiss
    ctx = await mk({ w, theme, realSession: session, ls: { [KEY]: yest } }); page = await ctx.newPage();
    await page.goto(`${B.base}/arena`, { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(12000); const d = await page.evaluate(READ); say({ tag, case: 'stored yesterday', banner: d.banner, x: d.x });
    if (w === 1280 && theme === 'dark') {
      await page.locator('[data-testid="trial-banner-dismiss"]').focus().catch(() => {}); await page.keyboard.press('Enter'); await sleep(800); const e2 = await page.evaluate(READ); say({ tag, case: 'keyboard (focus x, Enter)', banner: e2.banner, storedIsToday: e2.stored === today });
    }
    await ctx.close();
    // 4. last-3-days cases (STUBBED trial row; real account untouched), with TODAY stored (must be ignored)
    for (const days of [4, 3, 2, 1]) {
      const planRow = { user_id: '00000000-0000-4000-8000-00000000fa4e', role: 'free', trial_ends_at: new Date(Date.now() + days * 86400_000 - 3600_000).toISOString() };
      ctx = await mk({ w, theme, plan: 'free', planRow, ls: { [KEY]: today } }); page = await ctx.newPage();
      await page.goto(`${B.base}/arena`, { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(4500); const f = await page.evaluate(READ);
      say({ tag, case: `STUB ${days}d left, today stored`, banner: f.banner, text: f.text, x: f.x });
      if (days === 2) await page.screenshot({ path: `${dir}/banner-urgent-2d-${tag}.png` });
      await ctx.close();
    }
  }
} finally { await browser.close(); writeFileSync(`${dir}/result.json`, JSON.stringify(rows, null, 1)); }
