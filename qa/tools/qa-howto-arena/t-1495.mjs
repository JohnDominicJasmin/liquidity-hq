/* #1495 How to test 1-5 on qa (prod = "before" for step 5 only). usage: node t-1495.mjs [contrast,blocked,badges,tip,nav,navother] */
import { chromium, open, settle, sleep, jlog, OUT, version, QA, PROD } from './lib.mjs';
const JOBS = (process.argv[2] ?? 'contrast,blocked,badges,tip,nav,navother').split(',');
const L = jlog(`1495${process.env.SFX ?? ''}.json`);

/* WCAG ratio of an element's text over its real composited ground: every colour is normalised by painting it on a canvas
   (so oklch / color-mix / rgba all come back as sRGB bytes), backgrounds are composited from the root down. */
const CONTRAST = (sels) => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100; };
  const ground = (el, base) => { const chain = []; for (let p = el; p; p = p.parentElement) chain.push(p); let g = base ?? rgba(getComputedStyle(document.documentElement).backgroundColor || '#fff'); if (!base && g[3] < 1) g = over(g, [255, 255, 255, 1]); for (const p of chain.reverse()) { const c = rgba(getComputedStyle(p).backgroundColor); if (c[3] > 0) g = over(c, g); } return g; };
  const out = {};
  for (const s of sels) {
    const els = [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
    if (!els.length) { out[s] = null; continue; }
    const e = els[0]; const cs = getComputedStyle(e); const fg = rgba(cs.color); const bg = ground(e); const txt = over(fg, bg);
    out[s] = { n: els.length, text: e.innerText.trim().slice(0, 30), ratio: ratio(txt, bg), color: cs.color, border: `${cs.borderStyle} ${cs.borderColor}`, fontStyle: cs.fontStyle, cursor: cs.cursor };
  }
  return out;
};
const SP_SELS = ['.strat-aux', '.strat-cap', '.strat-gname', '.strat-notyet-note', '.strat-ro', '.strat-chip.blocked', '.strat-chip.notyet', 'button.strat-chip:not(.blocked):not(.notyet):not(.on)'];
async function panel(page) { const p = page.locator('.strat-chip').first(); await p.waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {}); await p.scrollIntoViewIfNeeded().catch(() => {}); await sleep(600); }

