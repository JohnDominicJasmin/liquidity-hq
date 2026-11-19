/* #1263 WAITS: L84 / L85 / L86 / L87 / L96 (the strategy panel) and L134 (upsell strings on /arena as Free). Staging, signed in, the paid AI routes fenced, settings writes stubbed (nothing reaches the fixture row). Facts printed as [PN] / [UP] lines; each cell asserts the written target.
 *   PN1 L84  a tap always toggles: with SMA + MACD on, tapping SMA turns it OFF (aria-pressed false) and tapping again turns it ON; the same at 390
 *   PN2 L85  INP: at 390 with a 4x CPU throttle, six taps on indicator chips; the Event Timing duration of each tap (pointerdown to the next paint) and the time to the aria-pressed flip; INP (the worst of six) <= 100 ms
 *   PN3 L86  CLS on a tap: a layout-shift observer that INCLUDES shifts right after input (hadRecentInput is NOT excluded: Chrome's CLS would hide exactly these) across the same six taps: total 0
 *   PN4 L96  panel height: the whole .strat-panel at 360 / 390 / 768 / 1280 (en and ru), with no strategy picked and with one picked (the call box open): <= 560 px at 360 in en and ru; the Run buttons (.strat-actions) inside the first screen at 1280x800 without scrolling
 *   PN5 L87  look: no order numbers in the chip names, a pressed chip has ONE 1 px border and no inset ring, names on one line, chip columns (1280 and 390) and equal row heights
 *   UP1 L134 as the FREE fixture on /arena?coin=hype: the upsell strings (Upgrade, Pro only, See Pro, PRO FEATURE, Unlock with Pro, "- Pro") on ONE screen (1280x800 and 390x844) and on the whole page, listed; baseline 10 (production, 2026-11-17), target 3 or fewer per screen */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

mkdirSync('qa/.shots', { recursive: true });
test.skip(!AUTH_READY, AUTH_SKIP_REASON);

type Open = { who?: 'a' | 'b'; width: number; height: number; loc?: string; chips?: string[]; strategy?: string | null; coin?: string; cpu?: number };
async function open(browser: Browser, o: Open) {
  const ctx = await signedInContext(browser, o.who ?? 'a', { viewport: { width: o.width, height: o.height } });
  await ctx.addInitScript(([l]) => { try { localStorage.setItem('lhq_lang_v1', l as string); localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [o.loc ?? 'en']);
  const page = await ctx.newPage(); await installPaidAiFence(page);
  await page.route(/\/api\/settings(\?|$)/, async (route) => (route.request().method() === 'GET' ? route.fallback() : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: ['arena_strategy', 'strategy_selection'], rejected: [], settings: null }) })));
  const patch: Record<string, unknown> = { arena_sound: false }; if (o.chips) patch.strategy_selection = o.chips; if (o.strategy !== undefined) patch.arena_strategy = o.strategy; if (o.loc && o.loc !== 'en') patch.language = o.loc;
  await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 204, body: '' });
    const res = await route.fetch(); const body = await res.json().catch(() => null); if (body == null) return route.fulfill({ response: res });
    const p = (r: Record<string, unknown>) => ({ ...r, ...patch }); return route.fulfill({ response: res, json: Array.isArray(body) ? body.map(p) : p(body as Record<string, unknown>) });
  });
  if (o.cpu && o.cpu > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: o.cpu }); }
  await gotoSignedIn(page, `/arena?coin=${o.coin ?? 'btc'}&tf=1h`);
  if ((o.who ?? 'a') === 'a') { const sel = page.getByTestId('strategy-set-select').first(); await sel.waitFor({ state: 'visible', timeout: 60_000 }); await expect(sel).toBeEnabled({ timeout: 90_000 }); }
  await page.waitForTimeout(6_000);
  return { ctx, page };
}
const chip = (p: Page, id: string) => p.getByTestId(`strategy-indicator-${id}`);

