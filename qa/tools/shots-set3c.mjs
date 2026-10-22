/* Set 3c. A prod 4936037 | B qa 136c472. Same fence as shots-set3-states.mjs (synthetic Free session, app GET/HEAD
 * through, every app write answered locally, named Supabase reads answered locally, other Supabase refused, market-data
 * GETs through, everything else refused). The fence is unchanged; it only LOGS which branch answered each request.
 * Jobs:
 *   research  #1346 re-shoot: GET /api/hypotheses -> one row, its evidence GET -> 500; expand, wait 3s, scroll the
 *             evidence block into view, viewport + clip screenshots.
 *   toast     #1455/#1460: /settings at 390x844 mobile, click 4h, measure .st-save-toast vs the Ask AI FAB vs .tnav-tabs.
 *   trace     "Couldn't save" on /dashboard at 1280 and 390: every non-GET request + its fence branch, toast timeline
 *             (node poll every 250ms for 15s, plus an in-page MutationObserver kept to 40s).
 *   control   same as trace, with ONE extra request answered successfully (CONTROL below); must be set from trace evidence.
 * usage: node shots-set3c.mjs <outdir> [research,toast,trace,control]                                              */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const JOBS = (process.argv[3] ?? 'research,toast,trace,control').split(',');
const L = JSON.parse(readFileSync('C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq/lib/labelDefaults.en.json', 'utf8'));
const BUILDS = [{ tag: 'A-prod-4936037', base: 'https://liquidity-hq.com', ref: 'qdpwhnvmhqgzijuwopso' }, { tag: 'B-qa-136c472', base: 'https://liquidity-hq-qa.onrender.com', ref: 'wdtjhrilakoitfcezxpx' }];
const UID = '00000000-0000-4000-8000-00000000fa4e';
const NOW_S = Math.floor(Date.now() / 1000);
const SYN_USER = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'x', expires_in: 3600, expires_at: NOW_S + 3600, token_type: 'bearer', user: SYN_USER });
const MARKET = /binance|bybit|okx|coinbase|deribit|coingecko|kraken|fonts\.|gstatic/;
const SETTINGS_ROW = { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', watchlist: [], field_updated_at: {} };
const log = [];
const say = (o) => { log.push(o); console.log(JSON.stringify(o)); };

/* CONTROLS, set from the trace evidence (run 1): the only non-GETs on /dashboard were POST /api/auth/welcome-email and
 * PATCH /api/settings {timezone}, both answered app-local 200 - NO request was refused. The toast went
 * "Saving…" -> "Saved ✓" -> ~2000ms later "Couldn't save - try again" with the class still plain `st-save-toast`.
 *   fullshape  the one save request, PATCH /api/settings, answered with the route's own full success shape
 *              (app/api/settings/route.ts:162/175: ok, accepted, rejected, settings = the full row incl. field_updated_at)
 *              instead of the fence's minimal `settings: {}`. If the toast still flips, the answer shape is not the cause.
 *   notrigger  the user_settings read answered with timezone = this browser's own timezone, so TimezoneSync has nothing
 *              to save and no PATCH is sent at all. Shows whether the toast needs a save to exist.            */
const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const CONTROLS = {
  fullshape: {
    match: (m, host, path) => host === 'app' && m === 'PATCH' && path === '/api/settings',
    answer: (r, req) => { let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch { /* */ } const f = Object.keys(body).filter((k) => k !== 'knownAsOf'); const now = new Date().toISOString(); const fields = Object.fromEntries(f.map((k) => [k, body[k]])); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: f, rejected: [], settings: { ...SETTINGS_ROW, ...fields, updated_at: now, field_updated_at: Object.fromEntries(f.map((k) => [k, now])) } }) }); },
  },
  notrigger: {
    match: (m, host, path) => host === 'supabase' && m === 'GET' && /user_settings/.test(path),
    answer: (r) => { const o = { ...SETTINGS_ROW, timezone: BROWSER_TZ }; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) }); },
  },
};
let CONTROL = null; // set per control run

