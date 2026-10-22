/* #1640 Arena features, then the billed AI calls PM asked for (Free and trial on BTC 1h, Pro on XRP 1h: one Quick, one Deep, one Ask AI each).
 *
 * FEATURES (no AI spend; every AI request answered locally): timeframe switch (4h and back; 15m as a lock probe), the five coin categories (the
 * coin list each one shows when the scanner list is opened), coin switch from the list, the Strategy set select, an indicator toggle (MACD) with the
 * chart pane count before and after, and for Free/trial the lock on XRP (lock line, what Quick/Deep do, whether anything reaches /api/grok).
 * BILLED: a hard budget per run. Only POST /api/grok (Quick, Deep) or POST /api/grok-chat (Ask AI) may pass, at most `budget` times; anything past
 * the budget is answered locally (429) and counted. For each call: the exact request body, the full response, the UTC second it was sent, coin,
 * timeframe, tier, and photos of the rendered read, in <ROOT>/ai/.
 * usage: node regress-arena.mjs [accts=B,T,A] [parts=features,quick,deep,chat]                                                                 */
import { chromium, open, quiet, sleep, BASE, ROOT, ACCT_NAME, REF, anonKey } from './rlib.mjs';
/* PM, 2026-10-21: the dev project's auth/PostgREST state at the moment of each billed call goes into its meta.json (the 06:0x outage turned one
   call into a false "limit reached"). Auth /health and one small public PostgREST read, each with status and time. */
async function dbProbe() {
  const one = async (url) => { const t0 = Date.now(); try { const r = await fetch(url, { headers: { apikey: anonKey() }, signal: AbortSignal.timeout(20_000) }); return { status: r.status, ms: Date.now() - t0 }; } catch (e) { return { error: String(e.message).slice(0, 60), ms: Date.now() - t0 }; } };
  return { at: new Date().toISOString(), authHealth: await one(`https://${REF}.supabase.co/auth/v1/health`), restRead: await one(`https://${REF}.supabase.co/rest/v1/lhq_dev_labels?select=key&limit=1`) };
}
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
const accts = (process.argv[2] || 'B,T,A').split(',');
const parts = (process.argv[3] || 'features,quick,deep,chat').split(',');
const AI = `${ROOT}/ai`; const AR = `${ROOT}/arena`; mkdirSync(AI, { recursive: true }); mkdirSync(AR, { recursive: true });
const LOG = `${AR}/_features.jsonl`;
const say = (o) => { console.log(JSON.stringify(o)); appendFileSync(LOG, JSON.stringify(o) + '\n'); };
const coinFor = (a) => (a === 'A' ? 'xrp' : 'btc');
const TIER = { B: 'free', T: 'trial', A: 'pro' };
const browser = await chromium.launch();

