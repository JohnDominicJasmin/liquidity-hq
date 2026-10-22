/* Signup SpotlightTour (#1459 trimmed it). A prod 4936037 | B qa 136c472, one run, same harness/fence as shots-set3b.mjs
 * (synthetic Free session, app GETs through, every app write answered locally, named Supabase reads answered locally,
 * other Supabase refused, market data through, everything else refused). Warm-up first.
 * State: user_onboarding answered { profile_complete:false, tour_seen:false } -> OnboardingGate renders OnboardingFlow;
 * drive its 5 steps generically, click "Launch Dashboard" (finish() -> requestTour() + push /dashboard), then
 * screenshot every SpotlightTour step, clicking "Next →" between steps and never "Open Arena →".
 * usage: node shots-tour.mjs <outdir>                                                                          */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const L = JSON.parse(readFileSync('C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq/lib/labelDefaults.en.json', 'utf8'));
const BUILDS = [{ tag: 'A-prod-4936037', base: 'https://liquidity-hq.com', ref: 'qdpwhnvmhqgzijuwopso' }, { tag: 'B-qa-136c472', base: 'https://liquidity-hq-qa.onrender.com', ref: 'wdtjhrilakoitfcezxpx' }];
const UID = '00000000-0000-4000-8000-00000000fa4e';
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'x', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const MARKET = /binance|bybit|okx|coinbase|deribit|coingecko|kraken|fonts\.|gstatic/;
const SETTINGS_ROW = { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', watchlist: [], field_updated_at: {} };
const log = [];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function open(browser, b, { width, height, tourSeen = true, conflict = false, profileComplete = true }) {
  const APP = new URL(b.base).host, SB = `${b.ref}.supabase.co`;
  const ctx = await browser.newContext({ viewport: { width, height }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(([k, v]) => { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem(k, v); }, [`sb-${b.ref}-auth-token`, session]);
  await ctx.routeWebSocket((u) => new URL(u).host === SB, (ws) => ws.close());
  const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
  await ctx.route('**/*', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (u.host === APP) {
      if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue();
      let f = []; try { f = Object.keys(JSON.parse(req.postData() || '{}')).filter((k) => k !== 'knownAsOf'); } catch { /* */ }
      if (conflict && u.pathname === '/api/settings') {
        const now = new Date().toISOString();
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: [], rejected: f, settings: { ...SETTINGS_ROW, default_tf: '2h', field_updated_at: Object.fromEntries(f.map((k) => [k, now])) } }) });
      }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: f, rejected: [], settings: {} }) });
    }
    if (u.host === SB) {
      if (req.method() === 'GET' && /user_onboarding/.test(u.pathname)) return row(r, { user_id: UID, tour_seen: tourSeen, profile_complete: profileComplete, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
      if (req.method() === 'GET' && /user_subscriptions/.test(u.pathname)) return row(r, { user_id: UID, role: 'free', trial_ends_at: null });
      if (req.method() === 'GET' && /user_settings/.test(u.pathname)) return row(r, SETTINGS_ROW);
      return r.abort('failed'); // includes the onboarding upsert: refused
    }
    if (req.method() === 'GET' && req.resourceType() !== 'document' && MARKET.test(u.host)) return r.continue();
    return r.abort('failed');
  });
  return ctx;
}
async function settle(page) {
  await page.waitForFunction(() => !document.querySelector('.obw-root.obw-loading'), null, { timeout: 30_000 }).catch(() => {});
  for (let i = 0; i < 2; i++) { const d = page.getByRole('button', { name: 'Decline' }); await page.waitForTimeout(700); if (await d.isVisible().catch(() => false)) await d.click().catch(() => {}); }
}

/* Drive OnboardingFlow generically: per step, fill any country picker / <select>, click the first option of every
 * option group that has nothing selected, then click .obw-btn-next once it is enabled. Returns the wizard trace. */
