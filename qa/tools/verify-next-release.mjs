/* Next-release items 2026-10-01: #1496 Market Read pending, #1491 hints, #1493 about subtitle, #1490 arena honest states.
 * B = qa (92c144a, dev Supabase wdtjhrilakoitfcezxpx), A = prod (4936037, qdpwhnvmhqgzijuwopso) as the "before".
 * Fence = allowlist, same as toast-overlap-pairs.mjs: app GET/HEAD through (optionally held/failed per test), app writes
 * answered locally, named Supabase reads answered locally, other Supabase refused, market-data GETs through, everything
 * else aborted. No sign-in, no credentials: a synthetic session in localStorage only.
 * usage: node verify-next-release.mjs <outdir> [mr,hints,about,arena]                                                */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const JOBS = (process.argv[3] ?? 'mr,hints,about,arena').split(',');
const L = JSON.parse(readFileSync('C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq/lib/labelDefaults.en.json', 'utf8'));
const QA = { tag: 'B-qa', base: 'https://liquidity-hq-qa.onrender.com', ref: 'wdtjhrilakoitfcezxpx' };
const PROD = { tag: 'A-prod', base: 'https://liquidity-hq.com', ref: 'qdpwhnvmhqgzijuwopso' };
const UID = '00000000-0000-4000-8000-00000000fa4e';
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'x', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const MARKET = /binance|bybit|okx|coinbase|deribit|coingecko|kraken|fonts\.|gstatic/;
const log = [];
const say = (o) => { log.push(o); console.log(JSON.stringify(o)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SETTINGS_ROW = { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', watchlist: [], field_updated_at: {} };

/* o: { signedIn=true, save:'ok'|'empty200', usDelay, usFail, usRow, hold:{fng,tickers}, fail:{fng,tickers}, priceAlerts:(r)=>..., ls:{} , rec:[] } */
async function open(browser, b, w, h, o = {}) {
  const APP = new URL(b.base).host, SB = `${b.ref}.supabase.co`;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) });
  const ls = { theme: 'dark', lhq_analytics_consent_v1: 'denied', ...(o.signedIn === false ? {} : { [`sb-${b.ref}-auth-token`]: session }), ...(o.ls ?? {}) };
  await ctx.addInitScript((m) => { for (const [k, v] of Object.entries(m)) localStorage.setItem(k, v); }, ls);
  await ctx.routeWebSocket((u) => new URL(u).host === SB, (ws) => ws.close());
  const row = (r, x) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? x : [x]) });
  const note = (req, u, br) => { if (o.rec) o.rec.push({ t: Date.now(), m: req.method(), p: u.host === APP ? u.pathname + u.search : u.host + u.pathname, br, body: req.method() === 'GET' ? undefined : (req.postData() ?? '').slice(0, 160) }); };
  await ctx.route('**/*', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (u.host === APP) {
      if (req.method() === 'GET' || req.method() === 'HEAD') {
        const isFng = u.pathname === '/api/proxy' && u.searchParams.get('type') === 'fng';
        const isTick = u.pathname === '/api/proxy' && u.searchParams.get('type') === 'bybit-tickers';
        if (isFng && o.fail?.fng) { note(req, u, 'TEST-fail-500'); return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"QA: fng refused"}' }); }
        if (isTick && o.fail?.tickers) { note(req, u, 'TEST-fail-500'); return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"QA: tickers refused"}' }); }
        if (isFng && o.hold?.fng) { note(req, u, 'TEST-held'); await sleep(o.hold.fng); return r.continue().catch(() => {}); }
        if (isTick && o.hold?.tickers) { note(req, u, 'TEST-held'); await sleep(o.hold.tickers); return r.continue().catch(() => {}); }
        if (u.pathname === '/api/price-alerts' && o.priceAlerts) { note(req, u, 'TEST-price-alerts'); return o.priceAlerts(r); }
        return r.continue();
      }
      let f = []; try { f = Object.keys(JSON.parse(req.postData() || '{}')).filter((k) => k !== 'knownAsOf'); } catch { /* */ }
      note(req, u, 'app-local');
      if (u.pathname === '/api/settings' && o.save === 'empty200') return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: f, rejected: [], settings: {} }) });
    }
    if (u.host === SB) {
      if (req.method() === 'GET' && /user_onboarding/.test(u.pathname)) return row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
      if (req.method() === 'GET' && /user_subscriptions/.test(u.pathname)) return row(r, { user_id: UID, role: 'free', trial_ends_at: null });
      if (req.method() === 'GET' && /user_settings/.test(u.pathname)) {
        if (o.usFail) { note(req, u, 'TEST-user_settings-refused'); return r.abort('failed'); }
        if (o.usDelay) { note(req, u, 'TEST-user_settings-held'); await sleep(o.usDelay); }
        return row(r, o.usRow ?? SETTINGS_ROW).catch(() => {});
      }
      return r.abort('failed');
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
const shot = (page, name, b, opts = {}) => page.screenshot({ path: `${OUT}/${name}--${b.tag}.png`, ...opts }).catch((e) => say({ shotFail: name, e: String(e).slice(0, 120) }));

/* ── #1496 Market Read ── */
const MR = () => {
  const all = [...document.querySelectorAll('section.mr')]; const s = all.find((x) => x.getBoundingClientRect().height > 0) ?? all[0];
  if (!s) return null;
  const q = (c) => s.querySelector(c)?.textContent?.trim() ?? null; const f = {};
  s.querySelectorAll('.mr-factor').forEach((x) => { const k = x.querySelector('.mr-factor-k')?.textContent?.trim(); f[k] = (x.querySelector('.mr-factor-v')?.textContent ?? '') + (x.querySelector('.mr-factor-s') ? ' | ' + x.querySelector('.mr-factor-s').textContent : ''); });
  return { band: s.dataset.band ?? null, busy: s.getAttribute('aria-busy'), verdict: q('.mr-verdict'), score: q('.mr-score'), fill: s.querySelector('.mr-fill')?.style.width ?? null, fng: f['Fear & Greed'] ?? null, fund: f['Funding'] ?? null, sub: q('.mr-sub'), rpm: document.body.dataset.rpmLevel ?? null };
};
async function mrRun(browser, b, name, w, h, o, ms, shotsAt = []) {
  const rec = []; const ctx = await open(browser, b, w, h, { ...o, rec }); const page = await ctx.newPage();
  const resp = []; let t0 = Date.now();
  page.on('response', (r) => { const u = r.url(); if (/type=fng|type=bybit-tickers/.test(u)) resp.push({ t: Date.now() - t0, url: u.replace(b.base, '').slice(0, 60), status: r.status() }); });
  t0 = Date.now();
  page.goto(b.base + '/dashboard', { waitUntil: 'load', timeout: 120_000 }).catch(() => {});
  const timeline = []; let last = null; const shotsDone = new Set();
  while (Date.now() - t0 < ms) {
    const s = await page.evaluate(MR).catch(() => null); const t = Date.now() - t0;
    const key = JSON.stringify(s); if (key !== last) { timeline.push({ t, ...(s ?? { none: true }) }); last = key; }
    for (const at of shotsAt) if (t >= at && !shotsDone.has(at)) { shotsDone.add(at); const el = page.locator('section.mr').first(); if (await el.count()) { await el.scrollIntoViewIfNeeded().catch(() => {}); await shot(page, `1496-${name}-${w}-t${at}`, b); } }
    await page.waitForTimeout(250);
  }
  await page.locator('section.mr').first().scrollIntoViewIfNeeded().catch(() => {});
  await shot(page, `1496-${name}-${w}-end`, b);
  const verdictSeen = timeline.filter((x) => x.verdict && !/Reading the market/.test(x.verdict)).map((x) => ({ t: x.t, verdict: x.verdict, score: x.score }));
  say({ job: 'mr', run: name, build: b.tag, width: w, firstVerdict: verdictSeen[0] ?? null, timeline, responses: resp, testBranches: rec.filter((x) => /TEST/.test(x.br)).map((x) => ({ t: x.t - t0, p: x.p, br: x.br })) });
  await ctx.close();
}

/* ── #1491 hints ── */
async function hints(browser, b) {
  for (const path of ['/settings', '/alerts']) {
    const ctx = await open(browser, b, 1280, 900); const page = await ctx.newPage();
    await page.goto(b.base + path, { waitUntil: 'load', timeout: 120_000 }).catch(() => {}); await settle(page); await page.waitForTimeout(4000);
    const hint = await page.evaluate(() => { const e = document.querySelector('[data-page-hint]'); return e ? { key: e.getAttribute('data-page-hint'), text: e.innerText, vis: getComputedStyle(e).visibility } : null; });
    await page.locator('[data-page-hint]').first().scrollIntoViewIfNeeded().catch(() => {});
    await shot(page, `1491-hint${path.replace('/', '-')}-1280`, b);
    await shot(page, `1491-hint${path.replace('/', '-')}-1280-full`, b, { fullPage: true });
    const body = await page.evaluate(() => document.body.innerText);
    writeFileSync(`${OUT}/1491-body${path.replace('/', '-')}--${b.tag}.txt`, body);
    say({ job: 'hints', build: b.tag, path, hint, landed: page.url().replace(b.base, '') });
    await ctx.close();
  }
}

/* ── #1493 about ── */
async function about(browser, b, locales) {
  for (const loc of locales) {
    const ctx = await open(browser, b, 1280, 800, { signedIn: false, ls: { lhq_lang_v1: loc } }); const page = await ctx.newPage();
    await page.goto(b.base + '/about', { waitUntil: 'load', timeout: 120_000 }).catch(() => {}); await settle(page); await page.waitForTimeout(5000);
    const r = await page.evaluate(() => { const e = [...document.querySelectorAll('div')].find((d) => d.children.length === 0 && /^Liquidity Hunter HQ - /.test(d.textContent || '')); return { sub: e?.textContent ?? null, lang: document.documentElement.lang, dir: document.documentElement.dir, h1: document.querySelector('h1')?.textContent ?? null }; });
    await shot(page, `1493-about-${loc}-1280`, b);
    say({ job: 'about', build: b.tag, locale: loc, ...r });
    await ctx.close();
  }
}

/* ── #1490 arena ── */
const STALE = [L.ARENA_STALE_SELECTION_PRE, L.ARENA_STALE_SELECTION_CLEARED];
const ARENA = (stale) => {
  const notices = [...document.querySelectorAll('.arena-override-notice')].map((e) => e.innerText).filter((t) => stale.some((s) => t.includes(s.slice(0, 30))));
  return { card: !!document.querySelector('.arena-signal-card'), stale: notices, toast: document.querySelector('.st-save-toast')?.innerText ?? null, chips: [...document.querySelectorAll('.klc-price-chip')].map((e) => e.innerText), onChips: [...document.querySelectorAll('button.strat-chip.on, button.strat-chip[aria-pressed="true"]')].map((e) => e.innerText.trim()) };
};
let VISIBLE_SWITCH = false; let I9_MS = 14000;
async function switchCoinVisible(page, from, to) {
  await page.locator('button[aria-expanded] >> visible=true').filter({ hasText: from.toUpperCase() }).first().click({ timeout: 8000 });
  const inp = page.locator('input.clipped-row-search >> visible=true').first(); await inp.waitFor({ state: 'visible', timeout: 8000 }); await inp.fill(to);
  await page.waitForTimeout(500);
  await page.locator('button.scanner-flyout-grid >> visible=true').filter({ hasText: 'USDT' }).first().click({ timeout: 8000, force: true });
  await page.waitForTimeout(300);
  const label = await page.locator('button[aria-expanded] >> visible=true').filter({ hasText: to.toUpperCase() }).count();
  if (!label) throw new Error('visible selector does not show ' + to);
}
async function switchCoin(page, from, to) {
  if (VISIBLE_SWITCH) return switchCoinVisible(page, from, to);
  const opened = await page.evaluate((f) => { const b = [...document.querySelectorAll('button[aria-expanded]')].find((x) => x.innerText.split(/\s+/).includes(f.toUpperCase())); if (!b) return false; if (b.getAttribute('aria-expanded') !== 'true') b.click(); return true; }, from);
  if (!opened) throw new Error('scanner trigger not found for ' + from);
  const inp = page.locator('input.clipped-row-search').first(); await inp.waitFor({ state: 'visible', timeout: 8000 }); await inp.fill(to);
  await page.waitForTimeout(500);
  const clicked = await page.evaluate((t) => { const r = [...document.querySelectorAll('button.scanner-flyout-grid')].find((x) => x.innerText.split(/\s+/)[0] === t.toUpperCase()); if (!r) return [...document.querySelectorAll('button.scanner-flyout-grid')].map((x) => x.innerText.slice(0, 20)); r.click(); return true; }, to);
  if (clicked !== true) throw new Error('row not found: ' + JSON.stringify(clicked));
}
async function arena(browser, b, w, h, btcPrice, ethPrice, only = ["i10", "i9", "i11"]) {
  const tag = (s) => `1490-${s}-${w}`;
  // item 10: PATCH /api/settings answered 200 {} -> never "Saved"; control: well-formed -> "Saved"
  if (only.includes("i10")) for (const save of ['empty200', 'ok']) {
    const ctx = await open(browser, b, w, h, { save }); const page = await ctx.newPage();
    await page.goto(b.base + '/arena', { waitUntil: 'load', timeout: 120_000 }).catch(() => {}); await settle(page); await page.waitForTimeout(4000);
    const chip = page.locator('button.strat-chip:not(.blocked):not(.on)').first(); const has = await chip.count() > 0;
    const texts = []; let errShot = false; let t0 = Date.now();
    if (has) {
      await chip.scrollIntoViewIfNeeded().catch(() => {}); await chip.click().catch(() => {}); t0 = Date.now();
      while (Date.now() - t0 < 20000) {
        const t = await page.evaluate(() => document.querySelector('.st-save-toast')?.innerText ?? null).catch(() => null);
        if (texts.length === 0 || texts[texts.length - 1].text !== t) { texts.push({ t: Date.now() - t0, text: t }); if (t && !errShot && (/Couldn|Saved|try again/i.test(t))) { errShot = true; await shot(page, tag(`item10-${save}-toast`), b); } }
        await page.waitForTimeout(100);
      }
    }
    say({ job: 'arena-item10', build: b.tag, width: w, save, chipFound: has, toastTimeline: texts, everSaved: texts.some((x) => /Saved/.test(x.text ?? '')), everError: texts.some((x) => /Couldn|try again/i.test(x.text ?? '')) });
    await ctx.close();
  }
  // item 9: cached read made from the SAME selection the account has; settings read held 6s, or refused
  const sel = ['SMA'];
  const RESULT = { signal: 'LEAN BEARISH', confidence: 71, levels: [], patterns: ['QA fixture'], catalysts: [], chartAnalysis: 'QA fixture chart analysis', reasoning: 'QA fixture reasoning', waitFor: null, bias: null, raidSetup: null, raidTarget: null, raidTrigger: null, analyzedAt: Date.now() - 60_000, tf: '1h', session: 'London' };
  const cache = JSON.stringify({ btc: { result: RESULT, priceAtAnalysis: btcPrice, mode: 'quick', selectionAtAnalysis: sel } });
  if (only.includes("i9")) for (const mode of ['held', 'refused']) {
    const ctx = await open(browser, b, w, h, { ls: { 'arena-results-v2': cache }, usRow: { ...SETTINGS_ROW, strategy_selection: sel }, ...(mode === 'held' ? { usDelay: 6000 } : { usFail: true }) });
    const page = await ctx.newPage(); const t0 = Date.now();
    page.goto(b.base + '/arena', { waitUntil: 'load', timeout: 120_000 }).catch(() => {});
    const tl = []; let last = null; let shotMid = false;
    while (Date.now() - t0 < I9_MS) {
      const s = await page.evaluate(ARENA, STALE).catch(() => null); const t = Date.now() - t0;
      const k = JSON.stringify(s && { card: s.card, stale: s.stale, on: s.onChips }); if (k !== last) { tl.push({ t, card: s?.card, stale: s?.stale, onChips: s?.onChips }); last = k; }
      if (!shotMid && t > 3500) { shotMid = true; const c = page.locator('.arena-signal-card').first(); if (await c.count()) await c.scrollIntoViewIfNeeded().catch(() => {}); await shot(page, tag(`item9-${mode}-t3500`), b); }
      await page.waitForTimeout(200);
    }
    if (I9_MS > 14000) { const c = page.locator('.arena-signal-card').first(); if (await c.count()) await c.scrollIntoViewIfNeeded().catch(() => {}); await shot(page, tag(`item9-${mode}-end`), b); }
    const everStale = tl.some((x) => x.stale && x.stale.length > 0);
    let afterChange = null;
    if (mode === 'held') {
      // positive control: a real change of selection must raise the banner
      const chip = page.locator('button.strat-chip:not(.blocked):not(.on)').first();
      if (await chip.count()) { await chip.scrollIntoViewIfNeeded().catch(() => {}); await chip.click().catch(() => {}); await page.waitForTimeout(2500); afterChange = await page.evaluate(ARENA, STALE).catch(() => null); const c = page.locator('.arena-signal-card').first(); if (await c.count()) await c.scrollIntoViewIfNeeded().catch(() => {}); await shot(page, tag(`item9-${mode}-after-change`), b); }
    }
    say({ job: 'arena-item9', build: b.tag, width: w, mode, everStale, timeline: tl, afterChange: afterChange && { card: afterChange.card, stale: afterChange.stale, onChips: afterChange.onChips } });
    await ctx.close();
  }
  // item 11: BTC alert line; price-alerts fetch fails, switch to ETH -> no BTC chip; fetch works, back to BTC -> returns
  if (only.includes("i11")) {
    let phase = 'ok'; let calls = [];
    const ALERT = { id: 'qa-alert-btc', coin: 'btc', target_price: Math.round(ethPrice), direction: 'above', label: 'QA-BTC-LINE' };
    const pa = (r) => { calls.push(phase); return phase === 'ok' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ alerts: [ALERT] }) }) : r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"QA: price-alerts refused"}' }); };
    const ctx = await open(browser, b, w, h, { priceAlerts: pa }); const page = await ctx.newPage();
    await page.goto(b.base + '/arena', { waitUntil: 'load', timeout: 120_000 }).catch(() => {}); await settle(page);
    const onBtc = await page.waitForFunction(() => [...document.querySelectorAll('.klc-price-chip')].some((e) => e.innerText.includes('QA-BTC-LINE')), null, { timeout: 15000 }).then(() => true).catch(() => false);
    await shot(page, tag('item11-btc-start'), b);
    phase = 'fail'; let sw1 = null, sw2 = null, onEth = null, backBtc = null;
    try { await switchCoin(page, 'btc', 'eth'); sw1 = 'ok'; } catch (e) { sw1 = String(e.message).slice(0, 120); }
    await page.waitForTimeout(4000);
    onEth = await page.evaluate(ARENA, STALE).catch(() => null);
    const coinNow1 = await page.evaluate(() => new URL(location.href).searchParams.get('coin'));
    await shot(page, tag('item11-eth-fetch-failed'), b);
    phase = 'ok';
    try { await switchCoin(page, 'eth', 'btc'); sw2 = 'ok'; } catch (e) { sw2 = String(e.message).slice(0, 120); }
    await page.waitForTimeout(4000);
    backBtc = await page.evaluate(ARENA, STALE).catch(() => null);
    const coinNow2 = await page.evaluate(() => new URL(location.href).searchParams.get('coin'));
    await shot(page, tag('item11-btc-back'), b);
    say({ job: 'arena-item11', build: b.tag, width: w, alertTarget: ALERT.target_price, btcChipShown: onBtc, switchToEth: sw1, urlCoinAfter1: coinNow1, chipsOnEth: onEth?.chips, switchBack: sw2, urlCoinAfter2: coinNow2, chipsBackOnBtc: backBtc?.chips, priceAlertCalls: calls });
    await ctx.close();
  }
}