async function open(browser, b, { width, height, rec = null, control = false }) {
  const APP = new URL(b.base).host, SB = `${b.ref}.supabase.co`;
  const ctx = await browser.newContext({ viewport: { width, height }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(([k, v]) => { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem(k, v); }, [`sb-${b.ref}-auth-token`, session]);
  await ctx.routeWebSocket((u) => new URL(u).host === SB, (ws) => ws.close());
  const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
  const note = (req, u, branch) => { if (rec) rec.push({ t: Date.now() - (rec.t0 ?? Date.now()), method: req.method(), host: u.host === APP ? 'app' : u.host === SB ? 'supabase' : u.host, path: u.pathname, type: req.resourceType(), branch }); };
  await ctx.route('**/*', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (control && CONTROL && CONTROL.match(req.method(), u.host === APP ? 'app' : u.host === SB ? 'supabase' : u.host, u.pathname, b)) { note(req, u, 'CONTROL-answered:' + CONTROL.name); return CONTROL.answer(r, req, u); }
    if (u.host === APP) {
      if (req.method() === 'GET' || req.method() === 'HEAD') { note(req, u, 'app-pass'); return r.continue(); }
      let f = []; try { f = Object.keys(JSON.parse(req.postData() || '{}')).filter((k) => k !== 'knownAsOf'); } catch { /* */ }
      note(req, u, 'app-local');
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: f, rejected: [], settings: {} }) });
    }
    if (u.host === SB) {
      if (req.method() === 'GET' && /user_onboarding/.test(u.pathname)) { note(req, u, 'supabase-local-read'); return row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true }); }
      if (req.method() === 'GET' && /user_subscriptions/.test(u.pathname)) { note(req, u, 'supabase-local-read'); return row(r, { user_id: UID, role: 'free', trial_ends_at: null }); }
      if (req.method() === 'GET' && /user_settings/.test(u.pathname)) { note(req, u, 'supabase-local-read'); return row(r, SETTINGS_ROW); }
      note(req, u, 'supabase-refused'); return r.abort('failed');
    }
    if (req.method() === 'GET' && req.resourceType() !== 'document' && MARKET.test(u.host)) { note(req, u, 'market-pass'); return r.continue(); }
    note(req, u, 'other-refused'); return r.abort('failed');
  });
  return ctx;
}
async function settle(page) {
  await page.waitForFunction(() => !document.querySelector('.obw-root.obw-loading'), null, { timeout: 30_000 }).catch(() => {});
  for (let i = 0; i < 2; i++) { const d = page.getByRole('button', { name: 'Decline' }); await page.waitForTimeout(700); if (await d.isVisible().catch(() => false)) await d.click().catch(() => {}); }
}
const P = (b, name) => `${OUT}/${name}--${b.tag}.png`;
const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };

