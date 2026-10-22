/* #1596 on qa with a REAL seeded test account (dev Supabase project only): trial (E2E_USER_T_*), free (E2E_USER_B_*), pro (E2E_USER_A_*). The session is minted by the password grant the committed
 * fixtures use (qa/e2e/_auth.ts), installed in localStorage (no form, no CAPTCHA). The page reads the account's REAL subscription row (a GET passed through; every other Supabase call stays answered
 * locally or refused, and every app write is answered locally, so the page cannot spend an AI call or write anything). Credentials come from the gitignored env files and are never printed.
 * Per account: XRP and BTC on /arena, 1280 and 390, dark (+ light for XRP): the real plan row, the chart's own markers and padlock circles (read from the chart instance), the lock line, its Upgrade
 * link and height, Quick/Deep buttons (disabled? lock?), POST requests the page tried to send to /api/grok after clicking Quick and Deep on XRP, and screenshots.
 * Then, for trial and free only, direct calls to qa's /api/grok with the real token: coin xrp (quick), ' XRP ' (deep), and no coin. ALL THREE are refused BEFORE any AI call if the fix works; they are the
 * only calls here that could spend money if it does not (at most one Quick and one Deep). NOT run for pro (a billed call).
 * usage: node arena-live-gate.mjs <trial|free|pro> [qa|prod] [out-dir] [api=1|0]                                                                                                               */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
