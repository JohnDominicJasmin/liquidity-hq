/* #1509 How to test 1-7 on qa. Plan read (user_subscriptions) held 8s in the fence. Stubbed app responses (named in the
 * comment): POST /api/shadow-account (200 fixture for Pro, 403 PRO_REQUIRED for Free), GET /api/hypotheses (one fixture
 * hypothesis - the real route would 401 the synthetic token), GET .../evidence ({evidence:[]}), POST /api/hypotheses (200).
 * usage: node t-journal.mjs [s1,s2,s3,s3b,s4,s5,s6,s7] */
import { chromium, open, settle, sleep, jlog, OUT, version } from './lib.mjs';
const JOBS = (process.argv[2] ?? 's1,s2,s3,s3b,s4,s5,s6,s7').split(',');
const L = jlog('journal.json');
const BASE = 'https://liquidity-hq-qa.onrender.com';
const HOLD = 8000;
const TABS = { shadow: { i: 4, btn: 'Analyze My Trades' }, bias: { i: 5, btn: 'Run Bias Diagnostics' }, thesis: { i: 6, btn: '+ New Thesis' } };
const HYP = { id: 'qa-hyp-1', title: 'QA fixture hypothesis', hypothesis: 'BTC holds the weekly open', acceptance_criteria: ['close above'], status: 'active', grok_verdict: null, grok_reasoning: null, grok_evidence_assessment: null, grok_confidence: null, grok_next_check: null, grok_last_run: null, target_date: null, created_at: new Date().toISOString() };
const stub = (o) => async (r, req, u) => {
  const m = req.method(); const j = (s, b) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) }).then(() => true);
  if (u.pathname === '/api/shadow-account' && m === 'POST') return o.free ? j(403, { error: 'PRO_REQUIRED' }) : j(200, { analysis: '## QA fixture\nStubbed shadow-account analysis (200).' });
  if (u.pathname === '/api/hypotheses' && m === 'GET') return j(200, { hypotheses: [HYP, ...(o.created ? [o.created] : [])] });
  if (u.pathname === '/api/hypotheses' && m === 'POST') { const b = JSON.parse(req.postData() || '{}'); o.created = { ...HYP, id: 'qa-hyp-2', title: b.title, hypothesis: b.hypothesis }; return j(200, { hypothesis: o.created }); }
  if (/^\/api\/hypotheses\/[^/]+\/evidence$/.test(u.pathname) && m === 'GET') return j(200, { evidence: o.ev ?? [] });
  if (/^\/api\/hypotheses\/[^/]+\/evidence$/.test(u.pathname) && m === 'POST') { const b = JSON.parse(req.postData() || '{}'); o.ev = [{ id: 'qa-ev-1', hypothesis_id: 'qa-hyp-1', type: b.type, content: b.content, source: null, created_at: new Date().toISOString() }]; return j(200, { evidence: o.ev[0] }); }
  return false;
};
const S = (btn) => ({ locked: !!document.querySelector('[data-testid="locked-feature"]'), hypLocked: [...document.querySelectorAll('[data-testid="locked-feature"]')].some((e) => e.innerText.includes('Hypothesis Analysis')), lockedTitles: [...document.querySelectorAll('[data-testid="locked-feature"]')].map((e) => e.innerText.split(String.fromCharCode(10))[0].slice(0, 40)), unknown: !!document.querySelector('[data-testid="entitlement-unknown"]'), unknownTitles: [...document.querySelectorAll('[data-testid="entitlement-unknown"]')].map((e) => e.innerText.split(String.fromCharCode(10))[0].slice(0, 40)), analysis: document.body.innerText.includes('Stubbed shadow-account analysis'), btn: [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === btn && b.offsetParent !== null), err: [...document.querySelectorAll('div')].filter((d) => d.children.length === 0 && /PRO_REQUIRED|failed|network/i.test(d.textContent || '')).map((d) => d.textContent.slice(0, 80)) });
async function watch(page, btn, ms, t0) { const tl = []; let last = null; const end = Date.now() + ms; while (Date.now() < end) { const s = await page.evaluate(S, btn).catch(() => null); const k = JSON.stringify(s); if (k !== last) { tl.push({ t: Date.now() - t0, ...s }); last = k; } await sleep(100); } return tl; }
async function journal(browser, { plan, usDelay, tab, click, name, watchMs }) {
  const rec = []; const o = { free: plan === 'free' };
  const ctx = await open(browser, { plan, usDelay, rec, appStub: stub(o) }); const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(BASE + '/journal', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('button[data-testid="journal-tab"]', { timeout: 60_000 });
  const tabAt = Date.now() - t0;
  await page.locator('button[data-testid="journal-tab"]').nth(TABS[tab].i).click();
  let clickAt = null;
  if (click) { await page.waitForFunction((b) => [...document.querySelectorAll('button')].some((x) => x.innerText.trim() === b), TABS[tab].btn, { timeout: 15_000 }).catch(() => {}); await sleep(300); await page.getByRole('button', { name: TABS[tab].btn, exact: true }).click().catch(() => {}); clickAt = Date.now() - t0; }
  const midShot = `${OUT}/1509-${name}-during-window.png`; await page.screenshot({ path: midShot });
  const tl = await watch(page, TABS[tab].btn, watchMs ?? (usDelay ?? 0) + 5000, t0);
  await page.screenshot({ path: `${OUT}/1509-${name}-end.png` });
  const plans = rec.filter((x) => /plan:/.test(x.br)).map((x) => x.t - t0);
  L.say({ job: name, plan, usDelay, tab, tabClickedAtMs: tabAt, analyzeClickedAtMs: clickAt, planReadsIssuedAtMs: plans, planAnsweredAtMs: plans.map((t) => t + (usDelay ?? 0)), timeline: tl, everLocked: tl.some((x) => x.locked), endLocked: tl.at(-1)?.locked, endUnknown: tl.at(-1)?.unknown, analysisShown: tl.some((x) => x.analysis), stubbed: rec.filter((x) => x.br === 'STUB').map((x) => `${x.m} ${x.p}`) });
  await ctx.close();
}
async function research(browser, { plan, usDelay, name, create, watchMs }) {
  const rec = []; const o = { free: plan === 'free' };
  const ctx = await open(browser, { plan, usDelay, rec, appStub: stub(o) }); const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(BASE + '/research', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  const hb = page.locator('button[aria-expanded]', { hasText: 'QA fixture hypothesis' }).first();
  await hb.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
  const expAt = Date.now() - t0; await hb.scrollIntoViewIfNeeded().catch(() => {}); await hb.click().catch(() => {});
  await sleep(400); await page.screenshot({ path: `${OUT}/1509-${name}-during-window.png` });
  const tl = await watch(page, 'Run Grok Analysis', watchMs ?? (usDelay ?? 0) + 5000, t0);
  const lk = page.locator('[data-testid="locked-feature"], [data-testid="entitlement-unknown"]').first(); if (await lk.count()) await lk.scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: `${OUT}/1509-${name}-end.png` });
  let createRes = null;
  if (create) {
    // Free tracker features stay usable: log evidence on the expanded card, create a new hypothesis (both POSTs stubbed 200)
    const ev = page.getByPlaceholder(/evidence/i).first(); const evOk = await ev.isVisible().catch(() => false);
    if (evOk) { await ev.fill('QA evidence line'); await ev.press('Enter').catch(() => {}); const addBtn = page.locator('button', { hasText: /^(Add|Log)/ }).first(); if (await addBtn.isVisible().catch(() => false)) await addBtn.click().catch(() => {}); await sleep(1500); }
    const evShown = await page.evaluate(() => document.body.innerText.includes('QA evidence line'));
    const nb = page.getByRole('button', { name: '+ New Hypothesis' }).first(); await nb.click().catch(() => {}); await sleep(500);
    const inputs = page.locator('input, textarea'); const n = await inputs.count();
    await page.getByPlaceholder('e.g. BTC enters accumulation phase below $60k').fill('QA created hypothesis').catch(() => {});
    await page.getByPlaceholder(/^Describe your hypothesis/).fill('QA thesis text').catch(() => {});
    const save = page.getByRole('button', { name: 'Save Hypothesis' }).first(); const saveVis = await save.isVisible().catch(() => false); if (saveVis) await save.click().catch(() => {});
    await sleep(2000);
    createRes = { evidenceInputVisible: evOk, evidenceShownAfterAdd: evShown, formInputs: n, saveVisible: saveVis, createdShown: await page.evaluate(() => document.body.innerText.includes('QA created hypothesis')), posts: rec.filter((x) => x.m === 'POST').map((x) => `${x.br} ${x.p}`) };
    await page.screenshot({ path: `${OUT}/1509-${name}-after-create.png` });
  }
  L.say({ job: name, plan, usDelay, expandedAtMs: expAt, planReadsIssuedAtMs: rec.filter((x) => /plan:/.test(x.br)).map((x) => x.t - t0), timeline: tl, everHypLocked: tl.some((x) => x.hypLocked), endHypLocked: tl.at(-1)?.hypLocked, endUnknown: tl.at(-1)?.unknown, btnAlwaysAfterExpand: tl.every((x) => x.btn || x.hypLocked || x.unknown), createRes });
  await ctx.close();
}
const browser = await chromium.launch();
try {
  L.say({ served: await version() });
  if (JOBS.includes('s1')) for (const tab of ['shadow', 'bias', 'thesis']) await journal(browser, { plan: 'pro', usDelay: HOLD, tab, name: `s1-pro-held-${tab}` });
  if (JOBS.includes('s1')) await journal(browser, { plan: 'trial', usDelay: HOLD, tab: 'shadow', name: 's1-trial-held-shadow' });
  if (JOBS.includes('s2')) await journal(browser, { plan: 'pro', usDelay: HOLD, tab: 'shadow', click: true, name: 's2-pro-held-click' });
  if (JOBS.includes('s3')) await journal(browser, { plan: 'free', usDelay: HOLD, tab: 'shadow', name: 's3-free-held-shadow' });
  if (JOBS.includes('s3b')) await journal(browser, { plan: 'free', usDelay: HOLD, tab: 'shadow', click: true, name: 's3b-free-held-click' });
  if (JOBS.includes('s4')) for (const tab of ['shadow', 'bias', 'thesis']) await journal(browser, { plan: 'free', tab, name: `s4-free-nodelay-${tab}` });
  if (JOBS.includes('s5')) await research(browser, { plan: 'pro', usDelay: HOLD, name: 's5-research-pro-held' });
  if (JOBS.includes('s6')) await research(browser, { plan: 'free', usDelay: HOLD, name: 's6-research-free-held', create: true });
  if (JOBS.includes('s7')) { await journal(browser, { plan: 'fail', tab: 'shadow', name: 's7-journal-planfail', watchMs: 25000 }); await research(browser, { plan: 'fail', name: 's7-research-planfail', watchMs: 25000 }); }
} catch (e) { L.say({ crash: String(e).slice(0, 400) }); } finally { await browser.close(); L.save(); }
