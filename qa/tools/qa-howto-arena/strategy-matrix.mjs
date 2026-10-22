/* Strategy panel matrix (#1543): every chip x plan x {select, deselect, cap, reload, timeframe change, strategy set, keyboard}
 * x 390/1280 x dark/light, read from the DOM AND from the chart instance (what is really drawn: overlays + indicators), so the
 * chip state and the chart are compared without guessing from pixels. The chart instance is reached through React's fiber from
 * the chart toolbar's S/R button (the klinecharts canvases carry no fiber), and read with getOverlays()/getIndicators().
 * Plans are stubbed through the subscription read (free | trial | pro): this tests the CLIENT, never the server.
 * user_settings is STATEFUL: a PATCH /api/settings body is merged into what the next read returns, so reload shows persistence.
 * usage: node strategy-matrix.mjs <qa|prod> <plans> <themes> <widths> <outfile>   e.g.  qa free,trial,pro dark,light 1280,390 out.json */
import { chromium, open, settle, sleep, QA, PROD, OUT } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [, , bArg = 'qa', plansArg = 'free,trial,pro', themesArg = 'dark,light', widthsArg = '1280,390', outArg = 'strategy-matrix.json'] = process.argv;
const B = bArg === 'prod' ? PROD : QA;
mkdirSync(`${OUT}/strategy-matrix`, { recursive: true });
const rowsOut = [];
const say = (o) => { rowsOut.push(o); };

const READ = () => {
  const clean = (c) => { const k = c.cloneNode(true); k.querySelectorAll('.strat-chip-tag').forEach((t) => t.remove()); return (k.textContent || '').trim().replace(/^\d+\s*/, ''); };
  const chips = [...document.querySelectorAll('.strat-panel .strat-chip')].map((c) => ({ label: clean(c), on: c.classList.contains('on'), always: c.classList.contains('always'), tag: (c.querySelector('.strat-chip-tag')?.textContent || '').trim() || null, pressed: c.getAttribute('aria-pressed'), blocked: c.classList.contains('blocked'), notyet: c.classList.contains('notyet'), ariaDisabled: c.getAttribute('aria-disabled'), ariaLabel: c.getAttribute('aria-label'), title: c.getAttribute('title') }));
  const m = (document.querySelector('.strat-count')?.textContent || '').match(/(\d+) of (\d+)/);
  let drawn = null;
  try {
    const btn = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'S/R' && !x.closest('.strat-panel'));
    const fk = btn && Object.keys(btn).find((k) => k.startsWith('__reactFiber'));
    for (let n = fk ? btn[fk] : null, d = 0; n && d < 80 && !drawn; n = n.return, d++) {
      for (let h = n.memoizedState, i = 0; h && i < 80 && !drawn; h = h.next, i++) { const v = h.memoizedState; const o = v && typeof v === 'object' ? v.current : null; for (const c of [v, o]) { if (c && typeof c === 'object' && typeof c.getOverlays === 'function' && typeof c.getIndicators === 'function') { const ov = {}; for (const x of c.getOverlays()) ov[x.name] = (ov[x.name] || 0) + 1; const ind = {}; for (const x of c.getIndicators()) ind[x.name] = (ind[x.name] || 0) + 1; drawn = { overlays: ov, indicators: ind }; break; } } }
    }
  } catch { /* leave null */ }
  return { set: document.querySelector('select[aria-label="Strategy set"]')?.value ?? null, counter: document.querySelector('.strat-count')?.textContent?.trim() ?? null, used: m ? Number(m[1]) : null, limit: m ? Number(m[2]) : null, on: chips.filter((c) => c.on).map((c) => c.label), chips, drawn };
};
const brief = (s) => ({ set: s.set, counter: s.counter, on: s.on, drawn: s.drawn });