test('PN1 (L84) a tap always toggles: SMA + MACD on, tap SMA = off, tap again = on (390 and 1280)', async ({ browser }) => {
  test.setTimeout(240_000);
  for (const [w, h] of [[390, 844], [1280, 800]] as const) {
    const { ctx, page } = await open(browser, { width: w, height: h, chips: ['SMA', 'MACD'], strategy: null });
    try {
      expect(await chip(page, 'SMA').getAttribute('aria-pressed'), `${w}: SMA is not on to start`).toBe('true'); expect(await chip(page, 'MACD').getAttribute('aria-pressed')).toBe('true');
      await chip(page, 'SMA').click(); await page.waitForTimeout(800); const off = await chip(page, 'SMA').getAttribute('aria-pressed');
      await chip(page, 'SMA').click(); await page.waitForTimeout(800); const on = await chip(page, 'SMA').getAttribute('aria-pressed');
      console.log(`[PN] PN1 ${w}: tap on an ON chip with 2 on -> aria-pressed ${off}; tap again -> ${on}`);
      expect(off, `${w}: a tap on an on chip (2 indicators on) did not turn it off`).toBe('false'); expect(on, `${w}: the second tap did not turn it back on`).toBe('true');
    } finally { await ctx.close().catch(() => {}); }
  }
});

test('PN2+PN3 (L85, L86) at 390 with a 4x CPU: INP of six chip taps <= 100 ms and CLS across them = 0 (shifts after input counted)', async ({ browser }) => {
  test.setTimeout(300_000);
  const { ctx, page } = await open(browser, { width: 390, height: 844, chips: ['SMA'], strategy: null, cpu: 4 });
  try {
    await page.evaluate(() => {
      const w = window as unknown as { __ev: Array<{ name: string; dur: number; id: string }>; __ls: number[]; __flip: number[] }; w.__ev = []; w.__ls = []; w.__flip = []; (w as unknown as { __lsd: string[] }).__lsd = []; (w as unknown as { __last: string }).__last = '';
      try { new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as Array<{ name: string; duration: number; target?: Element | null; interactionId?: number }>) { const t = e.target as HTMLElement | null; const hit = t && t.closest && t.closest('[data-testid^="strategy-indicator-"]'); if (hit && (e.name === 'pointerdown' || e.name === 'click' || e.name === 'pointerup' || e.name === 'mousedown')) w.__ev.push({ name: e.name, dur: e.duration, id: (hit as HTMLElement).dataset.testid || '' }); } }).observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit); } catch { /* unsupported */ }
      try { new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as Array<{ value: number; startTime: number; hadRecentInput: boolean; sources?: Array<{ node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }> }>) { w.__ls.push(e.value); const d = (n: Node | null) => { const el = n && n.nodeType === 1 ? (n as HTMLElement) : (n && n.parentElement) || null; if (!el) return '(gone)'; const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).slice(0, 2).join('.'); return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${el.dataset && el.dataset.testid ? '[' + el.dataset.testid + ']' : ''} "${(el.innerText || '').replace(/\s+/g, ' ').slice(0, 24)}"`; }; const rc = (r: DOMRectReadOnly) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}`; (w as unknown as { __lsd: string[] }).__lsd.push(`+${e.value.toFixed(4)} at ${Math.round(e.startTime)}ms input=${e.hadRecentInput} after tap ${(w as unknown as { __last: string }).__last}: ` + (e.sources || []).slice(0, 4).map((x) => `${d(x.node)} [${rc(x.previousRect)}]->[${rc(x.currentRect)}]`).join(' | ')); } }).observe({ type: 'layout-shift', buffered: false }); } catch { /* unsupported */ }
      document.addEventListener('pointerdown', (ev) => { const b = (ev.target as HTMLElement).closest?.('[data-testid^="strategy-indicator-"]') as HTMLElement | null; if (!b) return; (window as unknown as { __last: string }).__last = (b.dataset.testid || '').replace('strategy-indicator-', ''); const t0 = performance.now(); const was = b.getAttribute('aria-pressed'); const mo = new MutationObserver(() => { if (b.getAttribute('aria-pressed') !== was) { w.__flip.push(performance.now() - t0); mo.disconnect(); } }); mo.observe(b, { attributes: true, attributeFilter: ['aria-pressed'] }); setTimeout(() => mo.disconnect(), 3000); }, true);
    });
    const ids = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="strategy-indicator-"]')).map((e) => (e as HTMLElement).dataset.testid!.replace('strategy-indicator-', '')));
    expect(ids.length, 'no indicator chips found').toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 6; i++) { const id = ids[i % ids.length]; await chip(page, id).click(); await page.waitForTimeout(900); }
    await page.waitForTimeout(1_500);
    const r = await page.evaluate(() => { const w = window as unknown as { __ev: Array<{ name: string; dur: number; id: string }>; __ls: number[]; __flip: number[] }; return { ev: w.__ev, ls: w.__ls, flip: w.__flip, lsd: (w as unknown as { __lsd: string[] }).__lsd }; });
    const worst = r.ev.length ? Math.max(...r.ev.map((e) => e.dur)) : 0; const cls = r.ls.reduce((a, b) => a + b, 0);
    console.log(`[PN] PN2 events over 16 ms: ${JSON.stringify(r.ev.map((e) => `${e.id.replace('strategy-indicator-', '')}:${e.name}:${Math.round(e.dur)}`))} · worst ${Math.round(worst)} ms (no entry = every tap's input-to-paint was under 16 ms) · aria-pressed flip after pointerdown: ${JSON.stringify(r.flip.map((x) => Math.round(x)))} ms`);
    console.log(`[PN] PN3 layout shifts across six taps (input shifts counted): ${JSON.stringify(r.ls.map((x) => +x.toFixed(4)))} total ${cls.toFixed(4)}`);
    for (const x of r.lsd) console.log(`[PN] PN3 shift ${x}`);
    await page.screenshot({ path: 'qa/.shots/pn-390-after-taps.png' }).catch(() => {});
    expect(worst, `INP of a chip tap at 4x CPU: ${Math.round(worst)} ms (target <= 100)`).toBeLessThanOrEqual(100);
    for (const f of r.flip) expect(f, `an aria-pressed flip took ${Math.round(f)} ms after pointerdown`).toBeLessThanOrEqual(100);
    expect(cls, `layout shift across six taps: ${cls.toFixed(4)} (target 0)`).toBeLessThanOrEqual(0.001);
  } finally { await ctx.close().catch(() => {}); }
});