const [, , acct = 'trial', bArg = 'qa', outArg, apiArg = '1'] = process.argv; const B = bArg === 'prod' ? PROD : QA; const dir = outArg || `${OUT}/arena-live/${acct}`; mkdirSync(dir, { recursive: true });
const REPO = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const env = {}; for (const f of ['.env.e2e.local', '.env.local']) { const p = `${REPO}/${f}`; if (!existsSync(p)) continue; for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.replace(/^\uFEFF/, '')); if (m && !(m[1] in env)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); } }
const KEY = { trial: 'T', free: 'B', pro: 'A' }[acct]; if (!KEY) { console.log('unknown account', acct); process.exit(1); }
const email = env[`E2E_USER_${KEY}_EMAIL`]; const password = env[`E2E_USER_${KEY}_PASSWORD`]; const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL; const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!email || !password || !SB_URL || !ANON) { console.log('missing fixture settings for', acct); process.exit(1); }
if (new URL(SB_URL).hostname.split('.')[0] !== B.ref) { console.log('REFUSING: the fixture project is not the dev project this base uses'); process.exit(1); }
const mint = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
if (!mint.ok) { console.log('sign-in for', acct, 'failed with HTTP', mint.status); process.exit(1); }
const s = await mint.json(); const session = { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: Math.floor(Date.now() / 1000) + s.expires_in, token_type: 'bearer', user: s.user };
const READ = () => {
  let markers = null;
  try {
    const btn = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'S/R' && !x.closest('.strat-panel'));
    const fk = btn && Object.keys(btn).find((k) => k.startsWith('__reactFiber'));
    for (let n = fk ? btn[fk] : null, d = 0; n && d < 80 && !markers; n = n.return, d++) {
      for (let h = n.memoizedState, i = 0; h && i < 80 && !markers; h = h.next, i++) { const v = h.memoizedState; const o = v && typeof v === 'object' ? v.current : null; for (const c of [v, o]) { if (c && typeof c === 'object' && typeof c.getOverlays === 'function') { const cnt = { long: 0, short: 0, locked: 0, other: 0 }; for (const ov of c.getOverlays()) { if (ov.name !== 'emaSignal') continue; const dir = ov.extendData && ov.extendData.dir; if (dir === 'long' || dir === 'short' || dir === 'locked') cnt[dir]++; else cnt.other++; } markers = cnt; break; } } }
    }
  } catch { /* leave null */ }
  const line = document.querySelector('[data-testid="arena-coin-lock-line"]'); const link = line ? line.querySelector('a') : null; const lines = document.querySelectorAll('[data-testid="arena-coin-lock-line"]').length;
  const rb = (re) => [...document.querySelectorAll('button')].find((b) => re.test((b.textContent || '').trim()));
  const q = rb(/^(🔒\s*)?quick/i); const d = rb(/^(🔒\s*)?deep/i);
  return { markers, lockLines: lines, lockText: line ? (line.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160) : null, upgradeHref: link ? link.getAttribute('href') : null, upgradeH: link ? Math.round(link.getBoundingClientRect().height) : null,
    quick: q ? { disabled: q.disabled || q.getAttribute('aria-disabled') === 'true', text: (q.textContent || '').trim().slice(0, 30) } : null, deep: d ? { disabled: d.disabled || d.getAttribute('aria-disabled') === 'true', text: (d.textContent || '').trim().slice(0, 30) } : null,
    /* #1609: the chart toolbar chip ("Setup Forming" or "Prime Setup"), counted by its text. */
    setupChips: [...document.querySelectorAll('.klc-toolbar *')].filter((e) => e.children.length === 0 && /^(setup forming|prime setup)$/i.test((e.textContent || '').trim())).length,
    scroll: [document.documentElement.scrollWidth, innerWidth], oldLockBlock: !!document.querySelector('[data-testid="signal-locked"]') };
};
const browser = await chromium.launch(); const rows = [];
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({})); console.log('build', v.commit, v.branch, '| account', acct, new Date().toISOString());
  const combos = []; for (const w of [1280, 390]) { combos.push(['xrp', w, 'dark', '1h'], ['xrp', w, 'light', '1h'], ['btc', w, 'dark', '1h']); }
  /* COMBOS="coin/tf/width/theme;coin/tf/width/theme" replaces the default list (used for the extra coins and timeframes). */
  if (process.env.COMBOS) { combos.length = 0; for (const c of process.env.COMBOS.split(';')) { const [coin, tf, w, theme] = c.split('/'); combos.push([coin, Number(w), theme, tf]); } }
  for (const [coin, w, theme, tf] of combos) {
    const rec = []; let plan = null;
    const ctx = await open(browser, { b: B, w, theme, signedIn: true, realSession: session, rec, liveWs: true, settings: { default_coin: coin, default_tf: tf, strategy_selection: [], strategy_params: {} } });
    const page = await ctx.newPage();
    page.on('response', async (r) => { if (/user_subscriptions/.test(r.url()) && r.request().method() === 'GET') { try { const j = await r.json(); const row = Array.isArray(j) ? j[0] : j; plan = row ? { role: row.role, trialEnds: row.trial_ends_at ? String(row.trial_ends_at).slice(0, 10) : null } : { role: '(no row)' }; } catch { /* */ } } });
    const tag = `${acct}-${coin}-${tf}-${theme}-${w}`;
    try {
      await page.goto(B.base + `/arena?coin=${coin}&tf=${tf}`, { waitUntil: 'load', timeout: 120_000 }); await settle(page);
      await page.waitForFunction(() => document.querySelectorAll('canvas').length > 3, null, { timeout: 60_000 }).catch(() => {}); await sleep(9000);
      const r0 = await page.evaluate(READ); await page.screenshot({ path: `${dir}/${tag}.png` });
      const line = page.locator('[data-testid="arena-coin-lock-line"]').first(); if (await line.count()) { await line.scrollIntoViewIfNeeded().catch(() => {}); await line.screenshot({ path: `${dir}/${tag}-lockline.png` }).catch(() => {}); }
      let tries = null;
      if (coin === 'xrp' && theme === 'dark' && w === 1280) {
        const before = rec.filter((x) => x.m === 'POST' && /\/api\/grok$/.test(x.p)).length;
        for (const re of [/^(🔒\s*)?quick/i, /^(🔒\s*)?deep/i]) { const b = page.locator('button').filter({ hasText: re }).first(); if (await b.count()) await b.click({ timeout: 3000, force: true }).catch(() => {}); await sleep(1500); }
        tries = rec.filter((x) => x.m === 'POST' && /\/api\/grok$/.test(x.p)).length - before;
      }
      const row = { tag, plan, ...r0, grokPostsAfterClickingQuickAndDeep: tries }; rows.push(row); console.log(JSON.stringify(row));
    } catch (e) { console.log(tag, 'ERROR', String(e.message).slice(0, 140)); }
    await ctx.close();
  }
  if (apiArg === '1' && acct !== 'pro') {
    const post = async (label, body) => { const r = await fetch(B.base + '/api/grok', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ prompt: 'qa direct call', tf: '1h', session: 'ny', type: 'quick', ...body }) }); const j = await r.json().catch(() => ({})); const row = { api: label, status: r.status, code: j.code ?? j.error ?? null, hasResult: !!j.result }; rows.push(row); console.log(JSON.stringify(row)); };
    await post('xrp quick', { coin: 'xrp' }); await post("' XRP ' deep", { coin: ' XRP ', type: 'deep' }); await post('no coin', {});
  }
} finally { await browser.close(); writeFileSync(`${dir}/result.json`, JSON.stringify(rows, null, 1)); }