async function load(acct, url, extra = {}) {
  const rec = []; const ctx = await open(browser, { acct, w: 1280, theme: 'dark', rec, ...extra }); const page = await ctx.newPage(); const inflight = new Map();
  page.on('request', (r) => inflight.set(r, Date.now())); page.on('requestfinished', (r) => inflight.delete(r)); page.on('requestfailed', (r) => inflight.delete(r));
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200))); page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  await page.goto(BASE + url, { waitUntil: 'load', timeout: 90_000 }); await quiet(page, inflight, 2500, 30_000); await sleep(1500);
  return { ctx, page, rec, errs, inflight };
}
const canvases = (page) => page.evaluate(() => [...document.querySelectorAll('canvas')].filter((c) => c.getBoundingClientRect().height > 40).length);
const tfBtn = (page, tf) => page.locator('button').filter({ hasText: new RegExp(`^${tf}$`) }).first();
// The scanner trigger in the page body (NOT the top-nav "Scanners" menu): a button with aria-expanded whose text starts with a coin ticker.
// Anchored on the category tabs: the scanner wrapper is the element right after the tabs row (app/arena/page.tsx, "COIN CATEGORY TABS" then "SQUEEZE SCANNER").
const scannerBtn = (page) => page.locator('xpath=//button[normalize-space(.)="Meme"]/../following-sibling::div[1]//button[@aria-expanded]').first();
async function openScannerList(page) {
  const b = scannerBtn(page); if (!(await b.count())) return null;
  /* The list also opens on HOVER (Bybit-style flyout), and moving the mouse to click it can open it first, so the click then closes it again:
     click until aria-expanded reads true, at most twice. */
  const read = () => page.evaluate(() => {
    const meme = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Meme');
    const box = meme && meme.parentElement ? meme.parentElement.nextElementSibling : null; // the scanner wrapper: trigger bar + flyout (probe-scanner2.mjs)
    const trig = box ? box.querySelector('button[aria-expanded]') : null;
    if (!trig) return { rows: [], expanded: null };
    const rows = [...box.querySelectorAll('button, [role="button"], [role="option"], a')].filter((x) => x !== trig && !trig.contains(x) && x.getBoundingClientRect().height > 0)
      .map((x) => (x.innerText || '').trim().split(/\s+/)[0]).filter((t) => /^[A-Z0-9]{2,8}$/.test(t));
    return { rows: [...new Set(rows)], expanded: trig.getAttribute('aria-expanded') };
  });
  let r = await read(); if (r.expanded === 'true' && r.rows.length) return r;
  for (let i = 0; i < 2; i++) { await b.click({ timeout: 5000 }).catch(() => {}); await sleep(1500); r = await read(); if (r.expanded === 'true' && r.rows.length) return r; }
  return r;
}
async function closeScanner(page) { const b = scannerBtn(page); if (await b.count() && (await b.getAttribute('aria-expanded', { timeout: 3000 }).catch(() => null)) === 'true') { await b.click({ timeout: 4000 }).catch(() => {}); await sleep(500); } await page.mouse.move(5, 700).catch(() => {}); await sleep(300); }

