/* #1185: BROWSER CELLS FOR THE BOXES DEV'S MERGED PRs CLAIM TO FIX (Dev's list, issue comment 7011180391; PRs #2662 #2656 #2651 #2649 #2652 #2650 #2647 #2648).
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/verify-1185-merged.spec.ts -f base_url=<dev|qa|staging site> -f project=desktop
 * Each cell is titled V<n> and prints a `[V] Vn ...` evidence line. Assertions are the BOX'S written target, not whatever the page does today.
 * Nothing here writes to a shared database (settings writes are answered locally), nothing calls AI (the paid-AI fence is installed first on every page) and no real credential is typed.
 * Signed-in cells skip when the fixtures are absent. /news is served from a synthetic news read (see _v1185.ts), because the non-prod news table is empty. */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY, AUTH_SKIP_REASON, SUPABASE_URL, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';
import { gotoGuarded, chip, entitlementsUnresolved } from './_shared';
import {
  signedOutContext, openPage, stubSettingsWrites, installNewsFixture, contrastProbe, NEWS_FX,
  type Theme, type NamedSpec,
} from './_v1185';

mkdirSync('qa/.shots', { recursive: true });
const V = (id: string, msg: string) => console.log(`[V] ${id} ${msg}`);

test.beforeEach(({ }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'viewports are set per cell');
});

/* ================================ V1 Russian trial banner (#2662) ================================ */
for (const w of [360, 390]) {
  test(`V1 Russian trial banner at ${w}: at most two text lines`, async ({ browser }) => {
    test.skip(!AUTH_READY, AUTH_SKIP_REASON);
    test.setTimeout(150_000);
    const ctx = await signedInContext(browser, 'b', { viewport: { width: w, height: 800 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'ru'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.removeItem('lhq_trial_banner_dismissed'); } catch { /* private */ } });
    const page = await openPage(ctx);
    try {
      /* A trial: the free fixture with a trial end ten days out (not inside the last 3 days, where the dismiss x is dropped). Same read-only stub as plan-badge-trial-flip.spec.ts. */
      await page.route(`${SUPABASE_URL}/rest/v1/**`, async (route) => {
        if (!/user_subscriptions/.test(route.request().url())) return route.fallback();
        const row = { role: 'free', trial_ends_at: new Date(Date.now() + 10 * 864e5).toISOString() };
        const single = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object');
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(single ? row : [row]) });
      });
      /* The saved language is the account's, so the READ is patched to ru (the cls-arena-gate IN-RU pattern); nothing is written. */
      await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => {
        if (route.request().method() !== 'GET') return route.fulfill({ status: 204, body: '' });
        const res = await route.fetch(); const body = await res.json().catch(() => null);
        if (body == null) return route.fulfill({ response: res });
        const patch = (r: Record<string, unknown>) => ({ ...r, language: 'ru' });
        return route.fulfill({ response: res, json: Array.isArray(body) ? body.map(patch) : patch(body as Record<string, unknown>) });
      });
      await gotoSignedIn(page, '/dashboard');
      await page.waitForSelector('.trial-banner', { state: 'visible', timeout: 30_000 }).catch(() => { throw new Error('the trial banner never rendered: the trial stub did not reach the app (cannot measure the Russian copy)'); });
      await page.waitForTimeout(1500);
      const m = await page.evaluate(() => {
        const b = document.querySelector('.trial-banner') as HTMLElement;
        const block = b.firstElementChild as HTMLElement;
        const tops: number[] = [];
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!(n.textContent || '').trim()) continue;
          const r = document.createRange(); r.selectNodeContents(n);
          for (const q of Array.from(r.getClientRects())) if (q.width > 0 && q.height > 0) tops.push(Math.round(q.top));
        }
        tops.sort((a, b2) => a - b2);
        let lines = 0; let last = -1e9;
        for (const t of tops) if (t - last > 6) { lines++; last = t; }
        return { lines, blockH: Math.round(block.getBoundingClientRect().height * 10) / 10, bannerH: Math.round(b.getBoundingClientRect().height * 10) / 10, text: (block.textContent || '').replace(/\s+/g, ' ').trim(), scrollW: b.scrollWidth, clientW: b.clientWidth };
      });
      V('V1', `ru trial banner at ${w}: ${m.lines} text line(s) · text block ${m.blockH}px · banner ${m.bannerH}px (the pill is 44px, so the banner cannot drop below ~62px) · "${m.text}" · sideways overflow ${m.scrollW - m.clientW}px`);
      await page.screenshot({ path: `qa/.shots/v1-trial-ru-${w}.png` }).catch(() => {});
      expect(/[Ѐ-ӿ]/.test(m.text), `the banner is not in Russian ("${m.text}"): the language did not take, so nothing here measures the Russian copy`).toBe(true);
      expect(m.lines, `Russian trial banner at ${w} is ${m.lines} text lines (box target: 2 or fewer): "${m.text}"`).toBeLessThanOrEqual(2);
      expect(m.blockH, `the banner's text block is ${m.blockH}px high (the 3-line block measured 62px)`).toBeLessThan(62);
    } finally { await ctx.close().catch(() => {}); }
  });
}

