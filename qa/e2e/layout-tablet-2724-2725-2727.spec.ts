/* TABLET WIDTH AUDIT (#1185): THREE CSS-ONLY PRs MEASURED ON A DEPLOYED GATED SITE (qa / staging), signed in, dark. Read-only: nothing is clicked or saved. Paid AI is fenced.
 * The expectations below are the written rules of the PR bodies, as literals. Nothing is computed from the stylesheet.
 *
 *   #2724 Arena 981-1099 px (fix/width-1024-1160):  at 1024, 1058, 1099 the chart column (.arena-ws-chart, and .klc-wrap inside it) is >= 600 px, the rail (.arena-ws-rail) is 320 px,
 *         no sideways scroll (documentElement.scrollWidth <= innerWidth). 980 and 1100 are only RECORDED (980 must still be one column). /markets and /news at 1024 keep the 700 px reading column.
 *   #2725 top nav 945-1279 px (fix/nav-945-1279), Free / trial / Pro x en / ru / ko, at 944, 945, 1024, 1100, 1159, 1160, 1279: .tnav scrollWidth <= clientWidth, the avatar is fully inside the window,
 *         every .tnav-item has the same height (no wrap), the session pill .tnav-session is not shown below 1160 and shown at 1160 and 1279.
 *   #2727 dashboard 900-1099 px (fix/dashboard-tablet-columns), at 899, 900, 999, 1000, 1024, 1099: 1000-1099 two columns, rail (.dash-right) exactly 352 px, main column (.dash-main) >= 590 px;
 *         900-999 ONE column, the rail below the main column and full width; 899 one column; no sideways scroll; no direct child of .dash-main clipped (scrollWidth > clientWidth + 1) at 900-1099.
 *
 * Accounts (qa/e2e/_auth.ts, state-matrix.spec.ts): a = Pro, b = Free, t = trial (active), admin = trial expired. Used here: a (Arena, dashboard, other pages, nav), b (nav), t (nav).
 * A missing b or t fixture is a SKIP of that cell, printed, never a pass.
 *
 * Printed per cell:  [TAB] <page> <width> <lang/account>: <numbers>      Shots: qa/.shots/tab-<page>-<width>.png (dark; nav: tab-nav-<account>-<lang>-<width>.png, top strip)
 * One failure list per test, asserted once at the end, so one bad width does not hide the others.
 * usage: E2E_BASE_URL=https://liquidity-hq-qa.onrender.com npx playwright test layout-tablet-2724-2725-2727 --project=desktop (run by CI) */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY, AUTH_SKIP_REASON, FIXTURES, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

mkdirSync('qa/.shots', { recursive: true });
test.skip(!AUTH_READY, AUTH_SKIP_REASON);
/* The spec sets its own viewports; the mobile project would only repeat every cell. */
test.beforeEach(() => { test.skip(test.info().project.name !== 'desktop', 'sets its own viewports, runs under the desktop project only'); });

type Who = 'a' | 'b' | 't';
const ACCOUNT_LABEL: Record<Who, string> = { a: 'Pro', b: 'Free', t: 'trial' };
const HAS_FIXTURE: Record<Who, boolean> = {
  a: !!FIXTURES.aEmail && !!FIXTURES.aPassword,
  b: !!FIXTURES.bEmail && !!FIXTURES.bPassword,
  t: !!FIXTURES.tEmail && !!FIXTURES.tPassword,
};
const heightFor = (w: number) => (w >= 1000 ? 900 : 844);

async function open(browser: Browser, who: Who, width: number, lang: 'en' | 'ru' | 'ko', path: string) {
  const ctx = await signedInContext(browser, who, { viewport: { width, height: heightFor(width) } });
  await ctx.addInitScript((l: string) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, lang);
  const page = await ctx.newPage();
  await installPaidAiFence(page);
  await gotoSignedIn(page, path);
  return { ctx, page };
}
async function resize(page: Page, width: number, settleMs = 1500) {
  await page.setViewportSize({ width, height: heightFor(width) });
  await page.waitForTimeout(settleMs);
}
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

/* ───────────────────────────── #2724 ARENA ───────────────────────────── */
const ARENA_WIDTHS = [1024, 1058, 1099, 980, 1100];
const ARENA_ASSERTED = [1024, 1058, 1099];