async function features(acct) {
  const coin = coinFor(acct); const tag = `${acct}-${coin}`;
  let { ctx, page, rec, errs } = await load(acct, `/arena?coin=${coin}&tf=1h`);
  try {
    say({ acct, step: 'loaded', url: page.url().replace(BASE, ''), canvases: await canvases(page), lockLine: await page.locator('[data-testid="arena-coin-lock-line"]').count() });
    // F1 timeframe
    const c0 = await canvases(page); await tfBtn(page, '4h').click({ timeout: 5000 }).catch((e) => say({ acct, step: 'tf 4h click failed', e: e.message.slice(0, 80) })); await sleep(3500);
    say({ acct, step: 'F1 timeframe 4h', url: page.url().replace(BASE, ''), canvasesBefore: c0, canvasesAfter: await canvases(page), pressed4h: await tfBtn(page, '4h').getAttribute('class') });
    await page.screenshot({ path: `${AR}/${tag}-tf-4h.jpg`, type: 'jpeg', quality: 70 });
    await tfBtn(page, '15m').click({ timeout: 5000 }).catch(() => {}); await sleep(3000);
    say({ acct, step: 'F1 timeframe 15m (Pro-only for Free?)', url: page.url().replace(BASE, ''), upgradeText: await page.evaluate(() => (/(part of Pro|Upgrade|Pro only|unlock)/i.exec(document.body.innerText) || [null])[0]) });
    await page.screenshot({ path: `${AR}/${tag}-tf-15m.jpg`, type: 'jpeg', quality: 70 });
    // the 15m probe can leave an upgrade prompt over the page for Free: start F2 from a clean load
    await page.goto(`${BASE}/arena?coin=${coin}&tf=1h`, { waitUntil: 'load', timeout: 90_000 }); await sleep(8000);
    // F2 categories
    const cats = {};
    for (const cat of ['All', 'Majors', 'Alts', 'DeFi/AI', 'Meme']) {
      await closeScanner(page);
      await page.locator('button').filter({ hasText: new RegExp(`^${cat.replace('/', '\\/')}$`) }).first().click({ timeout: 5000 }).catch(() => {}); await sleep(700);
      const r = await openScannerList(page); cats[cat] = r ? r.rows : null;
      if (cat === 'Meme') await page.screenshot({ path: `${AR}/${tag}-category-meme-open.jpg`, type: 'jpeg', quality: 70 });
    }
    say({ acct, step: 'F2 categories (coins listed when the list is open)', counts: Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, v ? v.length : null])), samples: Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, (v || []).slice(0, 10).join(',')])) });
    await closeScanner(page);
    await page.locator('button').filter({ hasText: /^All$/ }).first().click({ timeout: 4000 }).catch(() => {}); await sleep(500);
    // F3 coin switch from the list
    const target = coin === 'btc' ? 'ETH' : 'BTC';
    const list = await openScannerList(page);
    const row = page.locator('button, [role="button"], [role="option"], a').filter({ has: page.locator(`xpath=.//*[normalize-space(text())="${target}"]`) }).last(); // the row button holding a leaf whose own text is exactly the ticker (textContent runs "ETHUSDT Perp...", so a text regex cannot anchor it)
    if (list && (await row.count())) { await row.click({ timeout: 5000 }).catch(() => {}); await sleep(4000); }
    say({ acct, step: `F3 coin switch to ${target}`, listed: !!(list && list.rows.includes(target)), url: page.url().replace(BASE, ''), chip: (await scannerBtn(page).innerText().catch(() => '')).trim().slice(0, 20), canvases: await canvases(page) });
    await page.screenshot({ path: `${AR}/${tag}-coin-switch-${target.toLowerCase()}.jpg`, type: 'jpeg', quality: 70 });
    // F4 strategy set + an indicator toggle
    await page.goto(`${BASE}/arena?coin=${coin}&tf=1h`, { waitUntil: 'load', timeout: 90_000 }); await sleep(8000);
    try {
    const sel = page.locator('select[aria-label="Strategy set"]').first();
    let stratOpts = []; if (await sel.count()) { stratOpts = await sel.evaluate((s) => [...s.options].map((o) => o.text)); const before = await sel.inputValue(); const opts = await sel.evaluate((s) => [...s.options].map((o) => o.value)); const next = opts.find((v) => v !== before); if (next) await sel.selectOption(next).catch(() => {}); await sleep(2500); say({ acct, step: 'F4 strategy set', options: stratOpts, from: before, to: await sel.inputValue() }); await sel.selectOption(before).catch(() => {}); await sleep(1200); }
    else say({ acct, step: 'F4 strategy set', found: false });
    const macd = page.locator('button').filter({ hasText: /^MACD$/ }).first();
    if (await macd.count()) { const b4 = { pressed: await macd.getAttribute('aria-pressed', { timeout: 3000 }).catch(() => 'n/a'), panes: await canvases(page) }; await macd.click({ timeout: 4000 }).catch(() => {}); await sleep(3000); const af = { pressed: await macd.getAttribute('aria-pressed', { timeout: 3000 }).catch(() => 'n/a'), panes: await canvases(page) }; await page.screenshot({ path: `${AR}/${tag}-macd-on.jpg`, type: 'jpeg', quality: 70, fullPage: true }); const limit = await page.locator('[data-testid="strategy-limit-upgrade"]').count(); say({ acct, step: 'F4 indicator MACD toggle', before: b4, after: af, limitPrompt: limit }); await macd.click({ timeout: 4000 }).catch(() => {}); await sleep(1500); }
    else say({ acct, step: 'F4 indicator MACD', found: false });
    } catch (e) { say({ acct, step: 'F4 strategy panel', error: String(e.message).split('\n')[0].slice(0, 160) }); }
    // F5 lock on a locked coin (Free / trial): XRP
    if (acct !== 'A') try {
      await page.goto(`${BASE}/arena?coin=xrp&tf=1h`, { waitUntil: 'load', timeout: 90_000 }); await sleep(9000);
      const before = rec.filter((n) => /\/api\/grok/.test(n.url)).length;
      const lock = await page.evaluate(() => { const l = document.querySelector('[data-testid="arena-coin-lock-line"]'); return l ? { text: (l.innerText || '').trim().slice(0, 140), upgrade: !!document.querySelector('[data-testid="arena-coin-lock-upgrade"]') } : null; });
      const q = page.locator('button').filter({ hasText: /^(🔒\s*)?Quick Research/ }).first(); const qState = (await q.count()) ? { disabled: await q.isDisabled(), text: (await q.innerText()).trim() } : null;
      if (await q.count()) await q.click({ timeout: 3000, force: true }).catch(() => {}); await sleep(2500);
      const d = page.locator('button').filter({ hasText: /^(🔒\s*)?Deep Research/ }).first(); const dState = (await d.count()) ? { disabled: await d.isDisabled(), text: (await d.innerText()).trim() } : null;
      if (await d.count()) await d.click({ timeout: 3000, force: true }).catch(() => {}); await sleep(2500);
      const after = rec.filter((n) => /\/api\/grok/.test(n.url)).length;
      await page.screenshot({ path: `${AR}/${tag}-xrp-locked.jpg`, type: 'jpeg', quality: 70 });
      say({ acct, step: 'F5 lock on XRP', lock, quick: qState, deep: dState, grokRequestsSentByClicks: after - before, upgradeShown: await page.evaluate(() => (/(Upgrade|part of Pro|Pro only)/i.exec(document.body.innerText) || [null])[0]) });
    } catch (e) { say({ acct, step: 'F5 lock on XRP', error: String(e.message).split('\n')[0].slice(0, 160) }); }
    say({ acct, step: 'errors during features', errs: errs.slice(0, 12) });
  } finally { await ctx.close(); }
}