/* ================================ V2 News hero (#2656) ================================ */
test('V2 News hero: a text card above 540px, an 88px thumbnail up to it, headlines above the fold', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await signedOutContext(browser, { width: 390 });
  const page = await openPage(ctx);
  await installNewsFixture(page);
  try {
    await gotoGuarded(page, '/news');
    await page.waitForSelector('.ncard-grid', { state: 'attached', timeout: 40_000 });
    if ((await page.locator('.ncard-grid-hero').count()) === 0) await page.locator('.ntab-btn').nth(2).click();
    await page.waitForSelector('.ncard-grid-hero', { state: 'attached', timeout: 20_000 });
    const rows: string[] = []; const bad: string[] = [];
    for (const w of [390, 540, 541, 768, 1280]) {
      await page.setViewportSize({ width: w, height: w <= 540 ? 844 : w === 768 ? 1024 : 900 });
      await page.waitForTimeout(600);
      const m = await page.evaluate(() => {
        const wrap = document.querySelector('.ncard-grid-hero .ncard-grid-img-wrap') as HTMLElement | null;
        const h = document.querySelector('.ncard-grid-headline') as HTMLElement | null;
        return { display: wrap ? getComputedStyle(wrap).display : 'absent', w: wrap ? Math.round(wrap.getBoundingClientRect().width) : 0, headTop: h ? Math.round(h.getBoundingClientRect().top + window.scrollY) : -1 };
      });
      rows.push(`${w}px: hero image wrapper display ${m.display} width ${m.w} · first headline top ${m.headTop}`);
      if (w >= 541 && m.display !== 'none') bad.push(`${w}px: the hero image wrapper is ${m.display} (target: display none from 541 up)`);
      if (w <= 540 && (m.display === 'none' || m.display === 'absent' || m.w < 80 || m.w > 96)) bad.push(`${w}px: the phone thumbnail is ${m.display} ${m.w}px wide (target: visible, about 88px)`);
      if (w >= 768 && !(m.headTop >= 0 && m.headTop < 600)) bad.push(`${w}px: the first headline is at y=${m.headTop} (target: above 600)`);
      if (w === 390 || w === 1280) await page.screenshot({ path: `qa/.shots/v2-news-${w}.png` }).catch(() => {});
    }
    V('V2', rows.join(' | '));
    expect(bad, bad.join('\n')).toEqual([]);
  } finally { await ctx.close().catch(() => {}); }
});

/* ================================ V3 Offline notice (#2651) ================================ */
const live = (page: Page) => page.evaluate(() => {
  const r = document.querySelector('[data-testid="offline-notice-region"]');
  return r ? { role: r.getAttribute('role'), text: (r.textContent || '').trim() } : null;
});
async function pollText(page: Page, want: 'text' | 'empty', ms: number): Promise<number | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await live(page);
    if (s && (want === 'text' ? s.text !== '' : s.text === '')) return Date.now() - t0;
    await page.waitForTimeout(250);
  }
  return null;
}
for (const [path, w] of [['/markets', 1280], ['/news', 1280], ['/arena?coin=btc&tf=1h', 390]] as const) {
  test(`V3 Offline notice on ${path.split('?')[0]} at ${w}: announced, named, clears on return`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await signedOutContext(browser, { width: w });
    const page = await openPage(ctx);
    try {
      await gotoGuarded(page, path);
      await page.waitForSelector('[data-testid="offline-notice-region"]', { state: 'attached', timeout: 40_000 });
      if (path.startsWith('/arena')) await page.waitForSelector('.klc-toolbar', { state: 'visible', timeout: 40_000 });
      await page.waitForTimeout(3000);
      const before = await live(page);
      await ctx.setOffline(true);
      let appeared = await pollText(page, 'text', 4_000); let harness = '';
      if (appeared == null) { harness += ' [offline event dispatched by the harness]'; await page.evaluate(() => window.dispatchEvent(new Event('offline'))); appeared = await pollText(page, 'text', 4_000); }
      await page.waitForTimeout(Math.max(0, 8_000 - (appeared ?? 0)));
      const during = await live(page);
      const geo = await page.evaluate(() => {
        const n = document.querySelector('[data-testid="offline-notice"]') as HTMLElement | null;
        const rect = (e: Element | null) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
        const a = rect(n); const hit = (sel: string) => { const b = rect(document.querySelector(sel)); if (!a || !b) return null; const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)); const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)); return Math.round(ox * oy); };
        return { shown: !!n && getComputedStyle(n).display !== 'none' && (a?.w ?? 0) > 0, toolbar: hit('.klc-toolbar'), launcher: hit('[data-testid="grok-launcher"]'), a };
      });
      if (path.startsWith('/arena')) await page.screenshot({ path: 'qa/.shots/v3-offline-arena-390.png' }).catch(() => {});
      await ctx.setOffline(false);
      let cleared = await pollText(page, 'empty', 4_000);
      if (cleared == null) { harness += ' [online event dispatched by the harness]'; await page.evaluate(() => window.dispatchEvent(new Event('online'))); cleared = await pollText(page, 'empty', 6_000); }
      V('V3', `${path} ${w}: region before ${JSON.stringify(before)} · text after ${appeared} ms: "${during?.text}" · shown ${geo.shown} · overlap with chart toolbar ${geo.toolbar} px2, with Ask AI launcher ${geo.launcher} px2 · cleared after ${cleared} ms${harness}`);
      expect(before, 'no role=status live region existed before going offline (a region created with its text is not announced)').not.toBeNull();
      expect(before!.role).toBe('status');
      expect(before!.text, 'the live region already had text before going offline').toBe('');
      expect(during?.text ?? '', 'offline for 8 s and the live region is still empty').not.toBe('');
      expect(geo.shown, 'the offline notice element is not visible').toBe(true);
      if (path.startsWith('/arena')) {
        expect(geo.toolbar, 'the offline notice covers the chart toolbar at 390').toBe(0);
        expect(geo.launcher ?? 0, 'the offline notice covers the Ask AI launcher at 390').toBe(0);
      }
      expect(cleared, 'the notice text did not disappear after the network returned').not.toBeNull();
    } finally { await ctx.setOffline(false).catch(() => {}); await ctx.close().catch(() => {}); }
  });
}