test('TAB:arena (#2724) Pro', async ({ browser }) => {
  test.setTimeout(300_000);
  const { ctx, page } = await open(browser, 'a', 1024, 'en', '/arena?coin=btc&tf=1h');
  const bad: string[] = [];
  try {
    await page.locator('.arena-ws-chart').first().waitFor({ state: 'visible', timeout: 90_000 });
    await page.locator('.klc-wrap').first().waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {});
    await page.waitForTimeout(4_000);
    for (const width of ARENA_WIDTHS) {
      await resize(page, width, 2_000);
      const m = await page.evaluate(() => {
        const box = (sel: string) => { const e = document.querySelector(sel); if (!e) return null; const q = e.getBoundingClientRect(); return { l: Math.round(q.left * 10) / 10, r: Math.round(q.right * 10) / 10, t: Math.round(q.top * 10) / 10, b: Math.round(q.bottom * 10) / 10, w: Math.round(q.width * 10) / 10 }; };
        const ac = document.querySelector('.app-content') as HTMLElement | null; const cs = ac ? getComputedStyle(ac) : null;
        return {
          iw: innerWidth, sw: document.documentElement.scrollWidth,
          chart: box('.arena-ws-chart'), klc: box('.klc-wrap'), rail: box('.arena-ws-rail'), ws: box('.arena-ws'),
          appMax: cs?.maxWidth ?? null, appPadL: cs?.paddingLeft ?? null, appPadR: cs?.paddingRight ?? null,
        };
      });
      const cols = m.chart && m.rail ? (m.rail.t >= m.chart.b - 1 ? 1 : 2) : null;
      console.log(`[TAB] arena ${width} Pro: viewport ${m.iw} scrollWidth ${m.sw} · chart col ${m.chart?.w} · .klc-wrap ${m.klc?.w} · rail ${m.rail?.w} (left ${m.rail?.l}) · columns ${cols} · app-content max-width ${m.appMax} padding ${m.appPadL}/${m.appPadR}`);
      await page.screenshot({ path: `qa/.shots/tab-arena-${width}.png`, timeout: 30_000 }).catch(() => {});
      if (ARENA_ASSERTED.includes(width)) {
        if (!m.chart) bad.push(`${width}: .arena-ws-chart not found`);
        else if (m.chart.w < 600) bad.push(`${width}: chart column ${m.chart.w} px, expected >= 600`);
        if (!m.klc) bad.push(`${width}: .klc-wrap not found`);
        else if (m.klc.w < 600) bad.push(`${width}: .klc-wrap ${m.klc.w} px, expected >= 600`);
        if (!m.rail) bad.push(`${width}: .arena-ws-rail not found`);
        else if (!near(m.rail.w, 320, 0.5)) bad.push(`${width}: rail ${m.rail.w} px, expected 320`);
        if (cols !== 2) bad.push(`${width}: expected two columns, measured ${cols}`);
        if (m.sw > m.iw) bad.push(`${width}: sideways scroll, scrollWidth ${m.sw} > innerWidth ${m.iw}`);
      }
      if (width === 980 && cols !== 1) bad.push(`980: the workspace must be ONE column, measured ${cols}`);
    }
    expect(bad, 'Arena 981-1099 px (#2724)').toEqual([]);
  } finally { await ctx.close().catch(() => {}); }
});

/* The other pages keep their 700 px reading column at 1024. */
for (const route of ['markets', 'news']) {
  test(`TAB:${route} (#2724 other pages) Pro`, async ({ browser }) => {
    test.setTimeout(240_000);
    const { ctx, page } = await open(browser, 'a', 1024, 'en', `/${route}`);
    const bad: string[] = [];
    try {
      await page.locator('.app-content').first().waitFor({ state: 'visible', timeout: 60_000 });
      await page.waitForTimeout(3_000);
      const m = await page.evaluate(() => {
        const ac = document.querySelector('.app-content') as HTMLElement | null; const cs = ac ? getComputedStyle(ac) : null;
        return { iw: innerWidth, sw: document.documentElement.scrollWidth, maxW: cs?.maxWidth ?? null, w: ac ? Math.round(ac.getBoundingClientRect().width) : null };
      });
      console.log(`[TAB] ${route} 1024 Pro: viewport ${m.iw} scrollWidth ${m.sw} · .app-content max-width ${m.maxW} width ${m.w}`);
      await page.screenshot({ path: `qa/.shots/tab-${route}-1024.png`, timeout: 30_000 }).catch(() => {});
      if (m.maxW !== '700px') bad.push(`${route} 1024: .app-content max-width ${m.maxW}, expected 700px`);
      expect(bad, `${route} keeps the 700 px reading column at 1024`).toEqual([]);
    } finally { await ctx.close().catch(() => {}); }
  });
}

/* ───────────────────────────── #2727 DASHBOARD ───────────────────────────── */
const DASH_WIDTHS = [1024, 1099, 1000, 999, 900, 899];