async function run(browser, plan, theme, w) {
  const settings = { default_coin: 'btc', default_tf: '1h', strategy_selection: [], strategy_params: {} };
  const ctx = await open(browser, { b: B, w, plan, theme, settings, appStub: async (r, req, u) => { if (req.method() === 'PATCH' && u.pathname === '/api/settings') { try { const body = JSON.parse(req.postData() || '{}'); delete body.knownAsOf; Object.assign(settings, body); } catch { /* */ } } return false; } });
  const page = await ctx.newPage(); const ctxTag = `${plan}/${theme}/${w}`;
  const read = () => page.evaluate(READ);
  let LABELS = [];
  const chipLoc = (label) => page.locator('.strat-panel .strat-chip').nth(Math.max(0, LABELS.indexOf(label)));
  const goto = async () => { await page.goto(B.base + '/arena', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await page.waitForSelector('.strat-panel .strat-chip', { timeout: 60_000 }).catch(() => {}); await sleep(5000); };
  try {
    await goto();
    const base = await read();
    say({ ctx: ctxTag, step: 'baseline', ...brief(base), chipCount: base.chips.length, notYet: base.chips.filter((c) => c.notyet).length, limit: base.limit });
    const labels = base.chips.map((c) => c.label); LABELS = labels;
    // 1. every chip: select then deselect
    for (const label of labels) {
      const loc = chipLoc(label); await loc.scrollIntoViewIfNeeded().catch(() => {});
      const b0 = await read(); const chip0 = b0.chips.find((c) => c.label === label);
      await loc.click({ timeout: 5000 }).catch(() => {}); await sleep(900);
      const s1 = await read(); const chip1 = s1.chips.find((c) => c.label === label);
      await loc.click({ timeout: 5000 }).catch(() => {}); await sleep(900);
      const s2 = await read(); const chip2 = s2.chips.find((c) => c.label === label);
      say({ ctx: ctxTag, step: 'chip', chip: label, notyet: chip0?.notyet, always: chip0?.always, tag: chip0?.tag, on0: chip0?.on, ariaLabel0: chip0?.ariaLabel, ariaDisabled0: chip0?.ariaDisabled, counterBefore: b0.used, on1: chip1?.on, on2: chip2?.on, selected: chip1?.on, countAfterSelect: s1.used, drawnAfterSelect: s1.drawn, deselected: chip2 ? !chip2.on : null, countAfterDeselect: s2.used, drawnAfterDeselect: s2.drawn, drawnBefore: b0.drawn });
    }
    // 2. cap: fill to the limit with usable chips, then try one more
    const usable = base.chips.filter((c) => !c.notyet).map((c) => c.label); const limit = base.limit ?? 1; const picks = usable.filter((l) => !/^(EMA RIBBON|LIQ CLUSTERS|S\/R|GEX)$/i.test(l)).slice(0, limit + 1);
    for (const l of picks.slice(0, limit)) { await chipLoc(l).click({ timeout: 5000 }).catch(() => {}); await sleep(700); }
    const full = await read(); const extra = picks[limit]; let afterExtra = null;
    if (extra) { await chipLoc(extra).click({ timeout: 5000 }).catch(() => {}); await sleep(700); afterExtra = await read(); }
    say({ ctx: ctxTag, step: 'cap', limit, filled: picks.slice(0, limit), counterFull: full.counter, onFull: full.on, extraTried: extra, extraBlockedAttr: full.chips.find((c) => c.label === extra)?.ariaDisabled ?? null, extraSelected: afterExtra ? afterExtra.on.includes(extra) : null, countAfterExtra: afterExtra?.used ?? null, drawnFull: full.drawn });
    // 3. reload (persistence of the saved selection)
    const savedBefore = JSON.stringify(settings.strategy_selection); await goto(); const rl = await read();
    say({ ctx: ctxTag, step: 'reload', savedSelection: savedBefore, ...brief(rl) });
    // 4. timeframe change keeps the selection
    const tfBefore = await read(); await page.locator('button', { hasText: /^4h$/ }).first().click({ timeout: 5000 }).catch(() => {}); await sleep(3500); const tfAfter = await read();
    say({ ctx: ctxTag, step: 'timeframe', onBefore: tfBefore.on, onAfter: tfAfter.on, counterAfter: tfAfter.counter, drawnAfter: tfAfter.drawn });
    // 5. strategy sets
    for (const id of ['trend_follow', 'mean_reversion', 'liquidity_sweep', 'custom', 'auto']) {
      await page.locator('select[aria-label="Strategy set"]').selectOption(id).catch(() => {}); await sleep(1500); const s = await read();
      say({ ctx: ctxTag, step: 'set', id, ...brief(s) });
    }
    // 6. keyboard: Space and Enter on a usable builtin chip, and what a focused chip looks like next to a selected one
    const kb = picks[0] ?? 'RSI'; const kloc = chipLoc(kb); await kloc.scrollIntoViewIfNeeded().catch(() => {});
    await page.locator('select[aria-label="Strategy set"]').selectOption('auto').catch(() => {}); await sleep(900);
    await kloc.focus(); await page.keyboard.press('Space'); await sleep(800); const kSpace = await read();
    await page.keyboard.press('Space'); await sleep(800); const kSpace2 = await read();
    await page.keyboard.press('Enter'); await sleep(800); const kEnter = await read();
    const look = await page.evaluate((lab) => { const chips = [...document.querySelectorAll('.strat-panel .strat-chip')]; const c = chips.find((x) => (x.textContent || '').trim().replace(/^\d+\s*/, '').toLowerCase() === lab.toLowerCase()); if (!c) return null; const cs = getComputedStyle(c); return { focused: document.activeElement === c, focusVisible: c.matches(':focus-visible'), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, border: cs.borderTopColor + ' ' + cs.borderTopWidth, background: cs.backgroundColor, on: c.classList.contains('on') }; }, kb);
    say({ ctx: ctxTag, step: 'keyboard', chip: kb, afterSpace: kSpace.on, afterSecondSpace: kSpace2.on, afterEnter: kEnter.on, lookFocusedSelected: look });
    await page.keyboard.press('Space'); await sleep(600); await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    const unsel = await read(); const look2 = await page.evaluate((lab) => { const c = [...document.querySelectorAll('.strat-panel .strat-chip')].find((x) => (x.textContent || '').trim().replace(/^\d+\s*/, '').toLowerCase() === lab.toLowerCase()); if (!c) return null; c.focus(); const cs = getComputedStyle(c); return { onAfterDeselect: c.classList.contains('on'), focusedUnselected: { focusVisible: c.matches(':focus-visible'), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, border: cs.borderTopColor + ' ' + cs.borderTopWidth, background: cs.backgroundColor } }; }, kb);
    say({ ctx: ctxTag, step: 'keyboard-focus-look', chip: kb, onNow: unsel.on, ...look2 });
    await page.screenshot({ path: `${OUT}/strategy-matrix/${bArg}-${plan}-${theme}-${w}.png`, fullPage: false }).catch(() => {});
  } catch (e) { say({ ctx: ctxTag, step: 'ERROR', error: String(e.message).slice(0, 200) }); }
  await ctx.close();
}

const browser = await chromium.launch();
try {
  const v = await (await fetch(B.base + '/api/version')).json().catch(() => ({}));
  say({ step: 'build', commit: v.commit, branch: v.branch, at: new Date().toISOString() });
  for (const plan of plansArg.split(',')) for (const theme of themesArg.split(',')) for (const w of widthsArg.split(',').map(Number)) { await run(browser, plan, theme, w); writeFileSync(`${OUT}/strategy-matrix/${outArg}`, JSON.stringify(rowsOut, null, 1)); console.log(`done ${plan}/${theme}/${w} rows=${rowsOut.length}`); }
} finally { await browser.close(); writeFileSync(`${OUT}/strategy-matrix/${outArg}`, JSON.stringify(rowsOut, null, 1)); }