test('PN4 (L96) panel height <= 560 px at 360 in en and ru, and the Run buttons inside the first screen at 1280x800', async ({ browser }) => {
  test.setTimeout(480_000); const rows: string[] = []; const fails: string[] = [];
  for (const [w, h, loc, strategy] of [[360, 800, 'en', null], [360, 800, 'en', 'ema_stack'], [360, 800, 'ru', null], [360, 800, 'ru', 'ema_stack'], [390, 844, 'en', 'ema_stack'], [768, 900, 'en', 'ema_stack'], [1280, 800, 'en', null], [1280, 800, 'en', 'ema_stack'], [1280, 800, 'ru', 'ema_stack']] as const) {
    const { ctx, page } = await open(browser, { width: w, height: h, loc, chips: ['SMA'], strategy });
    try {
      const m = await page.evaluate(() => { const p = document.querySelector('.strat-panel') as HTMLElement | null; const a = document.querySelector('.strat-actions') as HTMLElement | null; const pr = p?.getBoundingClientRect(), ar = a?.getBoundingClientRect(); return { h: pr ? Math.round(pr.height) : null, w: pr ? Math.round(pr.width) : null, top: pr ? Math.round(pr.top + window.scrollY) : null, runTop: ar ? Math.round(ar.top) : null, runBottom: ar ? Math.round(ar.bottom) : null, vh: window.innerHeight, scrollY: Math.round(window.scrollY) }; });
      const label = `${w}x${h} ${loc} ${strategy ?? 'no strategy'}`; rows.push(`${label}: panel ${m.h} px high, ${m.w} wide, top ${m.top}; Run row ${m.runTop}-${m.runBottom} of ${m.vh}`);
      if (w === 360 && m.h != null && m.h > 560) fails.push(`${label}: ${m.h} px > 560`);
      if (w === 1280 && m.runBottom != null && m.runBottom > h) fails.push(`${label}: the Run buttons end at ${m.runBottom} px, below the ${h} px screen`);
      if (m.h == null) fails.push(`${label}: no .strat-panel found`);
      await page.screenshot({ path: `qa/.shots/pn-panel-${w}-${loc}-${strategy ?? 'none'}.png` }).catch(() => {});
    } finally { await ctx.close().catch(() => {}); }
  }
  console.log(`[PN] PN4 ${rows.join(' | ')}`);
  expect(fails, fails.join(' ; ')).toEqual([]);
});