async function billed(acct, kind) {
  const coin = coinFor(acct); const tf = '1h'; const path = kind === 'chat' ? '/api/grok-chat' : '/api/grok';
  const budget = kind === 'deep' ? 3 : 1; let passed = 0, blocked = 0; const calls = [];
  const appStub = async (r, req, u) => {
    if (req.method() !== 'POST' || u.pathname !== path) return false;
    if (passed < budget) { passed++; const sentAt = new Date().toISOString(); calls.push({ sentAt, body: req.postData() || '' }); await r.continue(); return true; }
    blocked++; await r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"qa budget","code":"RATE_LIMITED"}' }); return true;
  };
  const { ctx, page, errs } = await load(acct, `/arena?coin=${coin}&tf=${tf}`, { appStub });
  /* The headers can arrive long before the body (the first Free Quick answered after about 3 minutes), so the body is awaited separately and the
     context is never closed before it lands or the limit runs out. */
  const resps = []; page.on('response', (r) => { if (r.request().method() === 'POST' && new URL(r.url()).pathname === path) { const rec = { at: new Date().toISOString(), status: r.status(), body: null, bodyAt: null }; rec.done = r.text().then((b) => { rec.body = b; rec.bodyAt = new Date().toISOString(); }, (e) => { rec.body = `(could not read body: ${e.message})`; }); resps.push(rec); } });
  const base = `${AI}/${TIER[acct]}-${kind}-${coin}-${tf}`;
  try {
    const probeBefore = await dbProbe();
    const t0 = Date.now();
    if (kind === 'chat') {
      /* The closed panel keeps its textarea in the DOM with a box, so isVisible() says yes while nothing is on screen (the first Free run typed
         into a closed panel and sent nothing). Open it with the floating launcher (the page's "Ask LiquidityAI" button auto-sends a canned
         prompt, #1631) and require the panel to be on screen before typing. */
      const panelOpen = () => page.evaluate(() => { const p = document.querySelector('[data-testid="grok-panel"]'); if (!p) return false; const r = p.getBoundingClientRect(); const cs = getComputedStyle(p); return r.width > 100 && r.left < innerWidth && r.right > 0 && parseFloat(cs.opacity) > 0.5 && cs.visibility !== 'hidden' && cs.pointerEvents !== 'none'; });
      if (!(await panelOpen())) { await page.getByTestId('grok-launcher').click({ timeout: 5000 }).catch(() => {}); await sleep(2000); }
      const opened = await panelOpen();
      const ta = page.locator('[data-testid="grok-panel"] textarea[aria-label="Ask LiquidityAI"]').first();
      const placeholder = await ta.getAttribute('placeholder').catch(() => null);
      writeFileSync(`${base}-panel-open-before-typing.txt`, `panel on screen before typing: ${opened}; requests already sent to ${path} by opening it: ${passed + blocked}\n`);
      const q = `Summarize the current ${coin.toUpperCase()} ${tf} setup from the data you have: trend, funding rate, open interest and the key levels.`;
      await ta.click({ timeout: 5000 }).catch(() => {}); await ta.fill(q).catch(() => {}); await sleep(400);
      await page.locator('[data-testid="grok-panel"] button[aria-label="Send"]').first().click({ timeout: 5000 }).catch(() => {});
      writeFileSync(`${base}-question.txt`, `${q}\n(placeholder shown in the box: ${placeholder})\n`);
    } else {
      const label = kind === 'quick' ? /^Quick Research/ : /^Deep Research/;
      await page.locator('button').filter({ hasText: label }).first().click({ timeout: 5000 });
    }
    const limit = kind === 'deep' ? 540_000 : 360_000;
    while (Date.now() - t0 < limit && passed === 0) await sleep(500);
    await sleep(kind === 'chat' ? 4000 : 5000);
    // every passed call must have its response AND its body, or the limit runs out
    while (Date.now() - t0 < limit && (resps.length < passed || resps.some((r) => r.body === null))) await sleep(1000);
    // then let the page render the read: the "analysis..." placeholder goes away
    for (let i = 0; i < 30; i++) { const busy = await page.evaluate(() => /(Quick analysis|Deep analysis|Researching|Thinking)\.\.\./i.test(document.body.innerText)).catch(() => false); if (!busy) break; await sleep(1000); }
    await sleep(2500);
    const meta = { tier: TIER[acct], account: ACCT_NAME[acct], kind, coin, timeframe: tf, endpoint: path, build: (await (await fetch(BASE + '/api/version')).json()).commit, calls: calls.map((c, i) => ({ sentAtUtc: c.sentAt, responseStatus: resps[i]?.status ?? null, headersAtUtc: resps[i]?.at ?? null, bodyCompleteAtUtc: resps[i]?.bodyAt ?? null })), passed, blockedPastBudget: blocked, waitedMs: Date.now() - t0, dbProbeBeforeClick: probeBefore, dbProbeAfter: await dbProbe(), pageUrl: page.url().replace(BASE, ''), errors: errs.slice(0, 10) };
    writeFileSync(`${base}-meta.json`, JSON.stringify(meta, null, 1));
    calls.forEach((c, i) => { writeFileSync(`${base}-request${calls.length > 1 ? '-' + (i + 1) : ''}.json`, c.body); });
    resps.forEach((r, i) => { writeFileSync(`${base}-response${resps.length > 1 ? '-' + (i + 1) : ''}.txt`, r.body); });
    await page.screenshot({ path: `${base}-page.png`, fullPage: true });
    if (kind === 'chat') { const panel = page.getByTestId('grok-panel'); if (await panel.count()) await panel.screenshot({ path: `${base}-panel.png` }).catch(() => {}); }
    /* first = the main read panel (last was the Session History card) */
    else { const el = page.locator(':text-matches("(BULLISH|BEARISH|FLAT|LEAN BULLISH|LEAN BEARISH)", "i")').first(); if (await el.count()) { await el.scrollIntoViewIfNeeded().catch(() => {}); await sleep(600); await page.screenshot({ path: `${base}-read.png` }); } }
    say({ acct, step: `BILLED ${kind}`, coin, tf, ...meta, errors: undefined });
  } catch (e) { say({ acct, step: `BILLED ${kind}`, error: String(e.message).slice(0, 200), passed, blocked }); }
  finally { await ctx.close(); }
}

try {
  console.log('build', (await (await fetch(BASE + '/api/version')).json()).commit, new Date().toISOString());
  for (const acct of accts) {
    if (parts.includes('features')) await features(acct);
    for (const k of ['quick', 'deep', 'chat']) if (parts.includes(k)) await billed(acct, k);
  }
} finally { await browser.close(); }