async function research(browser, b) {
  const ctx = await open(browser, b, { width: 1280, height: 800 }); const page = await ctx.newPage();
  let evHits = 0;
  const HYP = { id: 'qa-hyp-1', title: 'QA control hypothesis', hypothesis: 'BTC holds 80k through the week', acceptance_criteria: ['Daily close above 80k'], status: 'active', grok_verdict: null, grok_reasoning: null, grok_evidence_assessment: null, grok_confidence: null, grok_next_check: null, grok_last_run: null, target_date: null, created_at: new Date().toISOString() };
  await page.route('**/api/hypotheses', (r) => r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hypotheses: [HYP] }) }) : r.fallback());
  await page.route('**/api/hypotheses/qa-hyp-1/evidence', (r) => { if (r.request().method() !== 'GET') return r.fallback(); evHits++; return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"QA control: evidence read refused"}' }); });
  await page.goto(b.base + '/research', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await page.waitForTimeout(3000);
  const card = page.getByText('QA control hypothesis').first(); const found = await card.isVisible().catch(() => false);
  if (found) { await card.scrollIntoViewIfNeeded(); await card.click(); }
  await page.waitForTimeout(3000);
  const EVRX = /Couldn.t load evidence|No evidence logged yet|Loading evidence/;
  const ev = page.getByText(EVRX).first();
  const evFound = await ev.isVisible().catch(() => false);
  let evText = null, evBox = null, clip = null;
  if (evFound) {
    await ev.evaluate((el) => el.scrollIntoView({ block: 'center' })); await page.waitForTimeout(500);
    evText = await ev.evaluate((el) => (el.closest('div') ?? el).innerText.trim());
    evBox = await ev.boundingBox();
    // clip: 16px left of the evidence text (takes in the card's border), mirrored on the right; 150px above to 210px below
    const x = Math.max(0, Math.round(evBox.x - 16));
    clip = { x, y: Math.max(0, Math.round(evBox.y - 150)), width: 1280 - 2 * x, height: 360 };
    await page.screenshot({ path: P(b, '1-research-evidence-clip-1280'), clip });
  }
  await page.screenshot({ path: P(b, '1-research-evidence-viewport-1280') });
  const body = await page.evaluate(() => document.body.innerText);
  say({ job: 'research', build: b.tag, hypothesisShown: found, evidenceGetHits: evHits, evidenceElementFound: evFound, evidenceText: evText, evidenceBox: evBox && { x: Math.round(evBox.x), y: Math.round(evBox.y), w: Math.round(evBox.width), h: Math.round(evBox.height) }, clip, bodyHasError: body.includes(L.HYPOTHESIS_TRACKER_EVIDENCE_ERROR), bodyHasEmpty: /No evidence logged yet/.test(body) });
  await ctx.close();
}

async function toast(browser, b) {
  const ctx = await open(browser, b, { width: 390, height: 844 }); const page = await ctx.newPage();
  await page.goto(b.base + '/settings', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await page.waitForTimeout(2000);
  const chip = page.locator('button', { hasText: /^4h$/ }).first(); await chip.scrollIntoViewIfNeeded(); await chip.click();
  const seen = await page.locator('.st-save-toast').first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  const measure = () => page.evaluate(() => {
    const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const t = document.querySelector('.st-save-toast');
    let fab = document.querySelector('[data-testid="grok-launcher"]'), via = '[data-testid="grok-launcher"]';
    if (!fab) { fab = document.querySelector('.gchat-fab'); via = '.gchat-fab'; }
    if (!fab) { fab = [...document.querySelectorAll('button')].find((x) => /Ask AI/i.test(x.innerText) && getComputedStyle(x).position === 'fixed') ?? null; via = 'fixed button text Ask AI'; }
    const nav = document.querySelector('.tnav-tabs');
    const tr = R(t), fr = R(fab), nr = R(nav);
    const ov = (a, c) => { if (!a || !c) return null; const x1 = Math.max(a.x, c.x), y1 = Math.max(a.y, c.y), x2 = Math.min(a.x + a.w, c.x + c.w), y2 = Math.min(a.y + a.h, c.y + c.h); const w = Math.max(0, x2 - x1), h = Math.max(0, y2 - y1); return { x: x1, y: y1, w, h, pctOfToast: a.w * a.h ? Math.round(1000 * w * h / (a.w * a.h)) / 10 : null }; };
    const o = ov(tr, fr), on = ov(tr, nr);
    let topAtOverlap = null;
    if (o && o.w > 0 && o.h > 0) { const e = document.elementFromPoint(o.x + o.w / 2, o.y + o.h / 2); topAtOverlap = e ? (e.closest('[data-testid="grok-launcher"],.gchat-fab') ? 'FAB' : e.closest('.st-save-toast') ? 'toast' : e.tagName + '.' + e.className) : null; }
    const fs = fab ? getComputedStyle(fab) : null;
    return { toastText: t?.innerText ?? null, toastClass: t?.className ?? null, toast: tr, fabVia: fab ? via : null, fab: fr, fabText: fab?.innerText?.replace(/\s+/g, ' ').trim() ?? null, fabOpacity: fs?.opacity ?? null, fabVisibility: fs?.visibility ?? null, fabPointerEvents: fs?.pointerEvents ?? null, fabZ: fs?.zIndex ?? null, bodySettingsToastOpen: document.body.classList.contains('settings-toast-open'), tnavTabs: nr, overlapToastFab: o, overlapToastTnav: on, topElementAtOverlapCenter: topAtOverlap };
  });
  const m0 = await measure();
  await page.screenshot({ path: P(b, '2-toast-vs-askai-390-at-visible') });
  await page.waitForTimeout(600);
  const m1 = await measure();
  await page.screenshot({ path: P(b, '2-toast-vs-askai-390-plus600ms') });
  await page.waitForTimeout(2900);
  const m2 = await measure();
  await page.screenshot({ path: P(b, '2-toast-vs-askai-390-plus3500ms') });
  say({ job: 'toast', build: b.tag, seen, atVisible: m0, plus600ms: m1, plus3500ms: m2 });
  await ctx.close();
}

async function trace(browser, b, width, height, controlName) {
  const control = !!controlName; CONTROL = controlName ? { name: controlName, ...CONTROLS[controlName] } : null;
  const rec = []; const ctx = await open(browser, b, { width, height, rec, control });
  await ctx.addInitScript(() => {
    window.__toastLog = []; const t0 = Date.now(); let last = null;
    const tick = () => { const el = document.querySelector('.st-save-toast'); const v = el ? el.className + '|' + el.innerText : null; if (v !== last) { window.__toastLog.push({ t: Date.now(), v }); last = v; } };
    new MutationObserver(tick).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    window.__toastT0 = t0;
  });
  const page = await ctx.newPage();
  const cons = []; page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') cons.push({ t: Date.now() - rec.t0, type: m.type(), text: m.text().slice(0, 200) }); });
  const settingsResp = []; page.on('requestfinished', async (q) => { if (/\/api\/settings/.test(q.url())) { const r = await q.response(); settingsResp.push({ t: Date.now() - rec.t0, method: q.method(), status: r?.status() ?? null, sentBody: (q.postData() ?? '').slice(0, 200) }); } });
  page.on('requestfailed', (q) => { if (/\/api\/settings/.test(q.url())) settingsResp.push({ t: Date.now() - rec.t0, method: q.method(), failed: q.failure()?.errorText }); });
  rec.t0 = Date.now();
  await page.goto(b.base + '/dashboard', { waitUntil: 'load', timeout: 120_000 });
  const loadedAt = Date.now() - rec.t0;
  const poll = []; let firstFail = null, firstAny = null;
  const pollStart = Date.now();
  while (Date.now() - pollStart < 15_000) {
    const s = await page.evaluate(() => { const el = document.querySelector('.st-save-toast'); return el ? { cls: el.className, text: el.innerText, hasToken: !!localStorage.getItem(Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k)) ?? '') } : null; }).catch(() => null);
    const t = Date.now() - rec.t0;
    if (s) { poll.push({ t, ...s }); if (firstAny === null) firstAny = { t, text: s.text }; if (firstFail === null && /Couldn.t save/.test(s.text)) { firstFail = t; await page.screenshot({ path: P(b, `3-${control ? 'control-' + controlName : 'trace'}-dashboard-${width}-toast`) }); } }
    await page.waitForTimeout(250);
  }
  // keep observing in-page to 40s after navigation for a slow-retry toast, without the 250ms node poll
  const extra = Math.max(0, 40_000 - (Date.now() - rec.t0)); await page.waitForTimeout(extra);
  const toastAt40s = await page.evaluate(() => { const el = document.querySelector('.st-save-toast'); return el ? { cls: el.className, text: el.innerText } : null; });
  if (firstFail === null) await page.screenshot({ path: P(b, `3-${control ? 'control-' + controlName : 'trace'}-dashboard-${width}-end`) });
  const obs = await page.evaluate(() => (window.__toastLog ?? []).map((e) => ({ tSinceDocStart: e.t - window.__toastT0, v: e.v })));
  const tokenAtEnd = await page.evaluate(() => Object.keys(localStorage).filter((k) => /^sb-.*-auth-token$/.test(k)).map((k) => ({ k, len: (localStorage.getItem(k) ?? '').length })));
  const nonGet = rec.filter((x) => x.method !== 'GET' && x.method !== 'HEAD');
  const sbAll = rec.filter((x) => x.host === 'supabase');
  const refusedGets = rec.filter((x) => (x.method === 'GET' || x.method === 'HEAD') && /refused/.test(x.branch));
  const dedupe = (arr) => { const m = new Map(); for (const x of arr) { const k = `${x.method} ${x.host}${x.path} ${x.branch}`; const e = m.get(k); if (e) { e.n++; e.lastT = x.t; } else m.set(k, { k, n: 1, firstT: x.t, lastT: x.t }); } return [...m.values()]; };
  const res = { job: control ? 'control-' + controlName : 'trace', control: control ? CONTROL.name : null, build: b.tag, width, loadedAt, firstToastPoll: firstAny, firstCouldntSavePoll: firstFail, toastAt40s, pollSamples: poll.length, toastTimelineObserver: obs, settingsRequests: settingsResp, nonGetRequests: nonGet, supabaseRequests: dedupe(sbAll), refusedGetRequests: dedupe(refusedGets), consoleErrors: cons.slice(0, 30), authTokenKeysAtEnd: tokenAtEnd };
  writeFileSync(`${OUT}/3-${res.job}-dashboard-${width}--${b.tag}.json`, JSON.stringify({ ...res, allRequests: rec }, null, 1));
  say({ job: res.job, build: b.tag, width, loadedAt, firstToastPoll: firstAny, firstCouldntSavePoll: firstFail, toastAt40s, toastTimelineObserver: obs, settingsRequests: settingsResp, nonGet: dedupe(nonGet), supabase: dedupe(sbAll), consoleErrorCount: cons.length });
  await ctx.close();
}