async function driveWizard(page, dbgName) {
  const trace = [];
  const ready = await page.locator('.obw-root:not(.obw-loading)').first().waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
  if (!ready) return { ok: false, reason: 'onboarding wizard never rendered', trace };
  for (let s = 0; s < 8; s++) {
    const root = page.locator('.obw-root:not(.obw-loading)').first();
    if (!(await root.isVisible().catch(() => false))) return { ok: true, trace };
    const eyebrow = (await page.locator('.obw-eyebrow').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    // custom country dropdown (button + menu), and any native <select>
    const cs = page.locator('.obw-select.is-empty').first();
    if (await cs.isVisible().catch(() => false)) { await cs.click(); await page.locator('.obw-menu-opt').first().click(); await page.waitForTimeout(200); }
    for (const sel of await page.locator('.obw-root select').all()) {
      const v = await sel.evaluate((el) => [...el.options].find((o) => o.value)?.value ?? null);
      if (v) await sel.selectOption(v);
    }
    for (const g of ['.obw-tile', '.obw-row', '.obw-chip']) {
      const opts = page.locator(`.obw-root ${g}`);
      if ((await opts.count()) > 0 && (await page.locator(`.obw-root ${g}.is-selected`).count()) === 0) { await opts.first().click(); await page.waitForTimeout(150); }
    }
    const next = page.locator('.obw-btn-next').first();
    const enabled = await next.isEnabled({ timeout: 5000 }).catch(() => false);
    const label = (await next.innerText().catch(() => '')).trim();
    trace.push({ step: s, eyebrow, nextLabel: label, nextEnabled: enabled });
    if (!enabled) { await page.screenshot({ path: `${OUT}/_debug-${dbgName}-wizard-step${s}.png` }); return { ok: false, reason: `next disabled on wizard step ${s}`, trace }; }
    await next.click();
    if (label === L.ONBOARDING_FLOW_LAUNCH_DASHBOARD) { await page.waitForTimeout(500); return { ok: true, trace }; }
    await page.waitForTimeout(700);
  }
  return { ok: false, reason: 'wizard did not finish within 8 steps', trace };
}

const browser = await chromium.launch();
try {
  for (const b of BUILDS) { const c = await open(browser, b, { width: 1280, height: 800 }); const p = await c.newPage(); await p.goto(b.base + '/dashboard', { waitUntil: 'load', timeout: 120_000 }).catch(() => {}); await p.waitForTimeout(5000); await c.close(); }
  for (const b of BUILDS) {
    const v = await (await fetch(b.base + '/api/version')).json();
    log.push({ build: b.tag, commit: v.commit, branch: v.branch });
    for (const [w, h] of [[1280, 800], [390, 844]]) {
      const ctx = await open(browser, b, { width: w, height: h, tourSeen: false, profileComplete: false }); const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 300)}`); });
      await page.goto(b.base + '/dashboard', { waitUntil: 'load', timeout: 120_000 }); await settle(page);
      const wiz = await driveWizard(page, `${w}--${b.tag}`);
      const entry = { build: b.tag, width: w, wizardOk: wiz.ok, wizardReason: wiz.reason ?? null, wizard: wiz.trace, url: null, stepsShown: 0, steps: [], crash: null };
      if (wiz.ok) {
        const dlg = page.locator('[role="dialog"]').filter({ hasText: new RegExp(`${esc(L.SPOTLIGHT_TOUR_NEXT_BTN)}|${esc(L.SPOTLIGHT_TOUR_OPEN_ARENA_BTN)}`) }).first();
        const appeared = await dlg.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false);
        entry.url = page.url();
        if (!appeared) await page.screenshot({ path: `${OUT}/_debug-tour-${w}-noTour--${b.tag}.png` });
        for (let i = 1; appeared && i <= 8; i++) {
          if (!(await dlg.isVisible().catch(() => false))) break;
          await page.waitForTimeout(1600); // let the step's fade/stagger animation land
          const title = (await dlg.locator('h2').first().innerText().catch(() => '')).trim();
          const dots = await dlg.evaluate((el) => { const btn = [...el.querySelectorAll('button')].find((x) => /Next|Open Arena/.test(x.textContent || '')); return btn?.parentElement?.firstElementChild?.children.length ?? null; }).catch(() => null);
          await page.screenshot({ path: `${OUT}/tour-${w}-step${i}--${b.tag}.png` });
          const next = dlg.getByRole('button', { name: L.SPOTLIGHT_TOUR_NEXT_BTN, exact: true });
          const isLast = !(await next.isVisible().catch(() => false));
          entry.steps.push({ step: i, title, dots, button: isLast ? L.SPOTLIGHT_TOUR_OPEN_ARENA_BTN : L.SPOTLIGHT_TOUR_NEXT_BTN });
          entry.stepsShown = i;
          if (isLast) break; // last step: "Open Arena →" - not clicked
          await next.click(); await page.waitForTimeout(400);
        }
      }
      const overlay = await page.evaluate(() => /Application error|Unhandled Runtime Error|client-side exception/i.test(document.body.innerText)).catch(() => false);
      entry.crash = overlay ? 'app error text on page' : null;
      entry.errors = [...new Set(errors)].slice(0, 15);
      log.push(entry);
      console.log(JSON.stringify({ build: entry.build, width: w, wizardOk: entry.wizardOk, reason: entry.wizardReason, stepsShown: entry.stepsShown, titles: entry.steps.map((s) => s.title) }));
      await ctx.close();
    }
  }
} finally { await browser.close(); writeFileSync(`${OUT}/log.json`, JSON.stringify(log, null, 1)); }