/* Follow-up controls: the Free plan allows 1 indicator, so a "change" is a DESELECT of the seeded chip. */
const ON_CHIP = 'button.strat-chip.on, button.strat-chip[aria-pressed="true"]';
async function arena2(browser, b, w, h, btc, jobs) {
  const tag = (s) => `1490-${s}-${w}`;
  if (jobs.includes('i10')) for (const save of ['empty200', 'ok']) {
    const rec = []; const ctx = await open(browser, b, w, h, { save, rec, usRow: { ...SETTINGS_ROW, strategy_selection: ['SMA'] } }); const page = await ctx.newPage();
    await page.goto(b.base + '/arena', { waitUntil: 'load', timeout: 120_000 }).catch(() => {}); await settle(page); await page.waitForTimeout(9000);
    const before = await page.evaluate(() => document.querySelector('.st-save-toast')?.innerText ?? null);
    const chip = page.locator(ON_CHIP).first(); const has = await chip.count() > 0; const texts = []; let t0 = Date.now(); let shotDone = false;
    if (has) {
      /* StrategyPanel #1027: the first click on a selected chip only FOCUSES it; the second deselects. */
      await chip.scrollIntoViewIfNeeded().catch(() => {}); await chip.click().catch(() => {}); await page.waitForTimeout(500); t0 = Date.now(); await page.locator(ON_CHIP).first().click().catch(() => {});
      let sawSaving = false;
      while (Date.now() - t0 < 12000) {
        const t = await page.evaluate(() => document.querySelector('.st-save-toast')?.innerText ?? null).catch(() => null);
        if (/Saving/.test(t ?? '')) sawSaving = true;
        if (texts.length === 0 || texts[texts.length - 1].text !== t) { texts.push({ t: Date.now() - t0, text: t }); if (sawSaving && t && !/Saving/.test(t) && !shotDone) { shotDone = true; await page.waitForTimeout(150); await shot(page, tag(`item10-${save}-after-click`), b); } }
        await page.waitForTimeout(100);
      }
    }
    const patches = rec.filter((x) => x.m === 'PATCH' && x.p.startsWith('/api/settings')).map((x) => ({ t: x.t - t0, body: x.body }));
    say({ job: 'arena-item10b', build: b.tag, width: w, save, onChipFound: has, toastBeforeClick: before, toastTimelineAfterClick: texts, patchesRelToClick: patches, savedAfterClick: texts.some((x) => /Saved/.test(x.text ?? '')), errorAfterClick: texts.some((x) => x.t > 0 && /Couldn|try again/i.test(x.text ?? '')) });
    await ctx.close();
  }
  if (jobs.includes('i9')) {
    const sel = ['SMA'];
    const RESULT = { signal: 'LEAN BEARISH', confidence: 71, levels: [], patterns: ['QA fixture'], catalysts: [], chartAnalysis: 'QA fixture chart analysis', reasoning: 'QA fixture reasoning', waitFor: null, bias: null, raidSetup: null, raidTarget: null, raidTrigger: null, analyzedAt: Date.now() - 60_000, tf: '1h', session: 'London' };
    const cache = JSON.stringify({ btc: { result: RESULT, priceAtAnalysis: btc, mode: 'quick', selectionAtAnalysis: sel } });
    const ctx = await open(browser, b, w, h, { ls: { 'arena-results-v2': cache }, usRow: { ...SETTINGS_ROW, strategy_selection: sel }, usDelay: 6000 }); const page = await ctx.newPage();
    await page.goto(b.base + '/arena', { waitUntil: 'load', timeout: 120_000 }).catch(() => {}); await settle(page);
    await page.waitForFunction((s) => document.querySelector(s), ON_CHIP, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const pre = await page.evaluate(ARENA, STALE);
    await page.locator(ON_CHIP).first().click().catch(() => {}); await page.waitForTimeout(500); await page.locator(ON_CHIP).first().click().catch(() => {}); await page.waitForTimeout(2500);
    const post = await page.evaluate(ARENA, STALE);
    const c = page.locator('.arena-override-notice').first(); if (await c.count()) await c.scrollIntoViewIfNeeded().catch(() => {});
    await shot(page, tag('item9-held-after-deselect'), b);
    say({ job: 'arena-item9b', build: b.tag, width: w, before: { card: pre.card, stale: pre.stale, on: pre.onChips }, afterDeselect: { card: post.card, stale: post.stale, on: post.onChips } });
    await ctx.close();
  }
}

const browser = await chromium.launch();
try {
  if (JOBS.includes('arena5')) { I9_MS = 30000; for (const [b, w, h] of [[QA, 390, 844], [PROD, 390, 844]]) await arena(browser, b, w, h, Number((await (await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')).json()).price), 0, ['i9']).catch((e) => say({ crash: 'arena5', b: b.tag, e: String(e).slice(0, 300) })); throw new Error('arena5-done'); }
  if (JOBS.includes('i9shot')) {
    /* Screenshot the cached card WHILE the user_settings read is still held (selection not seeded yet). */
    const btc = Number((await (await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')).json()).price);
    const RESULT = { signal: 'LEAN BEARISH', confidence: 71, levels: [], patterns: ['QA fixture'], catalysts: [], chartAnalysis: 'QA fixture chart analysis', reasoning: 'QA fixture reasoning', waitFor: null, bias: null, raidSetup: null, raidTarget: null, raidTrigger: null, analyzedAt: Date.now() - 60_000, tf: '1h', session: 'London' };
    const cache = JSON.stringify({ btc: { result: RESULT, priceAtAnalysis: btc, mode: 'quick', selectionAtAnalysis: ['SMA'] } });
    for (const [b, w, h] of [[QA, 1280, 800], [QA, 390, 844]]) for (const mode of ['held', 'refused']) {
      const rec = []; const ctx = await open(browser, b, w, h, { rec, ls: { 'arena-results-v2': cache }, usRow: { ...SETTINGS_ROW, strategy_selection: ['SMA'] }, ...(mode === 'held' ? { usDelay: 15000 } : { usFail: true }) }); const page = await ctx.newPage();
      const t0 = Date.now(); page.goto(b.base + '/arena', { waitUntil: 'load', timeout: 120_000 }).catch(() => {});
      const cardAt = await page.locator('.arena-signal-card').first().waitFor({ state: 'attached', timeout: 40000 }).then(() => Date.now() - t0).catch(() => null);
      await page.waitForTimeout(1200);
      const s = await page.evaluate(ARENA, STALE).catch(() => null);
      const c = page.locator('.arena-signal-card').first(); if (await c.count()) await c.scrollIntoViewIfNeeded().catch(() => {});
      await shot(page, `1490-item9-${mode}-card-shown-${w}`, b);
      const usReq = rec.filter((x) => /user_settings/.test(x.p)).map((x) => ({ t: x.t - t0, br: x.br }));
      say({ job: 'i9shot', build: b.tag, width: w, mode, cardAttachedAt: cardAt, shotAt: Date.now() - t0, stale: s?.stale, onChips: s?.onChips, userSettingsReads: usReq });
      await ctx.close();
    }
    throw new Error('i9shot-done');
  }
  if (JOBS.includes('ethchart')) {
    /* Control for the blank ETH chart seen on qa after the switch: price-alerts answered OK and empty (no failure path),
       klines timing recorded, screenshots at +4s and +15s. */
    VISIBLE_SWITCH = true;
    for (const b of [QA, PROD]) {
      const ctx = await open(browser, b, 1280, 800, { priceAlerts: (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"alerts":[]}' }) }); const page = await ctx.newPage();
      const kl = []; let t0 = Date.now();
      page.on('response', (r) => { if (/klines|candles/.test(r.url())) kl.push({ t: Date.now() - t0, url: r.url().replace(b.base, '').slice(0, 90), status: r.status() }); });
      page.on('requestfailed', (q) => { if (/klines|candles/.test(q.url())) kl.push({ t: Date.now() - t0, url: q.url().replace(b.base, '').slice(0, 90), failed: q.failure()?.errorText }); });
      await page.goto(b.base + '/arena', { waitUntil: 'load', timeout: 120_000 }).catch(() => {}); await settle(page); await page.waitForTimeout(5000);
      t0 = Date.now(); let sw = 'ok'; try { await switchCoin(page, 'btc', 'eth'); } catch (e) { sw = String(e.message).slice(0, 100); }
      await page.waitForTimeout(4000); await shot(page, '1490-ethchart-control-1280-plus4s', b);
      await page.waitForTimeout(11000); await shot(page, '1490-ethchart-control-1280-plus15s', b);
      say({ job: 'ethchart', build: b.tag, switch: sw, klinesRelToSwitch: kl });
      await ctx.close();
    }
    throw new Error('ethchart-done');
  }
  if (JOBS.includes('arena4')) {
    VISIBLE_SWITCH = true;
    const eth = Number((await (await fetch('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT')).json()).price);
    for (const [b, w, h] of [[QA, 390, 844], [PROD, 390, 844]]) await arena(browser, b, w, h, 0, eth, ['i11']).catch((e) => say({ crash: 'arena4', b: b.tag, w, e: String(e).slice(0, 300) }));
    throw new Error('arena4-done');
  }
  if (JOBS.includes('arena3')) {
    const eth = Number((await (await fetch('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT')).json()).price);
    for (const [b, w, h] of [[QA, 1280, 800], [QA, 390, 844], [PROD, 1280, 800]]) await arena(browser, b, w, h, 0, eth, ['i11']).catch((e) => say({ crash: 'arena3', b: b.tag, w, e: String(e).slice(0, 300) }));
    throw new Error('arena3-done');
  }
  if (JOBS.includes('arena2')) {
    const btc = Number((await (await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')).json()).price);
    for (const [w, h] of [[1280, 800], [390, 844]]) await arena2(browser, QA, w, h, btc, ['i10', 'i9']).catch((e) => say({ crash: 'arena2', w, e: String(e).slice(0, 300) }));
    await arena2(browser, PROD, 1280, 800, btc, ['i10']).catch((e) => say({ crash: 'arena2-prod', e: String(e).slice(0, 300) }));
    throw new Error('arena2-done');
  }
  for (const b of [QA, PROD]) say({ build: b.tag, version: await (await fetch(b.base + '/api/version')).json().then((v) => ({ commit: v.commit, branch: v.branch })) });
  for (const b of [QA, PROD]) for (const p of ['/dashboard', '/arena', '/settings']) { const c = await open(browser, b, 1280, 800); const pg = await c.newPage(); await pg.goto(b.base + p, { waitUntil: 'load', timeout: 120_000 }).catch(() => {}); await pg.waitForTimeout(3000); await c.close(); }
  say({ warmup: 'done' });
  if (JOBS.includes('mr')) {
    for (const b of [QA, PROD]) {
      await mrRun(browser, b, 'cold', 1280, 800, {}, 10000, [500, 2000]).catch((e) => say({ crash: 'mr-cold', b: b.tag, e: String(e) }));
      await mrRun(browser, b, 'held12s', 1280, 800, { hold: { fng: 12000, tickers: 12000 } }, 20000, [6000]).catch((e) => say({ crash: 'mr-held', b: b.tag, e: String(e) }));
      await mrRun(browser, b, 'failed', 1280, 800, { fail: { fng: true, tickers: true } }, 15000, []).catch((e) => say({ crash: 'mr-failed', b: b.tag, e: String(e) }));
    }
    await mrRun(browser, QA, 'fngOnlyFailed', 1280, 800, { fail: { fng: true } }, 12000, []).catch((e) => say({ crash: 'mr-fngonly', e: String(e) }));
    await mrRun(browser, QA, 'held12s', 390, 844, { hold: { fng: 12000, tickers: 12000 } }, 18000, [6000]).catch((e) => say({ crash: 'mr-held-390', e: String(e) }));
  }
  if (JOBS.includes('hints')) for (const b of [QA, PROD]) await hints(browser, b).catch((e) => say({ crash: 'hints', b: b.tag, e: String(e) }));
  if (JOBS.includes('about')) { await about(browser, QA, ['en', 'ko', 'zh', 'ru', 'ar']).catch((e) => say({ crash: 'about', e: String(e) })); await about(browser, PROD, ['en']).catch((e) => say({ crash: 'about-prod', e: String(e) })); }
  if (JOBS.includes('arena')) {
    const px = async (s) => Number((await (await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${s}`)).json()).price);
    const btc = await px('BTCUSDT'), eth = await px('ETHUSDT');
    for (const b of [QA, PROD]) for (const [w, h] of [[1280, 800], [390, 844]]) await arena(browser, b, w, h, btc, eth).catch((e) => say({ crash: 'arena', b: b.tag, w, e: String(e).slice(0, 300) }));
  }
} finally { await browser.close(); writeFileSync(`${OUT}/log-${JOBS.join('+')}.json`, JSON.stringify(log, null, 1)); }