/* ================================ V4 Arena keyboard and tabindex (#2649) ================================ */
test('V4 Arena keyboard: no positive tabindex, and 63 Tab presses reach at least 25 distinct elements', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await signedOutContext(browser, { width: 1280 });
  const page = await openPage(ctx);
  const positive = () => page.evaluate(() => Array.from(document.querySelectorAll('[tabindex]')).filter((e) => parseInt(e.getAttribute('tabindex') || '0', 10) > 0).map((e) => `${e.tagName.toLowerCase()}${typeof (e as HTMLElement).className === 'string' && (e as HTMLElement).className ? '.' + (e as HTMLElement).className.trim().split(/\s+/)[0] : ''}[tabindex=${e.getAttribute('tabindex')}]`));
  try {
    await gotoGuarded(page, '/arena?coin=btc');
    await page.waitForSelector('.klc-wrap', { state: 'attached', timeout: 60_000 });
    await page.waitForTimeout(8_000);
    const posBefore = await positive();
    const seen = new Set<string>(); const order: string[] = [];
    for (let i = 0; i < 63; i++) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return 'body';
        let k = el.getAttribute('data-qa-focus');
        if (!k) { const w = window as unknown as { __qaf?: number }; w.__qaf = (w.__qaf ?? 0) + 1; k = String(w.__qaf); el.setAttribute('data-qa-focus', k); }
        return `${k}:${el.tagName.toLowerCase()}${(el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 18)}`;
      });
      seen.add(id.split(':')[0]); if (i < 12) order.push(id);
    }
    const posAfter = await positive();
    V('V4', `/arena signed out: tabindex>0 before ${JSON.stringify(posBefore)} after ${JSON.stringify(posAfter)} · 63 Tab presses visited ${seen.size} distinct elements (the box measured 9) · first twelve ${JSON.stringify(order)}`);
    expect(posBefore, 'elements with tabindex > 0 after the chart mounted').toEqual([]);
    expect(posAfter, 'elements with tabindex > 0 after tabbing through the page').toEqual([]);
    expect(seen.size, `63 Tab presses visited only ${seen.size} distinct elements (target: at least 25; the box measured 9)`).toBeGreaterThanOrEqual(25);
  } finally { await ctx.close().catch(() => {}); }
});