const browser = await chromium.launch();
try {
  for (const b of BUILDS) {
    const v = await (await fetch(b.base + '/api/version')).json();
    say({ build: b.tag, version: v });
  }
  // warm-up: every page measured, per build
  const pages = [...new Set([JOBS.includes('research') && '/research', JOBS.includes('toast') && '/settings', (JOBS.includes('trace') || JOBS.includes('control')) && '/dashboard'].filter(Boolean))];
  for (const b of BUILDS) for (const pth of pages) { const c = await open(browser, b, { width: 1280, height: 800 }); const p = await c.newPage(); await p.goto(b.base + pth, { waitUntil: 'load', timeout: 120_000 }).catch(() => {}); await p.waitForTimeout(4000); await c.close(); }
  say({ warmup: pages });
  for (const b of BUILDS) {
    if (JOBS.includes('research')) await research(browser, b).catch((e) => say({ job: 'research', build: b.tag, crash: String(e?.message ?? e) }));
    if (JOBS.includes('toast')) await toast(browser, b).catch((e) => say({ job: 'toast', build: b.tag, crash: String(e?.message ?? e) }));
    for (const [w, h] of [[1280, 800], [390, 844]]) {
      if (JOBS.includes('trace')) await trace(browser, b, w, h, null).catch((e) => say({ job: 'trace', build: b.tag, width: w, crash: String(e?.message ?? e) }));
      if (JOBS.includes('control')) for (const cn of Object.keys(CONTROLS)) await trace(browser, b, w, h, cn).catch((e) => say({ job: 'control-' + cn, build: b.tag, width: w, crash: String(e?.message ?? e) }));
    }
  }
} finally { await browser.close(); writeFileSync(`${OUT}/log-${JOBS.join('+')}.json`, JSON.stringify(log, null, 1)); }