test('PN5 (L87) look: no order numbers, one 1 px border when on, names on one line, columns and equal row heights', async ({ browser }) => {
  test.setTimeout(300_000); const fails: string[] = [];
  for (const [w, h] of [[390, 844], [1280, 800]] as const) {
    const { ctx, page } = await open(browser, { width: w, height: h, chips: ['SMA', 'MACD'], strategy: null });
    try {
      const m = await page.evaluate(() => {
        const cs = Array.from(document.querySelectorAll('[data-testid^="strategy-indicator-"]')) as HTMLElement[];
        return cs.map((c) => { const n = c.querySelector('.strat-ind-name') as HTMLElement | null; const r = c.getBoundingClientRect(); const s = getComputedStyle(c); const nr = n?.getBoundingClientRect(); return { id: c.dataset.testid!.replace('strategy-indicator-', ''), text: (c.innerText || '').replace(/\s+/g, ' ').trim(), on: c.getAttribute('aria-pressed') === 'true', left: Math.round(r.left), top: Math.round(r.top), h: Math.round(r.height), bw: s.borderTopWidth, bs: s.borderTopStyle, shadow: s.boxShadow, outline: s.outlineStyle, nameH: nr ? Math.round(nr.height) : 0, nameLH: n ? parseFloat(getComputedStyle(n).lineHeight) || 0 : 0, nameClip: n ? n.scrollWidth > n.clientWidth + 1 : false }; });
      });
      const cols = new Set(m.map((x) => x.left)).size, hs = new Set(m.map((x) => x.h)); const label = `${w}`;
      console.log(`[PN] PN5 ${label}: ${m.length} chips, ${cols} column(s), row heights ${JSON.stringify([...hs])}; ${m.map((x) => `${x.id}[${x.on ? 'on' : 'off'} "${x.text}" border ${x.bw} ${x.bs} shadow ${x.shadow === 'none' ? 'none' : x.shadow.slice(0, 40)} name ${x.nameH}/${x.nameLH}${x.nameClip ? ' CLIPPED' : ''}]`).join(' ')}`);
      for (const x of m) {
        if (/^\d/.test(x.text)) fails.push(`${label} ${x.id}: starts with an order number: "${x.text}"`);
        if (x.on && x.bw !== '1px') fails.push(`${label} ${x.id}: a pressed chip has a ${x.bw} border (want 1px)`); if (x.on && x.shadow !== 'none') fails.push(`${label} ${x.id}: a pressed chip has an inset ring / shadow: ${x.shadow}`);
        if (x.nameLH && x.nameH > x.nameLH * 1.5) fails.push(`${label} ${x.id}: the name wraps (${x.nameH} px on a ${x.nameLH} px line)`); if (x.nameClip) fails.push(`${label} ${x.id}: the name is clipped`);
      }
      if (hs.size > 1) fails.push(`${label}: unequal chip heights ${JSON.stringify([...hs])}`);
      await page.screenshot({ path: `qa/.shots/pn-chips-${w}.png` }).catch(() => {});
    } finally { await ctx.close().catch(() => {}); }
  }
  expect(fails, fails.join(' ; ')).toEqual([]);
});

test('UP1 (L134) upsell strings on /arena as Free, HYPE: per screen and whole page, listed (baseline 10, target 3 or fewer)', async ({ browser }) => {
  test.setTimeout(300_000); const fails: string[] = [];
  for (const [w, h] of [[1280, 800], [390, 844]] as const) {
    const { ctx, page } = await open(browser, { who: 'b', width: w, height: h, coin: 'hype' });
    try {
      const m = await page.evaluate(() => {
        const RX = /(upgrade|pro only|see pro|pro feature|unlock with pro|[·\-] ?pro\b|^pro$)/i; const vh = window.innerHeight; const out: Array<{ text: string; inScreen: boolean; tag: string }> = [];
        for (const el of Array.from(document.querySelectorAll('body *')) as HTMLElement[]) {
          const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => (n.textContent || '').trim()).join(' ').trim(); if (!own || own.length > 160 || !RX.test(own)) continue;
          const r = el.getBoundingClientRect(); const st = getComputedStyle(el); if (r.width === 0 || r.height === 0 || st.visibility === 'hidden' || st.display === 'none') continue;
          out.push({ text: own, inScreen: r.top < vh && r.bottom > 0, tag: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/)[0] : '') });
        }
        return out;
      });
      const screen = m.filter((x) => x.inScreen), all = m;
      console.log(`[UP] UP1 ${w}x${h} Free HYPE: ${screen.length} on the first screen, ${all.length} on the whole page`); for (const x of screen) console.log(`[UP]   screen: "${x.text.slice(0, 80)}" (${x.tag})`); for (const x of all.filter((y) => !y.inScreen)) console.log(`[UP]   below: "${x.text.slice(0, 80)}" (${x.tag})`);
      await page.screenshot({ path: `qa/.shots/up-free-hype-${w}.png` }).catch(() => {});
      if (screen.length > 3) fails.push(`${w}x${h}: ${screen.length} upsell strings on the first screen (target 3 or fewer; baseline 10)`);
    } finally { await ctx.close().catch(() => {}); }
  }
  expect(fails, fails.join(' ; ')).toEqual([]);
});