/* The three scroll areas the box names: the landing price ticker, the /funding regime list, the /correlation grid. */
for (const [name, path, sel] of [['landing price ticker', '/', '.lpt-ticker'], ['/funding regime list', '/funding', '.frh-list-scroll'], ['/correlation grid', '/correlation', '.corr-grid-wrap']] as const) {
  test(`V4 scroll area keyboard-reachable and named: ${name}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await signedOutContext(browser, { width: 1280 });
    const page = await openPage(ctx);
    try {
      await gotoGuarded(page, path);
      await page.waitForSelector(sel, { state: 'attached', timeout: 60_000 }).catch(() => { throw new Error(`UNMEASURED: ${sel} never rendered on ${path} (data-dependent element); nothing here is a finding about the fix`); });
      const m = await page.evaluate((s) => {
        const el = document.querySelector(s) as HTMLElement;
        el.focus();
        const lb = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map((i) => document.getElementById(i)?.textContent || '').join(' ').trim();
        return { tabindex: el.getAttribute('tabindex'), role: el.getAttribute('role'), name: (el.getAttribute('aria-label') || lb).trim(), focused: document.activeElement === el, scrolls: el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight };
      }, sel);
      V('V4', `${name} (${sel}): tabindex ${m.tabindex} role ${m.role} name "${m.name}" focus() took ${m.focused} · currently scrolls ${m.scrolls}`);
      expect(m.focused, `${sel} cannot take keyboard focus`).toBe(true);
      expect(m.tabindex, `${sel} is not in the tab order`).toBe('0');
      expect(m.name, `${sel} has no accessible name`).not.toBe('');
    } finally { await ctx.close().catch(() => {}); }
  });
}

/* ================================ V5 Tap targets at 390 (#2649 / #2652) ================================ */
const small = (page: Page, sel: string) => page.evaluate((s) => Array.from(document.querySelectorAll(s)).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map((e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, label: (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30) }; }), sel);
for (const path of ['/news', '/dashboard', '/markets']) {
  test(`V5 Tap targets at 390 on ${path}: the news ticker pause and hide buttons are at least 24x24`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await signedOutContext(browser, { width: 390 });
    const page = await openPage(ctx);
    await installNewsFixture(page);
    try {
      await gotoGuarded(page, path);
      await page.waitForSelector('.news-ticker .ticker-close', { state: 'visible', timeout: 40_000 }).catch(() => { throw new Error(`UNMEASURED: the news ticker never showed on ${path} even with the fixture feed`); });
      await page.waitForTimeout(1500);
      const b = await small(page, '.news-ticker .ticker-close');
      V('V5', `${path} 390: ticker buttons ${JSON.stringify(b)}`);
      const under = b.filter((x) => x.w < 24 || x.h < 24);
      expect(b.length, 'the pause and hide buttons were not both found').toBeGreaterThanOrEqual(2);
      expect(under, `ticker controls under 24x24 at 390: ${JSON.stringify(under)}`).toEqual([]);
    } finally { await ctx.close().catch(() => {}); }
  });
}

test('V5 Tap targets at 390 on /news: headline links give a tap area of at least 24px', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await signedOutContext(browser, { width: 390 });
  const page = await openPage(ctx);
  await installNewsFixture(page);
  try {
    await gotoGuarded(page, '/news');
    await page.waitForSelector('a.ncard-headline-link', { state: 'visible', timeout: 40_000 });
    await page.waitForTimeout(1500);
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('a.ncard-headline-link')).slice(0, 5).map((a) => {
      (a as HTMLElement).scrollIntoView({ block: 'center' });
      const r = a.getBoundingClientRect(); const card = a.closest('article') as HTMLElement; const c = card.getBoundingClientRect();
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = Math.max(0, c.top); y < Math.min(innerHeight, c.bottom); y += 4) for (let x = Math.max(0, c.left); x < Math.min(innerWidth, c.right); x += 4) {
        const h = document.elementFromPoint(x, y); if (h && (h === a || a.contains(h))) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      }
      return { raw: `${Math.round(r.width)}x${Math.round(r.height)}`, hitW: x1 < 0 ? 0 : x1 - x0 + 4, hitH: y1 < 0 ? 0 : y1 - y0 + 4 };
    }));
    V('V5', `/news 390 headline links (anchor box raw, then the area that actually takes the tap): ${JSON.stringify(rows)}`);
    expect(rows.length).toBeGreaterThan(0);
    const bad = rows.filter((r) => r.hitW < 24 || r.hitH < 24);
    expect(bad, `headline links whose tap area is under 24px (the box measured 17px tall): ${JSON.stringify(bad)}`).toEqual([]);
  } finally { await ctx.close().catch(() => {}); }
});

test('V5 Tap targets at 390 on the landing page: language button and menu items are at least 24x24', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await signedOutContext(browser, { width: 390 });
  const page = await openPage(ctx);
  try {
    await gotoGuarded(page, '/');
    await page.waitForSelector('.lp-lang-btn', { state: 'visible', timeout: 40_000 });
    const btn = await small(page, '.lp-lang-btn');
    /* a click before the page hydrated opens nothing: retry the click until the menu shows (up to 6 tries, 3 s each) */
    for (let k = 0; k < 6; k++) { await page.locator('.lp-lang-btn').click(); if (await page.waitForSelector('.lp-lang-menu a', { state: 'visible', timeout: 3_000 }).then(() => true, () => false)) break; await page.waitForTimeout(1_000); }
    await page.waitForSelector('.lp-lang-menu a', { state: 'visible', timeout: 5_000 });
    const items = await small(page, '.lp-lang-menu a');
    V('V5', `/ 390: language button ${JSON.stringify(btn)} · menu items ${JSON.stringify(items)}`);
    const under = [...btn, ...items].filter((x) => x.w < 24 || x.h < 24);
    expect(items.length, 'the language menu showed no items').toBeGreaterThan(0);
    expect(under, `landing language controls under 24x24: ${JSON.stringify(under)}`).toEqual([]);
  } finally { await ctx.close().catch(() => {}); }
});

test('V5 Tap targets at 390 on /help: the FAQ link is at least 24x24', async ({ browser }) => {
  const ctx = await signedOutContext(browser, { width: 390 });
  const page = await openPage(ctx);
  try {
    await gotoGuarded(page, '/help');
    await page.waitForSelector('a[href="/faq"]', { state: 'attached', timeout: 40_000 });
    const b = await small(page, 'a[href="/faq"]');
    V('V5', `/help 390: FAQ links ${JSON.stringify(b)}`);
    expect(b.length, 'no visible FAQ link on /help').toBeGreaterThan(0);
    expect(b.filter((x) => x.w < 24 || x.h < 24), `FAQ link under 24x24: ${JSON.stringify(b)}`).toEqual([]);
  } finally { await ctx.close().catch(() => {}); }
});

/* ================================ V6 Language menu (#2649) ================================ */
for (const [name, path, btn, item, cur] of [
  ['landing switcher', '/', '.lp-lang-btn', '.lp-lang-menu a', '.lp-lang-menu a[aria-current]'],
  ['nav switcher', '/news', '.lang-nav-btn', '.lang-nav-item', '.lang-nav-item[aria-current]'],
] as const) {
  test(`V6 Language menu, ${name}: Escape closes it and returns focus, one item is current`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await signedOutContext(browser, { width: 1280 });
    const page = await openPage(ctx);
    try {
      await gotoGuarded(page, path);
      await page.waitForSelector(btn, { state: 'visible', timeout: 40_000 });
      /* a click before the page hydrated opens nothing: retry the click until the menu shows (up to 6 tries, 3 s each) */
      for (let k = 0; k < 6; k++) { await page.locator(btn).first().click(); if (await page.waitForSelector(item, { state: 'visible', timeout: 3_000 }).then(() => true, () => false)) break; await page.waitForTimeout(1_000); }
      await page.waitForSelector(item, { state: 'visible', timeout: 5_000 });
      const current = await page.locator(cur).count();
      await page.evaluate((s) => (document.querySelector(s) as HTMLElement).focus(), item);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const after = await page.evaluate(([b, i]) => ({ onButton: document.activeElement === document.querySelector(b), menuItems: Array.from(document.querySelectorAll(i)).filter((e) => e.getBoundingClientRect().width > 0).length, expanded: document.querySelector(b)?.getAttribute('aria-expanded') }), [btn, item]);
      V('V6', `${name} ${path}: aria-current items ${current} · after Escape focus on the button ${after.onButton}, visible menu items ${after.menuItems}, aria-expanded ${after.expanded}`);
      expect(current, 'exactly one language item must carry aria-current').toBe(1);
      expect(after.menuItems, 'the menu is still open after Escape').toBe(0);
      expect(after.onButton, 'focus did not return to the menu button after Escape').toBe(true);
    } finally { await ctx.close().catch(() => {}); }
  });
}

/* ================================ V7 Auth errors (#2649) ================================ */
const BAD_EMAIL = 'qa-v1185-nobody@example.invalid';
async function authShape(page: Page, errSel: string, inputs: string[]) {
  return page.evaluate(([e, ins]) => {
    const err = document.querySelector(e) as HTMLElement | null;
    return { present: !!err, role: err?.getAttribute('role') ?? null, text: (err?.textContent || '').trim(), id: err?.id ?? '', inputs: (ins as string[]).map((s) => { const el = document.querySelector(s); return { sel: s, invalid: el?.getAttribute('aria-invalid') ?? null, describedby: el?.getAttribute('aria-describedby') ?? null }; }) };
  }, [errSel, inputs] as [string, string[]]);
}
test('V7 Auth errors on /login (password): the alert exists empty first, then the fields are invalid and described by it', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await signedOutContext(browser, { width: 1280 });
  const page = await openPage(ctx);
  try {
    await gotoGuarded(page, '/login');
    await page.waitForSelector('[data-testid="login-email"]', { state: 'visible', timeout: 40_000 });
    await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /use password/i.test(x.textContent || '')); (b as HTMLElement | undefined)?.click(); });
    await page.waitForSelector('input[type=password]', { state: 'visible', timeout: 20_000 });
    const ins = ['#pw-email', 'input[type=password]'];
    const before = await authShape(page, '#pw-error', ins);
    await page.fill('#pw-email', BAD_EMAIL); await page.fill('input[type=password]', 'not-a-real-password-1');
    await page.press('input[type=password]', 'Enter'); /* Enter reaches the handler even while the button waits for the captcha (a11y-auth.spec U5) */
    await page.waitForFunction(() => ((document.querySelector('#pw-error') as HTMLElement | null)?.textContent || '').trim() !== '', undefined, { timeout: 25_000 }).catch(() => {});
    const after = await authShape(page, '#pw-error', ins);
    V('V7', `/login password: before ${JSON.stringify(before)} · after ${JSON.stringify(after)}`);
    expect(before.present && before.role === 'alert' && before.text === '', 'the role=alert container must exist and be empty BEFORE the error').toBe(true);
    expect(after.text, 'no error text appeared after the failed attempt (cannot verify the linking)').not.toBe('');
    for (const i of after.inputs) { expect(i.invalid, `${i.sel} has no aria-invalid after the failure`).toBe('true'); expect(i.describedby, `${i.sel} is not linked to the error`).toContain(after.id); }
  } finally { await ctx.close().catch(() => {}); }
});
test('V7 Auth errors on /forgot-password: same shape (a filled invalid email; an empty submit returns silently by design)', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await signedOutContext(browser, { width: 1280 });
  const page = await openPage(ctx);
  try {
    await gotoGuarded(page, '/forgot-password');
    await page.waitForSelector('[data-testid="login-email"]', { state: 'visible', timeout: 40_000 });
    const ins = ['[data-testid="login-email"]'];
    const before = await authShape(page, '#forgot-error', ins);
    await page.fill('[data-testid="login-email"]', BAD_EMAIL);
    await page.press('[data-testid="login-email"]', 'Enter');
    await page.waitForFunction(() => ((document.querySelector('#forgot-error') as HTMLElement | null)?.textContent || '').trim() !== '', undefined, { timeout: 25_000 }).catch(() => {});
    const after = await authShape(page, '#forgot-error', ins);
    V('V7', `/forgot-password: before ${JSON.stringify(before)} · after ${JSON.stringify(after)}`);
    expect(before.present && before.role === 'alert' && before.text === '', 'the role=alert container must exist and be empty BEFORE the error').toBe(true);
    expect(after.text, 'NOT VERIFIED: this site produced no error for an invalid email (no captcha branch and the reset request was accepted), so the linking could not be observed').not.toBe('');
    expect(after.inputs[0].invalid, 'the email input has no aria-invalid after the failure').toBe('true');
    expect(after.inputs[0].describedby, 'the email input is not linked to the error').toContain(after.id);
  } finally { await ctx.close().catch(() => {}); }
});

/* ================================ V8 AI chat panel (#2649) ================================ */
test('V8 AI chat panel: launcher has aria-expanded and aria-controls, the panel is a region named Ask AI', async ({ browser }) => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  test.setTimeout(150_000);
  const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await openPage(ctx);
  await stubSettingsWrites(page);
  try {
    await gotoSignedIn(page, '/arena?coin=btc&tf=1h');
    await page.waitForSelector('[data-testid="grok-launcher"]', { state: 'visible', timeout: 40_000 });
    const read = () => page.evaluate(() => {
      const l = document.querySelector('[data-testid="grok-launcher"]') as HTMLElement;
      const id = l.getAttribute('aria-controls') || '';
      const p = (id ? document.getElementById(id) : null) as HTMLElement | null;
      return { expanded: l.getAttribute('aria-expanded'), controls: id, title: l.getAttribute('title') || '', panel: p ? { role: p.getAttribute('role'), name: (p.getAttribute('aria-label') || '').trim(), hidden: p.getAttribute('aria-hidden') } : null };
    });
    const closed = await read();
    await page.locator('[data-testid="grok-launcher"]').click(); /* opens the panel only; no message is sent */
    await page.waitForTimeout(800);
    const open = await read();
    V('V8', `closed ${JSON.stringify(closed)} · open ${JSON.stringify(open)}`);
    expect(closed.expanded, 'launcher has no aria-expanded while closed').toBe('false');
    expect(closed.controls, 'launcher has no aria-controls').not.toBe('');
    expect(closed.panel, 'aria-controls points at nothing').not.toBeNull();
    expect(open.expanded, 'aria-expanded did not become true when the panel opened').toBe('true');
    expect(open.panel?.role, 'the panel is not role=region').toBe('region');
    expect(open.panel?.hidden, 'the open panel is still aria-hidden').not.toBe('true');
    expect(open.panel?.name, 'the panel has no accessible name').not.toBe('');
    if (/^ask ai$/i.test(open.title)) expect(open.panel?.name).toMatch(/^Ask AI$/i);
  } finally { await ctx.close().catch(() => {}); }
});

/* ================================ V9 Reduced motion (#2649) ================================ */
test('V9 Reduced motion on /dashboard: no running infinite rpm-glow-pulse (with a control that it runs without the preference)', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await signedOutContext(browser, { width: 1280 });
  const page = await openPage(ctx);
  const pulses = () => page.evaluate(() => document.getAnimations().filter((a) => (a as CSSAnimation).animationName === 'rpm-glow-pulse' && a.playState === 'running' && a.effect?.getComputedTiming().iterations === Infinity).length);
  try {
    await gotoGuarded(page, '/dashboard');
    await page.waitForSelector('body', { state: 'attached' });
    await page.waitForTimeout(6_000);
    /* The glow only runs at a high or extreme raid level, which the market decides; the level is forced here so the control can fire on any day. */
    const force = () => page.evaluate(() => document.body.setAttribute('data-rpm-level', 'extreme'));
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await force(); await page.waitForTimeout(500);
    const control = await pulses();
    await page.emulateMedia({ reducedMotion: 'reduce' }); await force(); await page.waitForTimeout(500);
    const reduced = await pulses();
    V('V9', `/dashboard: running infinite rpm-glow-pulse animations, no preference (control) ${control} · reduce ${reduced}`);
    expect(control, 'CONTROL FAILED: the pulse does not run even without the preference, so a zero under "reduce" proves nothing').toBeGreaterThan(0);
    expect(reduced, 'rpm-glow-pulse still runs with prefers-reduced-motion: reduce').toBe(0);
  } finally { await ctx.close().catch(() => {}); }
});

/* ================================ V10 Contrast (#2652) ================================ */
type Named = NamedSpec & { required: boolean };
const NAMED: Record<string, Named[]> = {
  '/liq': [
    { label: 'whale-feed price', sel: '.wf-row-price', required: false }, { label: 'whale-feed time', sel: '.wf-row-time', required: false },
    { label: 'Estimated label', sel: '.liq-section-est', required: false }, { label: 'ticker badge', sel: '.news-ticker .ticker-badge', required: true },
  ],
  '/news': [
    { label: 'tab count', sel: '.ntab-count', required: true }, { label: 'Bearish tag', sel: '.ncard-tags span', textRe: 'bearish|\\u2198', required: true },
    { label: 'ticker badge', sel: '.news-ticker .ticker-badge', required: true },
  ],
  '/markets': [{ label: 'ticker badge', sel: '.news-ticker .ticker-badge', required: true }],
  '/dashboard': [{ label: 'ticker badge', sel: '.news-ticker .ticker-badge', required: true }],
  '/briefing': [{ label: 'event tag', sel: '.mb-event-tag', required: false }, { label: 'ticker badge', sel: '.news-ticker .ticker-badge', required: true }],
};
for (const path of Object.keys(NAMED)) for (const w of [390, 1280]) for (const theme of ['dark', 'light'] as Theme[]) {
  test(`V10 Contrast ${path} ${w} ${theme}: named small text reaches 4.5:1`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await signedOutContext(browser, { width: w, theme });
    const page = await openPage(ctx);
    await installNewsFixture(page);
    try {
      await gotoGuarded(page, path);
      await page.waitForSelector('.news-ticker .ticker-badge', { state: 'visible', timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(path === '/liq' ? 15_000 : 9_000); /* past the 0.28 s ticker fade-in and the live feeds */
      const r = await page.evaluate(contrastProbe, { maxPx: 14, named: NAMED[path].map(({ label, sel, textRe }) => ({ label, sel, textRe })) });
      const parts = Object.entries(r.named).map(([k, v]) => `${k}: n=${v.count} min=${v.min}`);
      V('V10', `${path} ${w} ${theme} (data-theme=${r.theme}): named ${parts.join(' · ')} · sweep under 14px: ${r.scanned} measured, ${r.skipped} skipped (gradient background), ${r.failTotal} under 4.5:1 (informational) · worst five ${JSON.stringify(r.worst.map((x) => `${x.sel} "${x.text}" ${x.fg} on ${x.bg} = ${x.ratio}`))}`);
      expect(theme === 'light' ? r.theme === 'light' : r.theme !== 'light', `the page is on data-theme=${r.theme}, not ${theme}: nothing here measures the requested theme`).toBe(true);
      const absent = NAMED[path].filter((n) => (r.named[n.label]?.count ?? 0) === 0);
      for (const n of absent.filter((a) => !a.required)) { V('V10', `UNMEASURED ${path} ${w} ${theme}: ${n.sel} not on the page (data-dependent)`); test.info().annotations.push({ type: 'unmeasured', description: `${path} ${w} ${theme} ${n.sel}` }); }
      const req = absent.filter((a) => a.required);
      expect(req.map((n) => n.sel), `UNMEASURED named elements that the fixture feed should have rendered: ${req.map((n) => n.sel).join(', ')}`).toEqual([]);
      const fails = Object.entries(r.named).flatMap(([k, v]) => v.failing.map((x) => `${k}: ${x.sel} "${x.text}" ${x.fg} on ${x.bg} = ${x.ratio}`));
      expect(fails, `named elements under 4.5:1:\n${fails.join('\n')}`).toEqual([]);
    } finally { await ctx.close().catch(() => {}); }
  });
}

/* ================================ V11 Strategy panel (#2652) ================================ */
for (const w of [1280, 390]) {
  test(`V11 Strategy panel at ${w}: controls at least 24x24, no text under 11px`, async ({ browser }) => {
    test.skip(!AUTH_READY, AUTH_SKIP_REASON);
    test.setTimeout(180_000);
    const ctx = await signedInContext(browser, 'a', { viewport: { width: w, height: w < 500 ? 844 : 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await openPage(ctx);
    await stubSettingsWrites(page);
    try {
      await gotoSignedIn(page, '/arena?coin=btc&tf=1h');
      const sel = page.getByTestId('strategy-set-select').first();
      await sel.waitFor({ state: 'visible', timeout: 60_000 }); await expect(sel).toBeEnabled({ timeout: 90_000 }); await page.waitForTimeout(3_000);
      expect(await entitlementsUnresolved(page), 'the plan read failed, so the Strategy panel is not the Pro one').toBeNull();
      await sel.selectOption('custom'); await page.waitForTimeout(1_500);
      await chip(page, 'Bollinger').click(); await page.waitForTimeout(800); /* a chip with parameters (Length, Std dev) */
      const edit = page.locator('button.strat-edit-link').first();
      if ((await edit.getAttribute('aria-expanded').catch(() => null)) === 'false') await edit.click().catch(() => undefined);
      await page.waitForTimeout(900);
      const m = await page.evaluate(() => {
        const panel = document.querySelector('.strat-panel') as HTMLElement;
        const r = (e: Element) => { const b = e.getBoundingClientRect(); return `${Math.round(b.width)}x${Math.round(b.height)}`; };
        const vis = (e: Element) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
        const checkboxes = Array.from(panel.querySelectorAll('input[type=checkbox]')).filter(vis).map(r);
        const params = Array.from(panel.querySelectorAll('.strat-pv')).filter(vis).map((e) => `${(e as HTMLInputElement).type || e.tagName.toLowerCase()} ${r(e)}`);
        const chips = Array.from(panel.querySelectorAll('button.strat-ind-chip')).filter(vis).map(r);
        const chipBoxes = Array.from(panel.querySelectorAll('.strat-ind-box')).filter(vis).map(r);
        const tiny: string[] = [];
        const w = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          if (!(n.textContent || '').trim()) continue; const el = n.parentElement as HTMLElement; if (!el || !vis(el) || el.closest('.sr-only')) continue;
          const px = parseFloat(getComputedStyle(el).fontSize); if (px < 10.99) tiny.push(`${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/)[0]} "${(n.textContent || '').trim().slice(0, 20)}" ${px}px`);
        }
        const inputs = Array.from(panel.querySelectorAll('.strat-pv')).filter(vis).map((e) => parseFloat(getComputedStyle(e).fontSize));
        return { checkboxes, params, chips, chipBoxes, tiny, inputPx: inputs };
      });
      V('V11', `/arena ${w}: parameter checkboxes ${JSON.stringify(m.checkboxes)} (the registry has no boolean parameter today) · parameter controls ${JSON.stringify(m.params)} · indicator chips ${JSON.stringify(m.chips.slice(0, 4))} · chip tick boxes ${JSON.stringify(m.chipBoxes.slice(0, 2))} (decoration, aria-hidden) · parameter input font px ${JSON.stringify(m.inputPx)} · text under 11px: ${m.tiny.length} ${JSON.stringify(m.tiny.slice(0, 8))}`);
      await page.locator('.strat-panel').first().screenshot({ path: `qa/.shots/v11-strategy-${w}.png` }).catch(() => {});
      const small = (list: string[]) => list.filter((s) => { const [a, b] = (s.split(' ').pop() as string).split('x').map(Number); return a < 24 || b < 24; });
      expect(small(m.checkboxes), `parameter checkboxes under 24x24: ${JSON.stringify(m.checkboxes)}`).toEqual([]);
      expect(m.params.length, 'the parameter box did not open (no .strat-pv control visible)').toBeGreaterThan(0);
      expect(small(m.chips).length, `indicator chips under 24px: ${JSON.stringify(small(m.chips))}`).toBe(0);
      expect(m.tiny, `text under 11px inside the Strategy panel: ${m.tiny.join(' | ')}`).toEqual([]);
    } finally { await ctx.close().catch(() => {}); }
  });
}

/* ================================ V12 /refund canonical (#2648) ================================ */
test('V12 /refund canonical: the served HTML has exactly one canonical link, ending /refund', async ({ browser }) => {
  const ctx = await signedOutContext(browser, { width: 1280 });
  const page = await openPage(ctx);
  try {
    const res = await gotoGuarded(page, '/refund');
    expect(res?.status(), '/refund did not answer 200').toBe(200);
    const html = await res!.text(); /* the served HTML, not the hydrated DOM */
    const links = (html.match(/<link\b[^>]*>/gi) ?? []).filter((t) => /\brel=["']?canonical["']?/i.test(t));
    const hrefs = links.map((t) => (/\bhref=["']([^"']+)["']/i.exec(t) ?? [])[1] ?? '');
    V('V12', `/refund served HTML: ${links.length} canonical link(s) ${JSON.stringify(hrefs)}`);
    expect(links.length, 'the number of rel=canonical links in the served /refund HTML').toBe(1);
    expect(hrefs[0], 'the canonical href must end with /refund').toMatch(/\/refund\/?$/);
  } finally { await ctx.close().catch(() => {}); }
});

/* ================================ V13 Funding and Scanner (#2650) ================================ */
test('V13 /funding heading: "Funding" (or the old name while the label migration is unapplied; this cell says which)', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await signedOutContext(browser, { width: 1280 });
  const page = await openPage(ctx);
  try {
    await gotoGuarded(page, '/funding');
    await page.waitForSelector('h1.mb-title', { state: 'visible', timeout: 40_000 });
    await page.waitForTimeout(8_000); /* the label table loads after first paint */
    const h = ((await page.locator('h1.mb-title').first().textContent()) ?? '').trim();
    V('V13', `/funding heading shows "${h}" -> ${h === 'Funding' ? 'NEW name (label applied)' : h === 'Funding Rate History' ? 'OLD name (the label migration 20261123a is not applied on this site)' : 'UNEXPECTED'}`);
    expect(['Funding', 'Funding Rate History'], `/funding heading is "${h}"`).toContain(h);
  } finally { await ctx.close().catch(() => {}); }
});

test('V13 /scanner heatmap: prices below one cent show at least three significant digits', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await signedOutContext(browser, { width: 1280 });
  const page = await openPage(ctx);
  try {
    await gotoGuarded(page, '/scanner');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.chm-tile > span:nth-child(2)')).some((s) => /^\$0\.0\d{3,}$/.test((s.textContent || '').trim())), undefined, { timeout: 90_000 })
      .catch(() => { throw new Error('UNMEASURED: no heatmap tile with a price under one cent (BONK/PEPE) rendered: the market data did not reach this site'); });
    const tiles = await page.evaluate(() => Array.from(document.querySelectorAll('.chm-tile > span:nth-child(2)')).map((s) => (s.textContent || '').trim()).filter((t) => /^\$0\.\d+$/.test(t)).filter((t) => parseFloat(t.slice(1)) < 0.01));
    const sig = (t: string) => t.slice(3).replace(/^0+/, '').length; /* digits after "$0." with the leading zeros dropped */
    V('V13', `/scanner heatmap sub-cent tiles: ${JSON.stringify(tiles.map((t) => `${t} (${sig(t)} sig)`))}`);
    const bad = tiles.filter((t) => sig(t) < 3);
    expect(bad, `heatmap prices under one cent with fewer than 3 significant digits: ${JSON.stringify(bad)}`).toEqual([]);
  } finally { await ctx.close().catch(() => {}); }
});

/* ================================ V14 Free-trader leftovers (#2647) ================================ */
test('V14 Free trader on /arena at 1280: 1m, 5m and 15m carry a lock badge, the rest do not, and a Pro account sees none', async ({ browser }) => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  test.setTimeout(180_000);
  const read = async (who: 'a' | 'b') => {
    const ctx = await signedInContext(browser, who, { viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await openPage(ctx); await stubSettingsWrites(page);
    try {
      await gotoSignedIn(page, '/arena?coin=btc&tf=1h');
      await page.waitForSelector('button.klc-tf-btn', { state: 'visible', timeout: 60_000 });
      if (who === 'b') await page.waitForFunction(() => Array.from(document.querySelectorAll('button.klc-tf-btn')).some((b) => !!b.querySelector('svg')), undefined, { timeout: 40_000 }).catch(() => {});
      else await page.waitForTimeout(12_000);
      const unresolved = await entitlementsUnresolved(page);
      const btns = await page.evaluate(() => Array.from(document.querySelectorAll('button.klc-tf-btn')).map((b) => ({ t: (b.textContent || '').trim(), lock: !!b.querySelector('svg'), name: b.getAttribute('aria-label') })));
      if (who === 'b') await page.screenshot({ path: 'qa/.shots/v14-lock-free-1280.png' }).catch(() => {});
      return { unresolved, btns };
    } finally { await ctx.close().catch(() => {}); }
  };
  const free = await read('b'); const pro = await read('a');
  V('V14', `Free /arena timeframe buttons ${JSON.stringify(free.btns)} · Pro ${JSON.stringify(pro.btns.filter((b) => b.lock))}`);
  expect(free.unresolved, 'the plan read failed for the Free account').toBeNull();
  for (const t of ['1m', '5m', '15m']) expect(free.btns.find((b) => b.t === t)?.lock, `no lock badge on ${t} for a Free account`).toBe(true);
  expect(free.btns.filter((b) => !['1m', '5m', '15m'].includes(b.t) && b.lock).map((b) => b.t), 'timeframes that should not be locked but are').toEqual([]);
  expect(pro.btns.filter((b) => b.lock).map((b) => b.t), 'a Pro account sees lock badges').toEqual([]);
});

for (const [path, testid] of [['/dashboard', 'csb2-grade-legend'], ['/markets', 'mkt-grade-legend']] as const) {
  test(`V14 Grade legend on ${path}: D, C and F each have a word`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await signedOutContext(browser, { width: 1280 });
    const page = await openPage(ctx);
    try {
      await gotoGuarded(page, path);
      await page.waitForSelector(`[data-testid="${testid}"]`, { state: 'visible', timeout: 40_000 });
      await page.waitForTimeout(4_000);
      const items = await page.evaluate((id) => Array.from(document.querySelectorAll(`[data-testid="${id}"] > span`)).map((s) => (s.textContent || '').replace(/^\s*·\s*/, '').trim()), testid);
      V('V14', `${path} grade legend: ${JSON.stringify(items)}`);
      for (const g of ['D', 'C', 'F']) {
        const it = items.find((x) => x.startsWith(g + ' '));
        expect(it && it.slice(2).trim().length >= 3, `grade ${g} has no word in the legend (${JSON.stringify(items)})`).toBeTruthy();
      }
    } finally { await ctx.close().catch(() => {}); }
  });
}

test('V14 /hours: the page title reads Trading Sessions and no segment is labelled DEAD', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await signedOutContext(browser, { width: 1280 });
  const page = await openPage(ctx);
  try {
    await gotoGuarded(page, '/hours');
    await page.waitForSelector('h1', { state: 'visible', timeout: 40_000 });
    await page.waitForTimeout(8_000); /* labels load after first paint */
    const m = await page.evaluate(() => {
      const dead: string[] = [];
      document.querySelectorAll('body *').forEach((e) => { if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(e.tagName) || e.children.length) return; const t = (e.textContent || '').trim(); if (/\bdead\b/i.test(t)) dead.push(`${e.tagName.toLowerCase()} "${t.slice(0, 40)}"`); });
      return { h1: (document.querySelector('h1')?.textContent || '').trim(), title: document.title, dead };
    });
    V('V14', `/hours: h1 "${m.h1}" · browser title "${m.title}" · elements saying DEAD ${JSON.stringify(m.dead)}`);
    expect(m.h1, 'the /hours page title is still the advice wording (the label migration 20261122a may be unapplied on this site)').toMatch(/trading sessions/i);
    expect(m.h1).not.toMatch(/best hours/i);
    expect(m.dead, 'a segment or pill still says DEAD').toEqual([]);
  } finally { await ctx.close().catch(() => {}); }
});

test('V14 /news: a headline with "presidential" is not tagged TRUMP/TARIFF, and a real tariff headline still is (control)', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await signedOutContext(browser, { width: 1280 });
  const page = await openPage(ctx);
  await installNewsFixture(page);
  try {
    await gotoGuarded(page, '/news');
    await page.waitForSelector('.ncard-grid', { state: 'attached', timeout: 40_000 });
    /* the fixture's rows are spread over the tabs: collect the cards of EVERY tab, de-duplicated by headline */
    const tabCount = await page.locator('.ntab-btn').count(); const seen = new Map<string, { headline: string; tag: string }>();
    for (let ti = 0; ti < tabCount; ti++) { await page.locator('.ntab-btn').nth(ti).click(); await page.waitForTimeout(1_200); for (const c of await page.evaluate(() => Array.from(document.querySelectorAll('article.ncard-grid')).map((a) => ({ headline: (a.querySelector('.ncard-grid-headline')?.textContent || '').trim(), tag: (a.querySelector('.ncard-type-badge')?.textContent || '').trim() })))) if (c.headline) seen.set(c.headline, c); }
    const cards = [...seen.values()];
    const vance = cards.filter((c) => /presidential/i.test(c.headline)); const tariff = cards.filter((c) => c.headline === NEWS_FX.tariff);
    V('V14', `/news tags: presidential headline(s) ${JSON.stringify(vance)} · tariff control ${JSON.stringify(tariff)}`);
    expect(vance.length, `the fixture "presidential" headline did not render (${JSON.stringify(cards)})`).toBeGreaterThan(0);
    expect(tariff.some((c) => /trump|tariff/i.test(c.tag)), 'CONTROL FAILED: a Trump tariff headline is not tagged TRUMP/TARIFF, so the classifier shows no tags at all').toBe(true);
    expect(vance.filter((c) => /trump|tariff/i.test(c.tag)), '"presidential" alone still tags a headline TRUMP/TARIFF').toEqual([]);
  } finally { await ctx.close().catch(() => {}); }
});
