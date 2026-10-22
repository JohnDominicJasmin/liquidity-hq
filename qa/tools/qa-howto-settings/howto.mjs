/* "How to test (QA)" for #1510 #1512 #1521 #1516 on qa, with prod (main, pre-fix) as the control build.
 * Fence = allowlist, same as verify-next-release.mjs: app GET/HEAD through (some stubbed per test), app writes answered
 * locally, named Supabase reads (user_onboarding, user_subscriptions, user_settings) answered locally, other Supabase
 * refused unless a test stubs it LOCALLY (token refresh held, PUT /auth/v1/user 200/422, POST /auth/v1/logout 204,
 * POST user_onboarding 201/held+refused). Public market-data GETs through; everything else aborted.
 * No sign-in, no credentials: synthetic sessions in localStorage only. The made-up password typed into the app's own
 * form is answered by this fence and never leaves the browser.
 * usage: node howto.mjs <outdir> <job[,job]> [qa|prod]                                                               */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const JOBS = process.argv[3].split(',');
const QA = { tag: 'qa', base: 'https://liquidity-hq-qa.onrender.com', ref: 'wdtjhrilakoitfcezxpx' };
const PROD = { tag: 'prod', base: 'https://liquidity-hq.com', ref: 'qdpwhnvmhqgzijuwopso' };
const B = process.argv[4] === 'prod' ? PROD : QA;
const KEY = `sb-${B.ref}-auth-token`;
const UID_A = '00000000-0000-4000-8000-00000000fa4e', UID_B = '00000000-0000-4000-8000-00000000fb4f';
const TOK_A = 'qa.synthetic.access-token', TOK_B = 'qa.synthetic.access-token-B';
const mkSession = (uid, tok, email) => ({ access_token: tok, refresh_token: 'x', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: uid, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const SESSION_A = mkSession(UID_A, TOK_A, 'qa-synthetic@example.invalid');
const SESSION_B = mkSession(UID_B, TOK_B, 'qa-synthetic-b@example.invalid');
const MARKET = /binance|bybit|okx|coinbase|deribit|coingecko|kraken|fonts\.|gstatic/;
const PW = 'QaSynthetic2026x';
const log = []; const say = (o) => { log.push(o); console.log(JSON.stringify(o)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SETTINGS_ROW = (uid) => ({ user_id: uid, risk_pct: 1, default_coin: 'btc', default_tf: '1h', watchlist: [], field_updated_at: {} });
const ONB_DONE = (uid) => ({ user_id: uid, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });

/* st: mutable per-test state the handlers read. */
async function open(browser, w, h, st, o = {}) {
  const APP = new URL(B.base).host, SB = `${B.ref}.supabase.co`;
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const seed = { theme: 'dark', lhq_analytics_consent_v1: 'denied', [KEY]: JSON.stringify(SESSION_A), ...(o.ls ?? {}) };
  // Seed ONCE per context: a later page or navigation must not put a signed-out session back.
  await ctx.addInitScript((m) => { if (localStorage.getItem('__qa_seeded')) return; localStorage.setItem('__qa_seeded', '1'); for (const [k, v] of Object.entries(m)) localStorage.setItem(k, v); }, seed);
  await ctx.routeWebSocket(/.*/, (ws) => ws.close());
  const row = (r, x) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? x : [x]) });
  st.rec = st.rec ?? [];
  await ctx.route('**/*', async (r) => {
    const req = r.request(); const u = new URL(req.url()); const m = req.method();
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    const auth = (req.headers()['authorization'] ?? '').replace('Bearer ', '');
    const note = (br) => st.rec.push({ t: Date.now(), m, p: u.host === APP ? u.pathname : u.host.split('.')[0] + u.pathname, br, auth: auth === TOK_A ? 'A' : auth === TOK_B ? 'B' : auth ? 'other' : '' });
    if (u.host === APP) {
      if (u.pathname === '/api/settings' && m === 'PATCH') {
        if (st.patch === 'offline') { note('PATCH-offline'); return r.abort('internetdisconnected'); }
        if (st.patch === 'hold') { note('PATCH-held-then-ok'); await sleep(st.holdMs ?? 4000); }
      }
      if (u.pathname === '/api/telegram/status' && st.tg) {
        const mode = st.tg === 'byUser' ? (auth === TOK_B ? 'notSlow' : 'configured') : st.tg;
        note('tg-' + mode);
        if (mode === 'block') return r.abort('failed');
        if (st.tgHold) await sleep(st.tgHold);
        if (mode === 'notSlow') await sleep(2500);
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: mode === 'configured' }) }).catch(() => {});
      }
      if (m === 'GET' || m === 'HEAD') return r.continue();
      let f = []; try { f = Object.keys(JSON.parse(req.postData() || '{}')).filter((k) => k !== 'knownAsOf'); } catch { /* */ }
      note('app-write-local');
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: f, rejected: [], settings: {} }) }).catch(() => {});
    }
    if (u.host === SB) {
      const uid = auth === TOK_B ? UID_B : UID_A;
      if (u.pathname === '/auth/v1/token') {
        if (st.holdToken) { note('token-refresh-HELD'); await sleep(45000); return r.abort('timedout').catch(() => {}); }
        note('token-refused'); return r.abort('failed');
      }
      if (u.pathname === '/auth/v1/user' && m === 'PUT') {
        if (st.put === 'ok') { note('PUT-user-200-local'); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...SESSION_A.user, updated_at: new Date().toISOString() }) }); }
        if (st.put === 'same') { note('PUT-user-422-same-local'); return r.fulfill({ status: 422, contentType: 'application/json', headers: { 'x-supabase-api-version': '2024-01-01' }, body: JSON.stringify({ code: 'same_password', message: 'New password should be different from the old password.' }) }); }
        note('PUT-user-refused'); return r.abort('failed');
      }
      if (u.pathname === '/auth/v1/logout' && st.logout) { note('logout-204-local'); return r.fulfill({ status: 204, body: '' }); }
      if (/user_onboarding/.test(u.pathname) && m === 'POST') {
        if (st.onb === 'ok') { note('onb-upsert-201-local'); return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' }); }
        note('onb-upsert-held-then-refused'); await sleep(1500); return r.abort('failed').catch(() => {});
      }
      if (m === 'GET' && /user_onboarding/.test(u.pathname)) return row(r, st.onbRow ?? ONB_DONE(uid));
      if (m === 'GET' && /user_subscriptions/.test(u.pathname)) return row(r, { user_id: uid, role: 'free', trial_ends_at: null });
      if (m === 'GET' && /user_settings/.test(u.pathname)) return row(r, SETTINGS_ROW(uid));
      note('sb-refused'); return r.abort('failed');
    }
    if (m === 'GET' && req.resourceType() !== 'document' && MARKET.test(u.host)) return r.continue();
    return r.abort('failed');
  });
  return ctx;
}
async function settle(page) {
  await page.waitForFunction(() => !document.querySelector('.obw-root.obw-loading'), null, { timeout: 30_000 }).catch(() => {});
  for (let i = 0; i < 2; i++) { const d = page.getByRole('button', { name: 'Decline' }); await page.waitForTimeout(600); if (await d.isVisible().catch(() => false)) await d.click().catch(() => {}); }
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}--${B.tag}.png` }).catch((e) => say({ shotFail: name, e: String(e).slice(0, 120) }));
const ACTIVE = () => { const a = document.activeElement; if (!a || a === document.body) return { body: true }; return { tag: a.tagName, id: a.id || undefined, cls: (a.className && String(a.className).slice(0, 40)) || undefined, role: a.getAttribute('role') || undefined, text: (a.innerText || a.value || '').trim().slice(0, 30), inDialog: !!a.closest('[role=dialog]') }; };

/* ── #1510 toast ── */
const TL_INSTALL = () => {
  window.__tl = [];
  const snap = () => { const e = document.querySelector('.st-save-toast'); const v = e ? (e.querySelector('.st-save-toast-text')?.textContent ?? e.textContent) : null; const l = window.__tl[window.__tl.length - 1]; if (!l || l.v !== v) window.__tl.push({ t: Math.round(performance.now()), v, role: e?.getAttribute('role') ?? null }); };
  snap(); new MutationObserver(snap).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
};
const NOW = () => Math.round(performance.now());
async function waitToast(page, re, ms) { return page.waitForFunction((s) => new RegExp(s).test(document.querySelector('.st-save-toast')?.textContent ?? ''), re, { timeout: ms }).then(() => true).catch(() => false); }

async function j1510a(browser) {
  const st = { patch: 'offline' }; const ctx = await open(browser, 1280, 800, st); const page = await ctx.newPage();
  await page.goto(B.base + '/settings', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await page.waitForTimeout(2500);
  await page.evaluate(TL_INSTALL);
  const chip = page.locator('button', { hasText: /^4h$/ }).first(); await chip.scrollIntoViewIfNeeded().catch(() => {}); await chip.click();
  const gotErr = await waitToast(page, "Couldn't save", 25_000); const errAt = await page.evaluate(NOW);
  await shot(page, '1510-s1-a-couldnt-save');
  st.patch = 'hold'; st.holdMs = 4000;
  await page.waitForTimeout(500);
  const clickAt = await page.evaluate(NOW); await page.locator('.st-save-toast-retry').click();
  // Screenshot after the failure's own 3s idle timer would have fired (errAt + 3000), while the held retry is still out.
  await page.waitForFunction((t) => performance.now() > t, errAt + 3400);
  const midText = await page.evaluate(() => document.querySelector('.st-save-toast')?.textContent ?? null); const midAt = await page.evaluate(NOW);
  await shot(page, '1510-s1-b-saving-at-err-plus-3.4s');
  const gotSaved = await waitToast(page, 'Saved', 10_000); const savedAt = await page.evaluate(NOW);
  await shot(page, '1510-s1-c-saved');
  await page.waitForTimeout(2600);
  const tl = await page.evaluate(() => window.__tl);
  const after = tl.filter((x) => x.t >= clickAt).map((x) => ({ ...x, rel: x.t - clickAt }));
  const firstSaving = after.findIndex((x) => /Saving/.test(x.v ?? '')); const savedIdx = after.findIndex((x) => /Saved/.test(x.v ?? ''));
  const between = firstSaving >= 0 && savedIdx > firstSaving ? after.slice(firstSaving, savedIdx) : null;
  const flicker = between ? between.some((x) => !/Saving/.test(x.v ?? '')) : null;
  say({ job: '1510a', build: B.tag, gotErr, gotSaved, retryClickRelErr: clickAt - errAt, failureTimerWouldFireRelClick: errAt + 3000 - clickAt, savingToSavedMs: savedAt - clickAt, midShot: { relErr: midAt - errAt, text: midText }, flicker, timelineFromClick: after, patches: st.rec.filter((x) => x.p === '/api/settings').map((x) => ({ rel: x.t, br: x.br })).length });
  await ctx.close();
}

async function j1510b(browser) {
  const st = { patch: 'offline', logout: true }; const ctx = await open(browser, 1280, 800, st); const p1 = await ctx.newPage();
  await p1.goto(B.base + '/settings', { waitUntil: 'load', timeout: 120_000 }); await settle(p1); await p1.waitForTimeout(2500);
  await p1.evaluate(TL_INSTALL);
  const chip = p1.locator('button', { hasText: /^4h$/ }).first(); await chip.scrollIntoViewIfNeeded().catch(() => {}); await chip.click();
  const gotErr = await waitToast(p1, "Couldn't save", 25_000); const errAtNode = Date.now();
  const p2 = await ctx.newPage(); await p2.goto(B.base + '/settings', { waitUntil: 'load', timeout: 120_000 }); await settle(p2); await p2.waitForTimeout(1500);
  const so = p2.locator('button.st-signout-btn'); await so.scrollIntoViewIfNeeded().catch(() => {}); await so.click();
  await p2.waitForURL(/\/login/, { timeout: 15_000 }).catch(() => {});
  await p1.bringToFront(); await p1.waitForTimeout(2000);
  const p1State = await p1.evaluate((k) => ({ url: location.pathname, tokenInStorage: !!localStorage.getItem(k), emailShown: document.body.innerText.includes('qa-synthetic@example.invalid'), toast: document.querySelector('.st-save-toast')?.textContent ?? null }), KEY);
  const wait = 3600 - (Date.now() - errAtNode); if (wait > 0) await p1.waitForTimeout(wait);
  await shot(p1, '1510-s2-a-signed-out-error-showing');
  const patchesBefore = st.rec.filter((x) => x.p === '/api/settings').length;
  const c1 = await p1.evaluate(NOW); await p1.locator('.st-save-toast-retry').click();
  await p1.waitForTimeout(6000);
  await shot(p1, '1510-s2-b-after-try-again-1');
  const t1 = await p1.evaluate((c) => window.__tl.filter((x) => x.t >= c).map((x) => ({ rel: x.t - c, v: x.v, role: x.role })), c1);
  await p1.waitForTimeout(500);
  const c2 = await p1.evaluate(NOW); const retry2Visible = await p1.locator('.st-save-toast-retry').isVisible().catch(() => false);
  if (retry2Visible) await p1.locator('.st-save-toast-retry').click();
  await p1.waitForTimeout(6000);
  await shot(p1, '1510-s2-c-after-try-again-2');
  const t2 = await p1.evaluate((c) => window.__tl.filter((x) => x.t >= c).map((x) => ({ rel: x.t - c, v: x.v, role: x.role })), c2);
  const end = await p1.evaluate(() => document.querySelector('.st-save-toast')?.textContent ?? null);
  say({ job: '1510b', build: B.tag, gotErr, p2Url: p2.url().replace(B.base, ''), p1AfterSignOut: p1State, try1: t1, retry2Visible, try2: t2, toastAtEnd: end, patchesAfterSignOut: st.rec.filter((x) => x.p === '/api/settings').length - patchesBefore, logoutLocal: st.rec.filter((x) => x.br === 'logout-204-local').length });
  await ctx.close();
}

/* ── #1512 / #1521 password ── */
const PWSTATE = (sel) => { const b = [...document.querySelectorAll('button')].find((x) => x.matches(sel)); return { spinner: !!b?.querySelector('.login-spinner'), disabled: b?.disabled ?? null, err: document.querySelector('.login-error')?.textContent ?? null, ok: document.querySelector('.login-success-desc')?.textContent ?? null, done: /Password updated/.test(document.body.innerText) }; };
async function pwSubmit(page, btnSel, pw, maxMs, shotName) {
  const inputs = page.locator('input[autocomplete="new-password"]');
  await inputs.nth(0).fill(''); await inputs.nth(1).fill('');
  await inputs.nth(0).fill(pw); await inputs.nth(1).fill(pw);
  const btn = page.locator(btnSel).first(); await btn.scrollIntoViewIfNeeded().catch(() => {});
  const t0 = Date.now(); await btn.click();
  const tl = []; let last = null; let shot5 = false;
  while (Date.now() - t0 < maxMs) {
    const s = await page.evaluate(PWSTATE, btnSel);
    const k = JSON.stringify(s); if (k !== last) { tl.push({ t: Date.now() - t0, ...s }); last = k; }
    if (shotName && !shot5 && Date.now() - t0 > 5000) { shot5 = true; await shot(page, shotName + '-at-5s'); }
    if ((s.err || s.ok || s.done) && Date.now() - t0 > 200) break;
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(300);
  if (shotName) await shot(page, shotName + '-end');
  const fin = await page.evaluate(PWSTATE, btnSel);
  return { elapsedToResultMs: tl.find((x) => (x.err || x.ok || x.done) && x.t > 200)?.t ?? tl.find((x) => x.err || x.ok || x.done)?.t ?? null, timeline: tl, final: fin, buttonEnabledAfter: await btn.isEnabled().catch(() => null) };
}
async function openSettingsPw(browser, st) {
  const ctx = await open(browser, 1280, 900, st); const page = await ctx.newPage();
  await page.goto(B.base + '/settings', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await page.waitForTimeout(2500);
  await page.locator('input[autocomplete="new-password"]').first().scrollIntoViewIfNeeded().catch(() => {});
  return { ctx, page };
}
const STALE = (k) => { const s = JSON.parse(localStorage.getItem(k)); s.expires_at = Math.floor(Date.now() / 1000) - 120; localStorage.setItem(k, JSON.stringify(s)); return s.expires_at; };
const RESET_BTN = 'button.login-email-btn';

async function j1512a(browser, maxMs) {
  const st = {}; const { ctx, page } = await openSettingsPw(browser, st);
  await page.evaluate(STALE, KEY); st.holdToken = true;
  const r = await pwSubmit(page, 'button.st-save-btn', PW, maxMs, '1512-A-settings-stale');
  say({ job: '1512A', build: B.tag, ...r, tokenRefreshHeld: st.rec.filter((x) => x.br === 'token-refresh-HELD').length, putUser: st.rec.filter((x) => /PUT-user/.test(x.br)).length });
  await ctx.close();
}
async function openReset(browser, st) {
  const ctx = await open(browser, 1280, 900, st); const page = await ctx.newPage();
  await page.goto(B.base + '/reset-password#type=recovery', { waitUntil: 'load', timeout: 120_000 }); await page.waitForTimeout(1500); await settle(page);
  const ready = await page.locator('input[autocomplete="new-password"]').first().waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
  return { ctx, page, ready };
}
async function j1512b(browser, maxMs) {
  const st = {}; const { ctx, page, ready } = await openReset(browser, st);
  if (!ready) { await shot(page, '1512-B-reset-not-ready'); say({ job: '1512B', build: B.tag, ready, body: (await page.evaluate(() => document.body.innerText)).slice(0, 300) }); await ctx.close(); return; }
  await page.evaluate(STALE, KEY); st.holdToken = true;
  const r = await pwSubmit(page, RESET_BTN, PW, maxMs, '1512-B-reset-stale');
  say({ job: '1512B', build: B.tag, ready, ...r, tokenRefreshHeld: st.rec.filter((x) => x.br === 'token-refresh-HELD').length, putUser: st.rec.filter((x) => /PUT-user/.test(x.br)).length });
  await ctx.close();
}
async function j1512c(browser) {
  // C.1/C.2 healthy save, then C.3 / #1521 step 4: the same password again.
  const st = { put: 'ok' }; const { ctx, page } = await openSettingsPw(browser, st);
  const c1 = await pwSubmit(page, 'button.st-save-btn', PW, 15_000, '1512-C1-healthy');
  st.put = 'same';
  const c3 = await pwSubmit(page, 'button.st-save-btn', PW, 15_000, '1512-C3-same-again');
  say({ job: '1512C', build: B.tag, healthy: c1, sameAgain: c3, puts: st.rec.filter((x) => /PUT-user/.test(x.br)).map((x) => x.br) });
  await ctx.close();
}
async function j1521(browser) {
  // step 1: same password first time; step 2: rules-breaking password (client-side, no request)
  { const st = { put: 'same' }; const { ctx, page } = await openSettingsPw(browser, st);
    const s1 = await pwSubmit(page, 'button.st-save-btn', PW, 15_000, '1521-s1-settings-same');
    const before = st.rec.filter((x) => /PUT-user/.test(x.br)).length;
    const s2 = await pwSubmit(page, 'button.st-save-btn', 'abcdefgh', 5_000, '1521-s2-settings-rules');
    say({ job: '1521-s1s2', build: B.tag, step1: s1, step2: s2, putsDuringStep2: st.rec.filter((x) => /PUT-user/.test(x.br)).length - before });
    await ctx.close(); }
  // step 3: /reset-password, same password
  { const st = { put: 'same' }; const { ctx, page, ready } = await openReset(browser, st);
    const s3 = ready ? await pwSubmit(page, RESET_BTN, PW, 15_000, '1521-s3-reset-same') : null;
    say({ job: '1521-s3', build: B.tag, ready, step3: s3, puts: st.rec.filter((x) => /PUT-user/.test(x.br)).map((x) => x.br) });
    await ctx.close(); }
}

/* ── #1516 wizard ── */
async function tabUntil(page, sel, max = 25, shift = false) {
  for (let i = 0; i < max; i++) { if (await page.evaluate((s) => !!document.activeElement?.matches(s), sel)) return i; await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab'); }
  return await page.evaluate((s) => !!document.activeElement?.matches(s), sel) ? max : -1;
}
const STEPNUM = () => document.querySelector('.obw-eyebrow .k')?.textContent?.trim() ?? null;
async function savingWatch(page, label) {
  // poll focus through the held (1.5s) save, Shift+Tab once while saving, then wait for the failure.
  const during = []; const t0 = Date.now(); let shiftTabWhileSaving = null;
  while (Date.now() - t0 < 1300) {
    const s = await page.evaluate(() => ({ saving: /Saving|Launching/i.test(document.querySelector('.obw-btn-next')?.textContent ?? '') || !!document.querySelector('.obw-btn-next:disabled'), a: (() => { const a = document.activeElement; return a === document.body ? 'BODY' : a?.getAttribute('role') === 'dialog' ? 'DIALOG-ROOT' : (a?.className || a?.tagName); })() }));
    during.push({ t: Date.now() - t0, ...s });
    if (shiftTabWhileSaving === null && Date.now() - t0 > 300) { await page.keyboard.press('Shift+Tab'); shiftTabWhileSaving = await page.evaluate(() => { const a = document.activeElement; return { inDialog: !!a?.closest('[role=dialog]'), body: a === document.body, cls: String(a?.className || a?.tagName).slice(0, 40) }; }); }
    await page.waitForTimeout(80);
  }
  const failed = await page.locator('.obw-root [role=alert]').first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(250);
  const afterFail = await page.evaluate(ACTIVE);
  await shot(page, `1516-A-${label}-after-fail`);
  await page.keyboard.press('Tab'); const tabFromAlert = await page.evaluate(ACTIVE);
  await page.evaluate(() => document.querySelector('.obw-root [role=alert]')?.focus()); await page.keyboard.press('Shift+Tab'); const shiftTabFromAlert = await page.evaluate(ACTIVE);
  return { savingSamples: during.filter((x, i) => i === 0 || JSON.stringify(x.a) !== JSON.stringify(during[i - 1].a) || x.saving !== during[i - 1].saving), shiftTabWhileSaving, failed, focusAfterFail: afterFail, tabFromAlert, shiftTabFromAlert };
}
async function j1516a(browser) {
  const st = { onbRow: { user_id: UID_A, tour_seen: false, profile_complete: false, checklist_telegram: false, checklist_price_alert: false, checklist_grok: false, checklist_coins: false } };
  const ctx = await open(browser, 1280, 860, st); const page = await ctx.newPage();
  await page.goto(B.base + '/dashboard', { waitUntil: 'load', timeout: 120_000 }); await settle(page);
  const shown = await page.locator('.obw-root[role=dialog]').first().waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
  if (!shown) { await shot(page, '1516-A-no-wizard'); say({ job: '1516A', build: B.tag, shown }); await ctx.close(); return; }
  await page.waitForTimeout(800);
  const R = { job: '1516A', build: B.tag, shown };
  // A1 + A7
  R.a7_before = await page.evaluate(() => { const b = document.querySelector('.obw-select'); return { haspopup: b?.getAttribute('aria-haspopup'), expanded: b?.getAttribute('aria-expanded'), labelledby: b?.getAttribute('aria-labelledby') }; });
  R.a1_tabsToCountry = await tabUntil(page, '.obw-select');
  await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  R.a1_afterOpen = await page.evaluate(ACTIVE); R.a7_open = await page.evaluate(() => document.querySelector('.obw-select')?.getAttribute('aria-expanded'));
  await page.keyboard.press('Tab'); R.a1_onOption = await page.evaluate(ACTIVE);
  await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  R.a1_afterPick = await page.evaluate(ACTIVE); R.a7_closed = await page.evaluate(() => document.querySelector('.obw-select')?.getAttribute('aria-expanded'));
  R.a7_ariaSnapshot = await page.locator('.obw-select').ariaSnapshot().catch((e) => 'ERR ' + String(e).slice(0, 80));
  await shot(page, '1516-A1-country-picked-focus-on-button');
  // A2
  R.a2_tabsToTile = await tabUntil(page, '.obw-tile'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  R.a2_tabsToNext = await tabUntil(page, '.obw-btn-next'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  R.a2_stepAfterContinue = await page.evaluate(STEPNUM);
  R.a2_tabsToBack = await tabUntil(page, '.obw-btn-back', 25, true); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  R.a2_stepAfterBack = await page.evaluate(STEPNUM); R.a2_focusAfterBack = await page.evaluate(ACTIVE);
  await shot(page, '1516-A2-back-focus-on-display-name');
  const out = []; for (const k of ['Tab', 'Shift+Tab']) for (let i = 0; i < 20; i++) { await page.keyboard.press(k); const a = await page.evaluate(ACTIVE); if (!a.inDialog) out.push({ k, i, a }); }
  R.a2_outsideDialogIn40 = out;
  // A3..A5: go to step 05 (clicks), then the failing save from Skip, Escape (focus on Back), Launch
  for (let i = 0; i < 6; i++) {
    const n = await page.evaluate(STEPNUM); if (/05/.test(n ?? '')) break;
    const next = page.locator('.obw-btn-next');
    if (await next.isDisabled()) await page.locator('.obw-step .obw-row, .obw-step .obw-tile, .obw-step .obw-chip').first().click();
    await next.click(); await page.waitForTimeout(400);
  }
  R.a3_step = await page.evaluate(STEPNUM);
  R.a3_tabsToSkip = await tabUntil(page, '.obw-skip'); await page.keyboard.press('Enter');
  R.a3_skip = await savingWatch(page, 'A3-skip');
  R.a4_tabsToBack = await tabUntil(page, '.obw-btn-back'); await page.keyboard.press('Escape');
  R.a4_escape = await savingWatch(page, 'A4-escape');
  R.a5_tabsToLaunch = await tabUntil(page, '.obw-btn-next'); await page.keyboard.press('Enter');
  R.a5_launch = await savingWatch(page, 'A5-launch');
  // A6: unblocked
  st.onb = 'ok';
  R.a6_tabsToLaunch = await tabUntil(page, '.obw-btn-next'); await page.keyboard.press('Enter');
  R.a6_closed = await page.locator('.obw-root').first().waitFor({ state: 'detached', timeout: 10_000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(1500);
  R.a6_after = await page.evaluate(() => ({ wizard: !!document.querySelector('.obw-root'), dialogs: [...document.querySelectorAll('[role=dialog]')].map((d) => (d.className || '').toString().slice(0, 40) + ' | ' + (d.innerText || '').trim().slice(0, 60)), tourish: !!document.querySelector('[class*="tour" i], [class*="spotlight" i]') }));
  await shot(page, '1516-A6-unblocked-wizard-closed-tour');
  R.upserts = st.rec.filter((x) => /onb-upsert/.test(x.br)).map((x) => x.br);
  say(R); await ctx.close();
}

/* ── #1516 Telegram ── */
const TG = () => { const s = document.querySelector('.st-tg-status'); const sec = s?.closest('.st-section'); const a = document.activeElement; return { status: s ? s.innerText.trim() : null, retry: !!s?.querySelector('button'), links: sec ? [...sec.querySelectorAll('a.st-link-btn[href="/alerts"]')].map((x) => x.innerText.trim()) : null, active: a === document.body ? 'BODY' : (a?.tagName + ':' + (a?.innerText || '').trim().slice(0, 24)) }; };
async function tgOpen(page) { await page.goto(B.base + '/settings', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await page.waitForTimeout(1500); await page.locator('.st-tg-status').first().scrollIntoViewIfNeeded().catch(() => {}); }
async function tgTimeline(page, ms) { const tl = []; let last = null; const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await page.evaluate(TG); const k = JSON.stringify(s); if (k !== last) { tl.push({ t: Date.now() - t0, ...s }); last = k; } await page.waitForTimeout(60); } return tl; }
async function j1516b(browser) {
  const st = { tg: 'block' }; const ctx = await open(browser, 1280, 900, st); const page = await ctx.newPage();
  await tgOpen(page); await page.waitForFunction(() => /Couldn/.test(document.querySelector('.st-tg-status')?.innerText ?? ''), null, { timeout: 15_000 }).catch(() => {});
  const b1 = await page.evaluate(TG); await shot(page, '1516-B1-couldnt-check');
  st.tg = 'configured'; st.tgHold = 1200;
  await page.locator('.st-tg-status button').focus(); await page.keyboard.press('Enter');
  const b2 = await tgTimeline(page, 2600); await shot(page, '1516-B2-retry-configured-focus-on-link');
  st.tg = 'block'; st.tgHold = 0;
  await tgOpen(page); await page.waitForFunction(() => /Couldn/.test(document.querySelector('.st-tg-status')?.innerText ?? ''), null, { timeout: 15_000 }).catch(() => {});
  await page.locator('.st-tg-status button').focus(); await page.keyboard.press('Enter');
  const b3 = await tgTimeline(page, 2000); await shot(page, '1516-B3-retry-still-blocked-focus-on-try-again');
  st.tg = 'not'; await tgOpen(page); await page.waitForTimeout(1200); const b4not = await page.evaluate(TG); await shot(page, '1516-B4-not-configured');
  st.tg = 'configured'; await tgOpen(page); await page.waitForTimeout(1200); const b4cfg = await page.evaluate(TG); await shot(page, '1516-B4-configured');
  say({ job: '1516B1-4', build: B.tag, b1, b2, b3, b4not, b4cfg, tgCalls: st.rec.filter((x) => x.p === '/api/telegram/status').map((x) => x.br) });
  await ctx.close();
}
async function j1516b5(browser, variant) {
  const st = { tg: 'byUser', logout: true }; const ctx = await open(browser, 1280, 900, st); const p1 = await ctx.newPage();
  await tgOpen(p1); await p1.waitForFunction(() => /Configured/.test(document.querySelector('.st-tg-status')?.innerText ?? ''), null, { timeout: 15_000 }).catch(() => {});
  const before = await p1.evaluate(TG);
  await p1.evaluate(() => { window.__tg = []; const snap = () => { const s = document.querySelector('.st-tg-status'); const v = s ? s.innerText.trim() : null; const l = window.__tg[window.__tg.length - 1]; if (!l || l.v !== v) window.__tg.push({ t: Math.round(performance.now()), v, email: document.body.innerText.match(/qa-synthetic[-a-z]*@example\.invalid/)?.[0] ?? null }); }; snap(); new MutationObserver(snap).observe(document.body, { subtree: true, childList: true, characterData: true }); });
  const p2 = await ctx.newPage();
  let signOut = null;
  if (variant === 'full') {
    await p2.goto(B.base + '/settings', { waitUntil: 'load', timeout: 120_000 }); await settle(p2); await p2.waitForTimeout(1000);
    const so = p2.locator('button.st-signout-btn'); await so.scrollIntoViewIfNeeded().catch(() => {}); await so.click();
    await p2.waitForURL(/\/login/, { timeout: 15_000 }).catch(() => {}); await p2.waitForTimeout(1500);
    signOut = { p2Url: p2.url().replace(B.base, ''), p1Url: await p1.evaluate(() => location.pathname), p1Tg: await p1.evaluate(TG) };
  } else { await p2.goto(B.base + '/about', { waitUntil: 'load', timeout: 120_000 }).catch(() => {}); await p2.waitForTimeout(1000); }
  // "Sign in as an account without Telegram" in tab 2: what supabase-js does on a sign-in - store the session, broadcast SIGNED_IN.
  const switchAt = await p1.evaluate(() => Math.round(performance.now()));
  await p2.evaluate(([k, s]) => { localStorage.setItem(k, JSON.stringify(s)); new BroadcastChannel(k).postMessage({ event: 'SIGNED_IN', session: s }); }, [KEY, SESSION_B]);
  await p1.waitForTimeout(900); await p1.bringToFront(); await shot(p1, `1516-B5-${variant}-tab1-plus0.9s`);
  await p1.waitForTimeout(4500); await shot(p1, `1516-B5-${variant}-tab1-end`);
  const tl = await p1.evaluate((c) => window.__tg.map((x) => ({ rel: x.t - c, v: x.v, email: x.email })), switchAt);
  const afterSwitch = tl.filter((x) => x.rel >= 0);
  say({ job: '1516B5', variant, build: B.tag, before, signOut, timelineRelSwitch: tl, configuredShownAfterSwitch: afterSwitch.some((x) => x.v === 'Configured'), endsNotConfigured: afterSwitch[afterSwitch.length - 1]?.v, tgCalls: st.rec.filter((x) => x.p === '/api/telegram/status').map((x) => ({ br: x.br, auth: x.auth })) });
  await ctx.close();
}

const browser = await chromium.launch();
try {
  say({ build: B.tag, version: await (await fetch(B.base + '/api/version')).json().then((v) => ({ commit: v.commit, branch: v.branch, telegram: v.configured?.telegram })) });
  for (const J of JOBS) {
    const run = { '1510a': () => j1510a(browser), '1510b': () => j1510b(browser), '1512a': () => j1512a(browser, B === PROD ? 25_000 : 22_000), '1512b': () => j1512b(browser, B === PROD ? 25_000 : 22_000), '1512c': () => j1512c(browser), '1521': () => j1521(browser), '1516a': () => j1516a(browser), '1516b': () => j1516b(browser), '1516b5full': () => j1516b5(browser, 'full'), '1516b5direct': () => j1516b5(browser, 'direct') }[J];
    await run().catch((e) => say({ crash: J, build: B.tag, e: String(e).slice(0, 400) }));
  }
} finally { await browser.close(); writeFileSync(`${OUT}/log-${JOBS.join('+')}--${B.tag}.json`, JSON.stringify(log, null, 1)); }