const browser = await chromium.launch();
try {
  L.say({ served: await version() });
  if (JOBS.includes('contrast')) for (const plan of ['free', 'pro']) for (const theme of ['dark', 'light']) {
    const ctx = await open(browser, { plan, theme, settings: { strategy_selection: ['SMA'] } }); const page = await ctx.newPage();
    await page.goto(QA.base + '/arena', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(7000); await panel(page);
    const c = await page.evaluate(CONTRAST, SP_SELS);
    await page.screenshot({ path: `${OUT}/1495-strat-${plan}-${theme}-1280.png` });
    L.say({ job: 'contrast', plan, theme, c });
    await ctx.close();
  }
  if (JOBS.includes('blocked')) for (const theme of ['dark', 'light']) {
    const rec = []; const ctx = await open(browser, { plan: 'free', theme, rec }); const page = await ctx.newPage();
    await page.goto(QA.base + '/arena', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(7000); await panel(page);
    let clicks = 0;
    for (; clicks < 6; clicks++) { if (await page.locator('.strat-chip.blocked').count()) break; const ch = page.locator('button.strat-chip:not(.blocked):not(.notyet):not(.on)').first(); if (!(await ch.count())) break; await ch.click().catch(() => {}); await sleep(700); }
    const info = await page.evaluate(() => {
      const bl = [...document.querySelectorAll('.strat-chip.blocked')];
      const en = [...document.querySelectorAll('button.strat-chip:not(.blocked):not(.notyet)')];
      const d = (e) => ({ text: e.innerText.trim(), lock: !!e.querySelector('.strat-chip-lock'), lockGlyph: e.querySelector('.strat-chip-lock')?.textContent ?? null, lockAriaHidden: e.querySelector('.strat-chip-lock')?.getAttribute('aria-hidden') ?? null, italic: getComputedStyle(e).fontStyle, weight: getComputedStyle(e).fontWeight, ariaDisabled: e.getAttribute('aria-disabled'), disabledAttr: e.hasAttribute('disabled'), tabIndex: e.tabIndex, describedBy: e.getAttribute('aria-describedby') });
      return { on: [...document.querySelectorAll('.strat-chip.on')].map((e) => e.innerText.trim()), blockedCount: bl.length, blocked: bl.slice(0, 4).map(d), blockedAllHaveLock: bl.every((e) => !!e.querySelector('.strat-chip-lock')), blockedAllItalic: bl.every((e) => getComputedStyle(e).fontStyle === 'italic'), blockedAllAriaDisabled: bl.every((e) => e.getAttribute('aria-disabled') === 'true'), enabledSample: en.slice(0, 2).map(d), enabledWithLockOrAriaDisabled: en.filter((e) => e.querySelector('.strat-chip-lock') || e.getAttribute('aria-disabled') === 'true').length };
    });
    // keyboard: focus the first chip and Tab forward until a blocked chip has focus (or 60 presses)
    await page.locator('.strat-chip').first().focus().catch(() => {});
    let tabReached = null; for (let i = 0; i < 60; i++) { await page.keyboard.press('Tab'); const f = await page.evaluate(() => { const a = document.activeElement; return a?.classList?.contains('blocked') ? a.innerText.trim() : null; }); if (f) { tabReached = { presses: i + 1, chip: f }; break; } }
    const role = await page.evaluate(() => { const e = document.querySelector('.strat-chip.blocked'); return e ? { tag: e.tagName, role: e.getAttribute('role'), pressed: e.getAttribute('aria-pressed') } : null; });
    const snap = await page.locator('.strat-chip.blocked').first().evaluate((e) => e.closest('section, .strat-panel, [class*="strat"]')?.className ?? null).catch(() => null);
    await page.locator('.strat-chip.blocked').first().scrollIntoViewIfNeeded().catch(() => {}); await sleep(300);
    await page.screenshot({ path: `${OUT}/1495-blocked-chips-free-${theme}-1280.png` });
    const box = await page.locator('.strat-chip.blocked').first().evaluate((e) => { let p = e.parentElement; for (let i = 0; i < 3 && p?.parentElement; i++) p = p.parentElement; const r = p.getBoundingClientRect(); return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: Math.min(innerWidth, r.width + 16), height: Math.min(innerHeight, r.height + 16) }; }).catch(() => null);
    if (box && box.height > 10) await page.screenshot({ path: `${OUT}/1495-blocked-chips-free-${theme}-zoom.png`, clip: box }).catch(() => {});
    L.say({ job: 'blocked', theme, clicksToLimit: clicks, ...info, tabReached, role, panelClass: snap, patches: rec.filter((x) => x.m !== 'GET').map((x) => `${x.br} ${x.m} ${x.p}`) });
    await ctx.close();
  }
  if (JOBS.includes('badges')) {
    // "Couldn't draw": forced draw failure via the QA hook, BOLL selected (seeded), light theme
    const ctx = await open(browser, { plan: 'pro', theme: 'light', settings: { strategy_selection: ['BOLL'] }, init: { __LHQ_QA_FORCE_CHART_INDICATOR_FAIL__: 'create-null' } }); const page = await ctx.newPage();
    await page.goto(QA.base + '/arena', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(8000);
    let found = await page.waitForFunction(() => [...document.querySelectorAll('div')].some((d) => d.children.length === 0 && /^Couldn.t draw/.test(d.textContent || '')), null, { timeout: 15_000 }).then(() => true).catch(() => false);
    if (!found) { const b = page.locator('button.strat-chip', { hasText: /^BOLL/ }).first(); if (await b.count()) { await b.click().catch(() => {}); found = await page.waitForFunction(() => [...document.querySelectorAll('div')].some((d) => d.children.length === 0 && /^Couldn.t draw/.test(d.textContent || '')), null, { timeout: 15_000 }).then(() => true).catch(() => false); } }
    const m = await page.evaluate(() => {
      const el = [...document.querySelectorAll('div')].find((d) => d.children.length === 0 && /^Couldn.t draw/.test(d.textContent || '')); if (!el) return null;
      el.setAttribute('data-qa-badge', '1'); return { text: el.textContent, color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor };
    });
    const c = m ? await page.evaluate(CONTRAST, ['[data-qa-badge]']) : null;
    const white = m ? await page.evaluate(() => { const el = document.querySelector('[data-qa-badge]'); const parse = (s) => s.match(/[\d.]+/g).map(Number); const [fr, fg, fb, fa = 1] = parse(getComputedStyle(el).color); const [br, bgc, bb, ba = 1] = parse(getComputedStyle(el).backgroundColor); const over = (t, a, b) => t.map((v, i) => v * a + b[i] * (1 - a)); const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }; const pill = over([br, bgc, bb], ba, [255, 255, 255]); const txt = over([fr, fg, fb], fa, pill); const x = lum(txt), y = lum(pill); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100; }) : null;
    await page.locator('[data-qa-badge]').first().scrollIntoViewIfNeeded().catch(() => {}); await sleep(300);
    await page.screenshot({ path: `${OUT}/1495-badge-draw-light-1280.png` });
    L.say({ job: 'badge-couldnt-draw', found, m, contrastRealGround: c, worstCaseWhiteGround: white });
    await ctx.close();
    // Bybit badge: /api/market/klines answered with the REAL body plus X-Data-Source: bybit-fallback (stubbed header)
    const hdr = async (r, req, u) => { if (u.pathname !== '/api/market/klines' || req.method() !== 'GET') return false; const real = await r.fetch(); await r.fulfill({ status: real.status(), contentType: 'application/json', headers: { 'X-Data-Source': 'bybit-fallback', 'Access-Control-Expose-Headers': 'X-Data-Source' }, body: await real.body() }); return true; };
    const ctx2 = await open(browser, { plan: 'pro', theme: 'light', appStub: hdr }); const p2 = await ctx2.newPage();
    await p2.goto(QA.base + '/arena', { waitUntil: 'load', timeout: 120_000 }); await settle(p2); await sleep(9000);
    const m2 = await p2.evaluate(() => { const el = [...document.querySelectorAll('div')].find((d) => d.children.length === 0 && /Bybit \(Binance unreachable\)/.test(d.textContent || '')); if (!el) return null; el.setAttribute('data-qa-badge2', '1'); return { text: el.textContent, color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }; });
    const c2 = m2 ? await p2.evaluate(CONTRAST, ['[data-qa-badge2]']) : null;
    await p2.locator('.klc-wrap').first().scrollIntoViewIfNeeded().catch(() => {}); await sleep(300);
    await p2.screenshot({ path: `${OUT}/1495-badge-bybit-light-1280.png` });
    L.say({ job: 'badge-bybit', m: m2, contrastRealGround: c2 });
    await ctx2.close();
  }
  if (JOBS.includes('tip')) for (const path of ['/hours', '/correlation']) for (const lang of ['en', 'ru']) for (const w of [390, 1440]) {
    if (w === 1440 && lang === 'ru') continue;
    const ctx = await open(browser, { w, lang, ls: lang === 'ru' ? {} : {} }); const page = await ctx.newPage();
    await page.goto(QA.base + path, { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(6000);
    const r = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.lbl.tip-row')]; const res = [];
      for (const row of rows) {
        const kids = [...row.children]; const sub = kids[kids.length - 1]; const tip = kids[0]; if (!sub || sub === tip) continue;
        sub.scrollIntoView({ block: 'center' });
        const b = sub.getBoundingClientRect(), t = tip.getBoundingClientRect();
        const ov = Math.max(0, Math.min(b.right, t.right) - Math.max(b.left, t.left)) * Math.max(0, Math.min(b.bottom, t.bottom) - Math.max(b.top, t.top));
        const I = 2; const pts = [['top', b.left + b.width / 2, b.top + I], ['bottom', b.left + b.width / 2, b.bottom - I], ['left', b.left + I, b.top + b.height / 2], ['right', b.right - I, b.top + b.height / 2], ['centre', b.left + b.width / 2, b.top + b.height / 2]];
        const hits = pts.map(([n, x, y]) => { const e = document.elementFromPoint(x, y); const ctl = e?.closest('a, button, [role=button], [role=link], [role=tab], input, select'); return { n, onSub: !!e && (e === sub || sub.contains(e)), hitControl: ctl ? (ctl.className || ctl.tagName).toString().slice(0, 40) : null, inTip: !!e && tip.contains(e) }; });
        const cs = getComputedStyle(row);
        res.push({ text: sub.textContent.trim().slice(0, 50), rowDisplay: cs.display, flexWrap: cs.flexWrap, columnGap: cs.columnGap, subTop: Math.round(b.top), tipTop: Math.round(t.top), wrapped: Math.round(b.top) > Math.round(t.top) + 4, overlapPx2: Math.round(ov), findings: hits.filter((h) => !h.onSub && (h.hitControl || h.inTip)).map((h) => `${h.n}:${h.hitControl ?? 'tip'}`) });
      }
      return { lang: document.documentElement.lang, rows: res, scrollW: document.documentElement.scrollWidth, vw: innerWidth };
    });
    await page.locator('.lbl.tip-row').first().scrollIntoViewIfNeeded().catch(() => {}); await sleep(300);
    await page.screenshot({ path: `${OUT}/1495-tip${path.replace('/', '-')}-${w}-${lang}.png` });
    L.say({ job: 'tip', path, w, askedLang: lang, ...r });
    await ctx.close();
  }
  if (JOBS.includes('nav')) for (const state of ['signed-out', 'pro', 'trial']) {
    const ctx = await open(browser, { w: 768, h: 900, lang: 'ru', signedIn: state !== 'signed-out', plan: state === 'trial' ? 'trial' : 'pro' }); const page = await ctx.newPage();
    await page.goto(QA.base + '/dashboard', { waitUntil: 'load', timeout: 120_000 }); await settle(page); await sleep(7000);
    const rows = [];
    for (const w of [768, 800, 945, 1000, 1100, 1200, 1279, 1440]) {
      await page.setViewportSize({ width: w, height: 900 }); await sleep(700);
      const m = await page.evaluate(() => { const n = document.querySelector('.tnav'); if (!n) return null; const items = [...n.querySelectorAll('.tnav-item')]; return { lang: document.documentElement.lang, scrollW: n.scrollWidth, clientW: n.clientWidth, fits: n.scrollWidth <= n.clientWidth, first: items[0]?.innerText.trim() ?? null, items: items.length, badge: [...n.querySelectorAll('[class*="badge"], [class*="pill"]')].map((e) => e.innerText.trim()).filter(Boolean).slice(0, 2), pageOverflow: document.documentElement.scrollWidth > innerWidth }; });
      rows.push({ w, ...m });
      if ([768, 1000].includes(w)) await page.screenshot({ path: `${OUT}/1495-nav-ru-${state}-${w}.png`, clip: { x: 0, y: 0, width: w, height: 120 } });
    }
    L.say({ job: 'nav-ru', state, rows });
    await ctx.close();
  }
  if (JOBS.includes('navother')) for (const b of [QA, PROD]) for (const lang of ['en', 'ko', 'zh', 'ru']) {
    if (b === PROD && lang === 'ru') continue;
    const ctx = await open(browser, { b, w: 768, h: 900, lang, signedIn: false }); const page = await ctx.newPage();
    await page.goto(b.base + '/dashboard', { waitUntil: 'load', timeout: 120_000 }); await sleep(6000);
    const rows = [];
    for (const w of [768, 1024, 1279, 1280, 1440]) {
      await page.setViewportSize({ width: w, height: 900 }); await sleep(600);
      rows.push({ w, ...(await page.evaluate(() => { const n = document.querySelector('.tnav'); const it = n?.querySelector('.tnav-item'); const wm = n?.querySelector('.tnav-wordmark'); if (!n || !it) return { none: true }; const a = getComputedStyle(n), i = getComputedStyle(it); return { lang: document.documentElement.lang, gap: a.columnGap, itemPad: `${i.paddingLeft}/${i.paddingRight}`, itemLS: i.letterSpacing, itemFS: i.fontSize, wordmarkLS: wm ? getComputedStyle(wm).letterSpacing : null, scrollW: n.scrollWidth, clientW: n.clientWidth }; })) });
    }
    L.say({ job: 'nav-other', build: b.tag, lang, rows });
    await ctx.close();
  }
} catch (e) { L.say({ crash: String(e).slice(0, 400) }); } finally { await browser.close(); L.save(); }
