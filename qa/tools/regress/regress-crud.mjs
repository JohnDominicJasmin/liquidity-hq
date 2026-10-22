/* #1640 real writes, seeded test accounts only (PM: "create, edit, delete price alerts; Telegram link and unlink; add, edit, delete trade; every
 * Settings toggle saves and survives reload"). Writes ON with rlib's deny list in force (no AI, email, push, payments, Telegram send).
 *
 * SAFETY: only rows this run creates are edited or deleted, found by a unique note ("qa-regress-1640 ..."); the seeded rows the e2e suite relies on
 * (E2E_A_TRADE_ID, E2E_A_PRICE_ALERT_ID, E2E_B_PRICE_ALERT_ID) are checked to still exist at the end. Settings: every value is recorded first and
 * restored at the end, then compared with the recording. The Telegram link code is never printed and its t.me link is never opened.
 * "Survives reload" is checked in a NEW browser context (fresh storage: server state only), not just a same-tab reload.
 * usage: node regress-crud.mjs [accts=A,B,T] [parts=settings,alerts,journal,language]                                                              */
import { chromium, open, quiet, sleep, session, BASE, ROOT, REF, anonKey, envVar } from './rlib.mjs';
import { mkdirSync, appendFileSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
const accts = (process.argv[2] || 'A,B,T').split(',');
const parts = (process.argv[3] || 'settings,alerts,journal,language').split(',');
const D = { settings: `${ROOT}/settings`, alerts: `${ROOT}/alerts`, journal: `${ROOT}/journal` }; for (const d of Object.values(D)) mkdirSync(d, { recursive: true });
const LOG = `${ROOT}/_sweep/crud.jsonl`; mkdirSync(`${ROOT}/_sweep`, { recursive: true });
const say = (o) => { console.log(JSON.stringify(o)); appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n'); };
/* Credentials come from rlib, which finds the checkout from its own location - this line used to read the QA folder's .env.e2e.local
   by an absolute path and would have died in any other checkout (Dev, reviewing #1690). */
const stamp = () => new Date().toISOString().slice(11, 19);
const browser = await chromium.launch();

async function load(acct, path, extra = {}) {
  const rec = []; const ctx = await open(browser, { acct, w: 1280, theme: 'dark', writes: true, rec, ...extra }); const page = await ctx.newPage(); const inflight = new Map();
  page.on('request', (r) => inflight.set(r, Date.now())); page.on('requestfinished', (r) => inflight.delete(r)); page.on('requestfailed', (r) => inflight.delete(r));
  const writes = []; page.on('response', (r) => { const m = r.request().method(); if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') writes.push({ m, u: r.url().replace(BASE, '').replace(/^https:\/\/[^/]+\.supabase\.co/, 'sb:').slice(0, 120), s: r.status() }); });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.goto(BASE + path, { waitUntil: 'load', timeout: 90_000 }); await quiet(page, inflight, 2500, 30_000); await sleep(1200);
  return { ctx, page, rec, writes, errs, inflight };
}
async function rest(acct, table, query) {
  const s = await session(acct);
  const r = await fetch(`https://${REF}.supabase.co/rest/v1/${table}?${query}`, { headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}` } });
  return { status: r.status, rows: r.ok ? await r.json() : await r.text() };
}

/* ---------- SETTINGS ---------- */
const READ_SETTINGS = () => {
  const q = (s) => document.querySelector(s);
  const pressedText = (re) => { const b = [...document.querySelectorAll('button')].filter((x) => re.test((x.innerText || '').trim())); const on = b.find((x) => x.getAttribute('aria-pressed') === 'true'); return on ? on.innerText.trim() : null; };
  const val = (label) => { const e = q(`input[aria-label="${label}"]`); return e ? e.value : null; };
  return {
    analytics: q('button[role="switch"][data-testid="settings-toggle"]')?.getAttribute('aria-checked') ?? null,
    theme: pressedText(/^(Dark|Light)$/), defaultTf: pressedText(/^(1m|5m|15m|30m|1h|2h|4h|1d)$/), riskChip: pressedText(/^(0\.25|0\.5|1|1\.5|2)%$/),
    defaultCoin: q('select[aria-label="Default Coin"]')?.value ?? null, accountSize: val('Account Size'),
    funding: val('Funding Rate trigger'), fear: val('Extreme Fear below'), greed: val('Extreme Greed above'), rsiOb: val('RSI 1h overbought'), rsiOs: val('RSI 1h oversold'), squeeze: val('Squeeze/Flush alert score'),
  };
};
async function setSettings(page, want, cur) {
  const clickText = async (re) => { await page.locator('button').filter({ hasText: re }).first().click({ timeout: 5000 }).catch(() => {}); await sleep(700); };
  if (want.analytics !== cur.analytics) { await page.locator('button[role="switch"][data-testid="settings-toggle"]').click({ timeout: 5000 }).catch(() => {}); await sleep(700); }
  if (want.theme !== cur.theme) await clickText(new RegExp(`^${want.theme}$`));
  if (want.defaultTf !== cur.defaultTf) { const btns = page.locator('button').filter({ hasText: new RegExp(`^${want.defaultTf}$`) }); await btns.last().click({ timeout: 5000 }).catch(() => {}); await sleep(700); }
  if (want.riskChip !== cur.riskChip) await clickText(new RegExp(`^${want.riskChip.replace('.', '\\.')}$`));
  if (want.defaultCoin !== cur.defaultCoin) { await page.locator('select[aria-label="Default Coin"]').selectOption(want.defaultCoin).catch(() => {}); await sleep(700); }
  for (const [k, label] of [['accountSize', 'Account Size'], ['funding', 'Funding Rate trigger'], ['fear', 'Extreme Fear below'], ['greed', 'Extreme Greed above'], ['rsiOb', 'RSI 1h overbought'], ['rsiOs', 'RSI 1h oversold'], ['squeeze', 'Squeeze/Flush alert score']]) {
    if (want[k] !== cur[k]) { const i = page.locator(`input[aria-label="${label}"]`); await i.fill(String(want[k])).catch(() => {}); await i.press('Tab').catch(() => {}); await sleep(700); }
  }
}
/* The baseline goes to disk BEFORE anything changes, so a run that is cut short (memory abort, crash) can be put back with the 'restore' part.
   A baseline file that was never marked restored blocks a new settings run on that account: its "baseline" would be the changed state. */
const baseFile = (acct) => `${ROOT}/_sweep/crud-settings-before-${acct}.json`;
async function settingsTest(acct) {
  if (existsSync(baseFile(acct)) && !JSON.parse(readFileSync(baseFile(acct), 'utf8')).restoredAt) { say({ acct, part: 'settings', ERROR: `unrestored baseline in ${baseFile(acct)}: run the restore part first` }); return; }
  let L = await load(acct, '/settings'); const base = await L.page.evaluate(READ_SETTINGS);
  const rowBefore = await rest(acct, 'lhq_dev_user_settings', `select=*&user_id=eq.${envVar(`E2E_USER_${acct}_ID`)}`);
  writeFileSync(baseFile(acct), JSON.stringify({ at: new Date().toISOString(), base, row: Array.isArray(rowBefore.rows) ? rowBefore.rows[0] ?? null : null }, null, 1));
  say({ acct, part: 'settings', step: 'baseline (UI)', base, restRow: rowBefore.status, savedTo: baseFile(acct) });
  const pick = (cur, a, b) => (cur === a ? b : a);
  const want = { analytics: base.analytics === 'true' ? 'false' : 'true', theme: pick(base.theme, 'Light', 'Dark'), defaultTf: pick(base.defaultTf, '4h', '2h'), riskChip: pick(base.riskChip, '2%', '0.5%'), defaultCoin: pick(base.defaultCoin, 'eth', 'sol'),
    accountSize: pick(base.accountSize, '12345', '23456'), funding: pick(base.funding, '0.07', '0.06'), fear: pick(base.fear, '20', '21'), greed: pick(base.greed, '80', '79'), rsiOb: pick(base.rsiOb, '75', '76'), rsiOs: pick(base.rsiOs, '25', '24'), squeeze: pick(base.squeeze, '75', '76') };
  await setSettings(L.page, want, base); await quiet(L.page, L.inflight, 3000, 20_000);
  const afterSet = await L.page.evaluate(READ_SETTINGS); await L.page.screenshot({ path: `${D.settings}/crud-${acct}-changed.jpg`, type: 'jpeg', quality: 70, fullPage: true });
  say({ acct, part: 'settings', step: 'changed (same page)', afterSet, writes: L.writes });
  await L.page.reload({ waitUntil: 'load' }); await quiet(L.page, L.inflight, 2500, 25_000); await sleep(1500);
  const sameTab = await L.page.evaluate(READ_SETTINGS); await L.ctx.close();
  L = await load(acct, '/settings'); const fresh = await L.page.evaluate(READ_SETTINGS); await L.page.screenshot({ path: `${D.settings}/crud-${acct}-fresh-context.jpg`, type: 'jpeg', quality: 70, fullPage: true });
  const diff = (got) => Object.keys(want).filter((k) => got[k] !== want[k]).map((k) => `${k}: want ${want[k]} got ${got[k]}`);
  say({ acct, part: 'settings', step: 'persistence', sameTabReloadMismatches: diff(sameTab), freshContextMismatches: diff(fresh), PASS: diff(fresh).length === 0 });
  // restore
  await setSettings(L.page, base, fresh); await quiet(L.page, L.inflight, 3000, 20_000); await L.ctx.close();
  L = await load(acct, '/settings'); const restored = await L.page.evaluate(READ_SETTINGS); await L.ctx.close();
  const rowAfter = await rest(acct, 'lhq_dev_user_settings', `select=*&user_id=eq.${envVar(`E2E_USER_${acct}_ID`)}`);
  const rb = Array.isArray(rowBefore.rows) ? rowBefore.rows[0] || {} : {}; const ra = Array.isArray(rowAfter.rows) ? rowAfter.rows[0] || {} : {};
  const changedCols = Object.keys({ ...rb, ...ra }).filter((k) => !/updated_at|field_updated_at/.test(k) && JSON.stringify(rb[k]) !== JSON.stringify(ra[k]));
  const mismatches = Object.keys(base).filter((k) => restored[k] !== base[k]).map((k) => `${k}: base ${base[k]} now ${restored[k]}`);
  say({ acct, part: 'settings', step: 'restored', mismatchesVsBaseline: mismatches, dbColumnsDifferentFromBefore: changedCols.map((k) => `${k}: ${JSON.stringify(rb[k])} -> ${JSON.stringify(ra[k])}`.slice(0, 160)) });
  if (!mismatches.length) writeFileSync(baseFile(acct), JSON.stringify({ ...JSON.parse(readFileSync(baseFile(acct), 'utf8')), restoredAt: new Date().toISOString() }, null, 1));
}
/* After a cut-short run: put the settings back from the baseline file through the app's own Settings page, then compare the row with the saved one. */
async function settingsRestore(acct) {
  /* the language part switches to Korean and back; a run cut short between the two leaves the account in Korean */
  { const L0 = await load(acct, '/settings'); const lang = await L0.page.evaluate(() => document.documentElement.lang);
    if (lang !== 'en') { await L0.page.locator('button').filter({ hasText: /^English$/ }).first().click({ timeout: 5000 }).catch(() => {}); await sleep(4000); }
    say({ acct, part: 'restore', step: 'language', wasLang: lang, setToEnglish: lang !== 'en' }); await L0.ctx.close(); }
  if (!existsSync(baseFile(acct))) { say({ acct, part: 'restore', step: 'nothing to restore (no baseline file)' }); return; }
  const saved = JSON.parse(readFileSync(baseFile(acct), 'utf8'));
  if (saved.restoredAt) { say({ acct, part: 'restore', step: `already restored at ${saved.restoredAt}` }); return; }
  let L = await load(acct, '/settings'); const cur = await L.page.evaluate(READ_SETTINGS);
  await setSettings(L.page, saved.base, cur); await quiet(L.page, L.inflight, 3000, 20_000); await L.ctx.close();
  L = await load(acct, '/settings'); const now = await L.page.evaluate(READ_SETTINGS); await L.ctx.close();
  const row = await rest(acct, 'lhq_dev_user_settings', `select=*&user_id=eq.${envVar(`E2E_USER_${acct}_ID`)}`); const ra = Array.isArray(row.rows) ? row.rows[0] || {} : {}; const rb = saved.row || {};
  const mismatches = Object.keys(saved.base).filter((k) => now[k] !== saved.base[k]).map((k) => `${k}: base ${saved.base[k]} now ${now[k]}`);
  const changedCols = Object.keys({ ...rb, ...ra }).filter((k) => !/updated_at|field_updated_at/.test(k) && JSON.stringify(rb[k]) !== JSON.stringify(ra[k]));
  say({ acct, part: 'restore', step: 'restored from the baseline file', mismatchesVsBaseline: mismatches, dbColumnsDifferentFromBaseline: changedCols.map((k) => `${k}: ${JSON.stringify(rb[k])} -> ${JSON.stringify(ra[k])}`.slice(0, 160)) });
  if (!mismatches.length) writeFileSync(baseFile(acct), JSON.stringify({ ...saved, restoredAt: new Date().toISOString() }, null, 1));
}

/* ---------- LANGUAGE (Settings buttons) ---------- */
async function languageTest(acct) {
  let L = await load(acct, '/settings');
  const btn = (re) => L.page.locator('button').filter({ hasText: re }).first();
  await btn(/^한국어$/).click({ timeout: 5000 }).catch(() => {}); await sleep(4000);
  const koNow = await L.page.evaluate(() => ({ lang: document.documentElement.lang, sample: (document.querySelector('h1')?.innerText || document.body.innerText.slice(0, 80)).trim().slice(0, 60) }));
  await L.ctx.close(); L = await load(acct, '/settings');
  const koFresh = await L.page.evaluate(() => ({ lang: document.documentElement.lang, sample: (document.querySelector('h1')?.innerText || '').trim().slice(0, 60), hasHangul: /[\uac00-\ud7a3]/.test(document.body.innerText) }));
  await L.page.screenshot({ path: `${D.settings}/crud-${acct}-korean-fresh.jpg`, type: 'jpeg', quality: 70 });
  await L.page.locator('button').filter({ hasText: /^English$/ }).first().click({ timeout: 5000 }).catch(() => {}); await sleep(4000); await L.ctx.close();
  L = await load(acct, '/settings'); const enFresh = await L.page.evaluate(() => ({ lang: document.documentElement.lang, hasHangul: /[\uac00-\ud7a3]/.test(document.body.innerText) })); await L.ctx.close();
  say({ acct, part: 'language', koAfterClick: koNow, koInFreshContext: koFresh, englishRestoredInFreshContext: enFresh, PASS: koFresh.lang === 'ko' && koFresh.hasHangul && enFresh.lang === 'en' }); // the language picker itself says 한국어 on every locale, so Hangul on the English page is not a fail (2026-10-21)
}

/* ---------- ALERTS ---------- */
async function alertsTest(acct) {
  const note = `qa-regress-1640 ${acct} ${stamp()}`;
  let L = await load(acct, '/alerts');
  const baseDeletes = await L.page.locator('button[aria-label="Delete alert"]').count();
  const formState = await L.page.evaluate(() => ({ priceInput: !!document.querySelector('input[aria-label="Alert price"]'), add: [...document.querySelectorAll('button')].some((b) => /Add Alert/.test(b.innerText)), lockText: (/(part of Pro|Upgrade|Pro only|unlock)/i.exec(document.body.innerText) || [null])[0] }));
  say({ acct, part: 'alerts', step: 'baseline', existingAlerts: baseDeletes, formState });
  if (formState.priceInput) {
    await L.page.locator('select[aria-label="Coin"]').selectOption('btc').catch(() => {});
    await L.page.locator('select[aria-label="Alert direction"]').selectOption({ index: 0 }).catch(() => {});
    await L.page.locator('input[aria-label="Alert price"]').fill('9999999');
    await L.page.locator('input[aria-label="Alert note"]').fill(note);
    const add = L.page.locator('button').filter({ hasText: /Add Alert/ }).first(); const addDisabled = await add.isDisabled();
    await add.click({ timeout: 5000 }).catch(() => {}); await quiet(L.page, L.inflight, 2000, 15_000); await sleep(1000);
    const shown = await L.page.getByText(note).count();
    await L.page.screenshot({ path: `${D.alerts}/crud-${acct}-created.jpg`, type: 'jpeg', quality: 70, fullPage: true });
    say({ acct, part: 'alerts', step: 'create', addDisabledBeforeClick: addDisabled, shownOnPage: shown, writes: L.writes.filter((w) => /price-alerts/.test(w.u)) });
    await L.ctx.close(); L = await load(acct, '/alerts');
    const survived = await L.page.getByText(note).count();
    say({ acct, part: 'alerts', step: 'create survives fresh context', shown: survived, editControlInRow: await L.page.evaluate((n) => { const el = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && (e.textContent || '').includes(n)); let row = el; for (let i = 0; i < 6 && row && !row.querySelector('button[aria-label="Delete alert"]'); i++) row = row.parentElement; return row ? [...row.querySelectorAll('button, input, select')].map((b) => b.getAttribute('aria-label') || b.innerText || b.tagName).slice(0, 8) : null; }, note) });
    // delete ONLY the row carrying this run's note
    const handle = await L.page.evaluateHandle((n) => { const el = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && (e.textContent || '').includes(n)); let row = el; for (let i = 0; i < 6 && row && !row.querySelector('button[aria-label="Delete alert"]'); i++) row = row.parentElement; const btns = row ? row.querySelectorAll('button[aria-label="Delete alert"]') : []; return btns.length === 1 ? btns[0] : null; }, note);
    const del = handle.asElement();
    if (del) { await del.click(); await quiet(L.page, L.inflight, 2000, 15_000); await sleep(800); }
    say({ acct, part: 'alerts', step: 'delete own alert', clicked: !!del, goneOnPage: (await L.page.getByText(note).count()) === 0, writes: L.writes.filter((w) => /price-alerts/.test(w.u)) });
    await L.ctx.close(); L = await load(acct, '/alerts');
    say({ acct, part: 'alerts', step: 'delete survives fresh context', goneAfterReload: (await L.page.getByText(note).count()) === 0, alertsNow: await L.page.locator('button[aria-label="Delete alert"]').count(), alertsAtStart: baseDeletes });
  }
  // a mute switch: flip, fresh context, flip back, fresh context
  /* the label is "Mute Breaking News" when on and "Unmute Breaking News" when muted (app/alerts/page.tsx), so match the end of it: the exact label
     stopped matching after the first flip on 2026-10-21 and left A muted until restore-mute-http.mjs undid it */
  const sw = 'button[role="switch"][aria-label$=" Breaking News"]';
  if (await L.page.locator(sw).count()) {
    const s0 = await L.page.locator(sw).getAttribute('aria-checked'); await L.page.locator(sw).click({ timeout: 5000 }).catch(() => {}); await quiet(L.page, L.inflight, 2000, 15_000);
    const w1 = L.writes.filter((w) => /alert-prefs/.test(w.u)); await L.ctx.close(); L = await load(acct, '/alerts');
    const s1 = await L.page.locator(sw).getAttribute('aria-checked'); await L.page.locator(sw).click({ timeout: 5000 }).catch(() => {}); await quiet(L.page, L.inflight, 2000, 15_000); await L.ctx.close(); L = await load(acct, '/alerts');
    const s2 = await L.page.locator(sw).getAttribute('aria-checked');
    say({ acct, part: 'alerts', step: 'mute switch "Breaking News"', start: s0, afterFlipFreshContext: s1, afterFlipBackFreshContext: s2, PASS: s1 !== s0 && s2 === s0, writes: w1 });
  } else say({ acct, part: 'alerts', step: 'mute switch', found: false });
  // Telegram: request a link code (never printed, never opened), then the disconnect endpoint
  const connect = L.page.locator('button').filter({ hasText: /^Connect Telegram$/ }).first();
  if (await connect.count()) {
    await connect.click({ timeout: 5000 }).catch(() => {}); await quiet(L.page, L.inflight, 2000, 15_000); await sleep(800);
    const shown = await L.page.evaluate(() => { const a = [...document.querySelectorAll('a[href*="t.me/"]')][0]; const txt = document.body.innerText; const code = /\/start\s+([A-Za-z0-9_-]{4,})/.exec(txt); return { deepLinkHost: a ? new URL(a.href).host : null, deepLinkBot: a ? new URL(a.href).pathname.slice(1) : null, startCommandShown: !!code, codeLength: code ? code[1].length : null }; });
    await L.page.screenshot({ path: `${D.alerts}/crud-${acct}-telegram-code.jpg`, type: 'jpeg', quality: 70 });
    const s = await session(acct);
    const del = await L.page.evaluate(async (tok) => { const r = await fetch('/api/telegram/link-code', { method: 'DELETE', headers: { Authorization: `Bearer ${tok}` } }); return { status: r.status, body: (await r.text()).slice(0, 120) }; }, s.access_token);
    say({ acct, part: 'alerts', step: 'Telegram connect + disconnect', linkCode: shown, writes: L.writes.filter((w) => /telegram/.test(w.u)), disconnectEndpoint: del, note: 'a real link needs a Telegram account (a human); the account was not linked, so the Disconnect BUTTON never shows' });
  } else say({ acct, part: 'alerts', step: 'Telegram', connectButton: false, text: await L.page.evaluate(() => (/(Connected|Disconnect)[^\n]{0,60}/.exec(document.body.innerText) || [null])[0]) });
  await L.ctx.close();
}

/* ---------- JOURNAL ---------- */
async function journalTest(acct) {
  const note = `qa-regress-1640 ${acct} ${stamp()}`;
  let L = await load(acct, '/journal');
  L.page.on('dialog', (d) => d.accept().catch(() => {}));
  const tabText = async () => (await L.page.locator('[data-testid="journal-tab"]').allInnerTexts()).join(' | ');
  const t0 = await tabText();
  const gated = await L.page.evaluate(() => (/(part of Pro|Upgrade to|Pro only|unlock)/i.exec(document.body.innerText) || [null])[0]);
  say({ acct, part: 'journal', step: 'baseline', tabs: t0, gatedText: gated });
  const entry = L.page.locator('input[aria-label="Entry"]');
  if (!(await entry.count())) { say({ acct, part: 'journal', step: 'no Log Trade form' }); await L.ctx.close(); return; }
  await L.page.locator('button').filter({ hasText: /^BTC$/ }).first().click().catch(() => {});
  await L.page.locator('button').filter({ hasText: /LONG/ }).first().click().catch(() => {});
  await L.page.locator('button').filter({ hasText: /^Other$/ }).first().click().catch(() => {});
  await entry.fill('100'); await L.page.locator('input[aria-label="Stop Loss"]').fill('90'); await L.page.locator('input[aria-label="Take Profit"]').fill('120'); await L.page.locator('input[aria-label="Position Size"]').fill('1');
  await L.page.locator('textarea[aria-label="Trade notes"]').fill(note);
  const logBtn = L.page.locator('button').filter({ hasText: /^Log Trade$/ }).first(); const disabled = await logBtn.isDisabled();
  await logBtn.click({ timeout: 5000 }).catch(() => {}); await quiet(L.page, L.inflight, 2000, 15_000); await sleep(1000);
  say({ acct, part: 'journal', step: 'add trade', logDisabledBeforeClick: disabled, tabs: await tabText(), writes: L.writes.filter((w) => /trades/.test(w.u)) });
  await L.ctx.close(); L = await load(acct, '/journal'); L.page.on('dialog', (d) => d.accept().catch(() => {}));
  await L.page.locator('[data-testid="journal-tab"]').filter({ hasText: /^History/ }).first().click().catch(() => {}); await sleep(2500);
  const row = await L.page.evaluate((n) => { const el = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && (e.textContent || '').includes(n)); if (!el) return null; let r = el; for (let i = 0; i < 8 && r; i++) { if (r.querySelectorAll('button').length >= 1 && r.getBoundingClientRect().height > 40) break; r = r.parentElement; } return r ? { controls: [...r.querySelectorAll('button, input, select')].map((b) => (b.getAttribute('aria-label') || b.innerText || b.getAttribute('placeholder') || b.tagName).trim().slice(0, 30)) } : { controls: [] }; }, note);
  await L.page.screenshot({ path: `${D.journal}/crud-${acct}-history.jpg`, type: 'jpeg', quality: 70, fullPage: true });
  say({ acct, part: 'journal', step: 'add survives fresh context (History tab)', shown: !!row, rowControls: row?.controls, tabs: await tabText() });
  if (!row) { await L.ctx.close(); return; }
  // within the row carrying this run's note only
  const inRow = async (re) => L.page.evaluateHandle(([n, src]) => { const rx = new RegExp(src, 'i'); const el = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && (e.textContent || '').includes(n)); let r = el; for (let i = 0; i < 8 && r; i++) { const b = [...r.querySelectorAll('button')].filter((x) => rx.test((x.innerText || x.getAttribute('aria-label') || '').trim())); if (b.length === 1) return b[0]; if (b.length > 1) return null; r = r.parentElement; } return null; }, [note, re.source]);
  // edit: open the row's edit control if it has one; otherwise close the trade with an exit price (the journal's own update path)
  let edited = null;
  const editH = (await inRow(/^(edit|✎|✏️?)$/)).asElement();
  if (editH) { await editH.click().catch(() => {}); await sleep(1200); const tp = L.page.locator('input[aria-label="Take Profit"]').last(); if (await tp.count()) { await tp.fill('130'); const save = L.page.locator('button').filter({ hasText: /^(Save|Update|Save changes)/i }).last(); await save.click().catch(() => {}); await quiet(L.page, L.inflight, 2000, 12_000); edited = 'edit form, TP 120 -> 130'; } }
  if (!edited) { const closeH = (await inRow(/^(close|close trade|exit)/)).asElement(); if (closeH) { await closeH.click().catch(() => {}); await sleep(1200); const exit = L.page.locator('input[aria-label*="Exit" i], input[placeholder*="exit" i]').last(); if (await exit.count()) { await exit.fill('110'); const ok = L.page.locator('button').filter({ hasText: /^(Save|Close|Confirm|Close trade)/i }).last(); await ok.click().catch(() => {}); await quiet(L.page, L.inflight, 2000, 12_000); edited = 'closed with exit price 110'; } } }
  say({ acct, part: 'journal', step: 'edit', how: edited, writes: L.writes.filter((w) => /trades/.test(w.u)) });
  await L.page.screenshot({ path: `${D.journal}/crud-${acct}-edited.jpg`, type: 'jpeg', quality: 70, fullPage: true });
  const delH = (await inRow(/^(delete|🗑|✕|×|remove)$/)).asElement();
  if (delH) { await delH.click().catch(() => {}); await quiet(L.page, L.inflight, 2000, 12_000); await sleep(800); }
  say({ acct, part: 'journal', step: 'delete own trade', clicked: !!delH, goneOnPage: (await L.page.getByText(note).count()) === 0, writes: L.writes.filter((w) => /trades/.test(w.u)) });
  await L.ctx.close(); L = await load(acct, '/journal');
  await L.page.locator('[data-testid="journal-tab"]').filter({ hasText: /^History/ }).first().click().catch(() => {}); await sleep(2500);
  say({ acct, part: 'journal', step: 'delete survives fresh context', gone: (await L.page.getByText(note).count()) === 0, tabs: await tabText() });
  await L.ctx.close();
}

async function seededStillThere() {
  const out = {};
  if (env.E2E_A_TRADE_ID) out.aTrade = (await rest('A', 'lhq_dev_trades', `select=id&id=eq.${env.E2E_A_TRADE_ID}`)).rows?.length ?? null;
  if (env.E2E_A_PRICE_ALERT_ID) out.aPriceAlert = (await rest('A', 'lhq_dev_price_alerts', `select=id&id=eq.${env.E2E_A_PRICE_ALERT_ID}`)).rows?.length ?? null;
  if (env.E2E_B_PRICE_ALERT_ID) out.bPriceAlert = (await rest('B', 'lhq_dev_price_alerts', `select=id&id=eq.${env.E2E_B_PRICE_ALERT_ID}`)).rows?.length ?? null;
  return out;
}

try {
  console.log('build', (await (await fetch(BASE + '/api/version')).json()).commit, new Date().toISOString());
  say({ step: 'seeded rows at start (1 = present)', ...(await seededStillThere()) });
  for (const acct of accts) {
    for (const p of parts) {
      try { if (p === 'settings') await settingsTest(acct); if (p === 'restore') await settingsRestore(acct); if (p === 'alerts') await alertsTest(acct); if (p === 'journal') await journalTest(acct); if (p === 'language') await languageTest(acct); }
      catch (e) { say({ acct, part: p, ERROR: String(e.message).slice(0, 200) }); }
    }
  }
  say({ step: 'seeded rows at end (1 = present)', ...(await seededStillThere()) });
} finally { await browser.close(); }