test('TAB:dashboard (#2727) Pro', async ({ browser }) => {
  test.setTimeout(300_000);
  const { ctx, page } = await open(browser, 'a', 1024, 'en', '/dashboard');
  const bad: string[] = [];
  try {
    await page.locator('.dash-main').first().waitFor({ state: 'visible', timeout: 90_000 });
    await page.locator('.dash-right').first().waitFor({ state: 'attached', timeout: 30_000 });
    await page.waitForTimeout(5_000);
    for (const width of DASH_WIDTHS) {
      await resize(page, width, 2_500);
      const m = await page.evaluate(() => {
        const box = (e: Element | null) => { if (!e) return null; const q = e.getBoundingClientRect(); return { l: Math.round(q.left * 10) / 10, r: Math.round(q.right * 10) / 10, t: Math.round(q.top * 10) / 10, b: Math.round(q.bottom * 10) / 10, w: Math.round(q.width * 10) / 10 }; };
        const main = document.querySelector('.dash-main'); const rail = document.querySelector('.dash-right'); const grid = document.querySelector('.dashboard-grid');
        const kids = main ? Array.from(main.children) : [];
        const clipped = kids.map((k) => { const el = k as HTMLElement; return { name: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`, sw: el.scrollWidth, cw: el.clientWidth }; }).filter((k) => k.cw > 0 && k.sw > k.cw + 1);
        const gcs = grid ? getComputedStyle(grid) : null;
        return { iw: innerWidth, sw: document.documentElement.scrollWidth, main: box(main), rail: box(rail), grid: box(grid), gridDisplay: gcs?.display ?? null, gridCols: gcs?.gridTemplateColumns ?? null, mainOverflowX: main ? getComputedStyle(main).overflowX : null, kidCount: kids.length, clipped };
      });
      const cols = m.main && m.rail ? (m.rail.t >= m.main.b - 1 ? 1 : 2) : null;
      console.log(`[TAB] dashboard ${width} Pro: viewport ${m.iw} scrollWidth ${m.sw} · grid ${m.gridDisplay} [${m.gridCols}] · main ${m.main?.w} · rail ${m.rail?.w} (top ${m.rail?.t}, main bottom ${m.main?.b}) · columns ${cols} · main children ${m.kidCount}, clipped ${m.clipped.length} ${JSON.stringify(m.clipped)}`);
      await page.screenshot({ path: `qa/.shots/tab-dashboard-${width}.png`, timeout: 30_000 }).catch(() => {});
      if (!m.main || !m.rail) { bad.push(`${width}: .dash-main or .dash-right not found`); continue; }
      if (m.sw > m.iw) bad.push(`${width}: sideways scroll, scrollWidth ${m.sw} > innerWidth ${m.iw}`);
      if (width >= 1000) {
        if (cols !== 2) bad.push(`${width}: expected two columns, measured ${cols}`);
        if (!near(m.rail.w, 352, 0.5)) bad.push(`${width}: rail ${m.rail.w} px, expected exactly 352`);
        if (m.main.w < 590) bad.push(`${width}: main column ${m.main.w} px, expected >= 590`);
      } else if (width >= 900) {
        if (cols !== 1) bad.push(`${width}: expected ONE column (rail below the main column), measured ${cols}`);
        if (!near(m.rail.w, m.main.w, 2)) bad.push(`${width}: rail ${m.rail.w} px is not full width (main column ${m.main.w})`);
      } else if (cols !== 1) bad.push(`${width}: expected one column (unchanged), measured ${cols}`);
      if (width >= 900 && width <= 1099 && m.clipped.length) bad.push(`${width}: clipped children of the main column ${JSON.stringify(m.clipped)}`);
    }
    expect(bad, 'Dashboard 900-1099 px (#2727)').toEqual([]);
  } finally { await ctx.close().catch(() => {}); }
});

/* ───────────────────────────── #2725 TOP NAV ───────────────────────────── */
const NAV_WIDTHS = [1279, 1160, 1159, 1100, 1024, 945, 944];
const NAV_CELLS: Array<{ who: Who; lang: 'en' | 'ru' | 'ko' }> = [];
for (const who of ['b', 't', 'a'] as Who[]) for (const lang of ['en', 'ru', 'ko'] as const) NAV_CELLS.push({ who, lang });

for (const { who, lang } of NAV_CELLS) {
  test(`TAB:nav (#2725) ${ACCOUNT_LABEL[who]} ${lang}`, async ({ browser }) => {
    test.setTimeout(240_000);
    test.skip(!HAS_FIXTURE[who], `no fixture for account '${who}' (${ACCOUNT_LABEL[who]}): this cell is NOT measured`);
    const { ctx, page } = await open(browser, who, 1279, lang, '/dashboard');
    const bad: string[] = [];
    try {
      await page.locator('.tnav').first().waitFor({ state: 'visible', timeout: 90_000 });
      /* The session pill renders once the session clock resolves; give it time at the width where it must show. */
      const pillRendered = await page.locator('.tnav-session').first().waitFor({ state: 'attached', timeout: 20_000 }).then(() => true, () => false);
      await page.waitForTimeout(2_500);
      for (const width of NAV_WIDTHS) {
        await resize(page, width, 1_000);
        const m = await page.evaluate(() => {
          const vis = (e: Element) => { const q = e.getBoundingClientRect(); const cs = getComputedStyle(e); return q.width > 0 && q.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
          const nav = document.querySelector('.tnav') as HTMLElement | null; if (!nav) return null;
          const items = Array.from(nav.querySelectorAll('.tnav-item')).filter(vis).map((e) => Math.round(e.getBoundingClientRect().height * 10) / 10);
          const sess = nav.querySelector('.tnav-session') as HTMLElement | null;
          const av = nav.querySelector('.tnav-avatar') as HTMLElement | null; const aq = av ? av.getBoundingClientRect() : null;
          const badge = nav.querySelector('.plan-badge') as HTMLElement | null;
          return {
            iw: innerWidth, docSw: document.documentElement.scrollWidth, navSw: nav.scrollWidth, navCw: nav.clientWidth, navDisplay: getComputedStyle(nav).display, htmlLang: document.documentElement.lang,
            items, sessInDom: !!sess, sessShown: !!sess && vis(sess), sessW: sess ? Math.round(sess.getBoundingClientRect().width) : 0,
            av: aq ? { l: Math.round(aq.left * 10) / 10, r: Math.round(aq.right * 10) / 10, w: Math.round(aq.width * 10) / 10, vis: vis(av as HTMLElement) } : null,
            badge: badge ? (badge.innerText || '').replace(/\s+/g, ' ').trim() : null,
          };
        });
        if (!m) { bad.push(`${width}: .tnav not found`); continue; }
        const hMin = Math.min(...m.items), hMax = Math.max(...m.items);
        const gap = m.av ? Math.round((m.iw - m.av.r) * 10) / 10 : null;
        console.log(`[TAB] nav ${width} ${lang}/${ACCOUNT_LABEL[who]}: viewport ${m.iw} html lang ${m.htmlLang} · .tnav scrollWidth ${m.navSw} clientWidth ${m.navCw} · avatar left ${m.av?.l} right ${m.av?.r} gap to window edge ${gap} · items ${m.items.length} heights ${hMin}-${hMax} · session pill ${m.sessInDom ? (m.sessShown ? 'shown w' + m.sessW : 'hidden') : 'not rendered'} · badge "${m.badge}" · page scrollWidth ${m.docSw}`);
        await page.screenshot({ path: `qa/.shots/tab-nav-${ACCOUNT_LABEL[who]}-${lang}-${width}.png`, clip: { x: 0, y: 0, width, height: 120 }, timeout: 30_000 }).catch(() => {});
        if (m.navDisplay === 'none') { bad.push(`${width}: .tnav is display:none`); continue; }
        if (m.navSw > m.navCw) bad.push(`${width}: .tnav overflows, scrollWidth ${m.navSw} > clientWidth ${m.navCw}`);
        if (!m.av) bad.push(`${width}: avatar (.tnav-avatar) not found`);
        else if (!m.av.vis || m.av.r > m.iw || m.av.l < 0) bad.push(`${width}: avatar not fully inside the window (left ${m.av.l}, right ${m.av.r}, window ${m.iw})`);
        if (m.items.length === 0) bad.push(`${width}: no visible .tnav-item`);
        else if (hMax - hMin > 1) bad.push(`${width}: a nav item wraps, item heights ${hMin}-${hMax}`);
        if (width < 1160) { if (m.sessShown) bad.push(`${width}: session pill is shown (width ${m.sessW}), expected hidden below 1160`); }
        else if (m.sessInDom && !m.sessShown) bad.push(`${width}: session pill is hidden, expected shown at ${width}`);
        else if (!m.sessInDom) console.log(`[TAB] nav ${width} ${lang}/${ACCOUNT_LABEL[who]}: NOTE the session pill is not rendered at all (pill rendered at load: ${pillRendered}), so "shown at 1160+" could not be checked in this cell`);
      }
      expect(bad, `top nav 945-1279 px (#2725), ${ACCOUNT_LABEL[who]} ${lang}`).toEqual([]);
    } finally { await ctx.close().catch(() => {}); }
  });
}
