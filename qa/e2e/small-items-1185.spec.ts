/* #2228 (five small items from #1185), #2229 (dashboard "new play" at 390) and the extra-pages sweep (#1413). GitHub runner only.
 *
 *   S1  star clear of the Ask AI button at 1101 / 1280 / 1357          anonymous, bounding boxes
 *   S2  /research top pair: one column at 390, two at 641, nothing clipped, no sideways scroll
 *   S3  funding light-theme selected-row chip contrast, as a NUMBER (>= 4.5)
 *   S4  the chart live-feed dot has an accessible name (role=img + aria-label)
 *   S5  whale feed: a MEGA / WHALE row writes BUY or SELL (skips, and says so, if the feed has no big trade on screen)
 *   S6  dashboard "new play" clear of the Ask AI button at 390, light and dark, with shots
 *   P*  /accessibility /changelog /help /security /status at 390 / 768 / 1280, light and dark: no sideways scroll, no page or console
 *       errors; same-origin links answer < 400 (once per page).
 * Anonymous, nothing stubbed, nothing billed. */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { gotoGuarded } from './_shared';

const DIR = 'qa/.shots';
type Box = { x: number; y: number; width: number; height: number };
const hits = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const overlapPct = (a: Box, b: Box) => {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return Math.round((w * h) / (a.width * a.height) * 100);
};
const shot = async (page: Page, name: string) => { mkdirSync(DIR, { recursive: true }); await page.screenshot({ path: `${DIR}/${name}.png` }); };
const newPage = async (browser: import('@playwright/test').Browser, width: number, theme: 'dark' | 'light', height = 900) => {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch { /* private */ } }, theme);
  return { ctx, page: await ctx.newPage() };
};

test.describe('#2228 small items', () => {
  test.describe.configure({ timeout: 120_000 });

  for (const width of [1101, 1280, 1357]) {
    test(`S1. the playbook star is clear of the Ask AI button at ${width}px`, async ({ browser }) => {
      const { ctx, page } = await newPage(browser, width, 'dark', 1000);
      try {
        await gotoGuarded(page, '/playbook');
        await page.waitForTimeout(6_000);
        const stars = page.getByTestId('playbook-star');
        const n = await stars.count();
        expect(n, 'no playbook star rendered - nothing to measure').toBeGreaterThan(0);
        const fab = page.locator('.gchat-fab').first();
        let measured = 0; const bad: string[] = [];
        for (let i = 0; i < Math.min(n, 12); i++) {
          await stars.nth(i).scrollIntoViewIfNeeded();
          await page.waitForTimeout(300);
          const sb = await stars.nth(i).boundingBox(); const fb = (await fab.count()) ? await fab.boundingBox() : null;
          if (sb && fb) { measured++; const p = overlapPct(sb, fb); if (hits(sb, fb)) bad.push(`star ${i} ${p}%`); }
        }
        console.log(`[S1] ${width}px stars=${n} measured=${measured} overlapping=${JSON.stringify(bad)}`);
        await shot(page, `s1-playbook-${width}`);
        expect(measured, 'the Ask AI button was never on screen, so nothing was compared').toBeGreaterThan(0);
        expect(bad, 'a star sits under the Ask AI button').toEqual([]);
      } finally { await ctx.close(); }
    });
  }

  for (const [width, cols] of [[390, 1], [641, 2]] as const) {
    test(`S2. /research top pair is ${cols} column(s) at ${width}px, nothing clipped, no sideways scroll`, async ({ browser }) => {
      const { ctx, page } = await newPage(browser, width, 'dark');
      try {
        await gotoGuarded(page, '/research');
        await page.locator('.research-pair').first().waitFor({ state: 'visible', timeout: 40_000 });
        await page.waitForTimeout(4_000);
        const m = await page.evaluate(() => {
          const pair = document.querySelector('.research-pair') as HTMLElement;
          const tracks = getComputedStyle(pair).gridTemplateColumns.split(' ').filter(Boolean).length;
          const kids = Array.from(pair.children) as HTMLElement[];
          return {
            tracks,
            clipped: kids.filter(k => k.scrollWidth > k.clientWidth + 1).map(k => `${k.className || k.tagName}:${k.scrollWidth}>${k.clientWidth}`),
            doc: { sw: document.documentElement.scrollWidth, iw: window.innerWidth },
          };
        });
        console.log(`[S2] ${width}px ${JSON.stringify(m)}`);
        await shot(page, `s2-research-${width}`);
        expect(m.tracks, `the top pair has ${m.tracks} column(s) at ${width}px`).toBe(cols);
        expect(m.clipped, 'a card in the pair clips its own content').toEqual([]);
        expect(m.doc.sw, 'the page scrolls sideways').toBeLessThanOrEqual(m.doc.iw);
      } finally { await ctx.close(); }
    });
  }

  test('S3. funding light theme: the selected-row chip colour reads >= 4.5:1 on the selected row (the number is logged)', async ({ browser }) => {
    const { ctx, page } = await newPage(browser, 1280, 'light');
    try {
      await gotoGuarded(page, '/funding');
      await page.waitForTimeout(6_000);
      expect(await page.getAttribute('html', 'data-theme'), 'the light theme did not apply, so the colour is not the light one').toBe('light');
      const row = page.locator('.frh-row').first();
      await row.waitFor({ state: 'visible', timeout: 40_000 });
      await row.click();
      await page.waitForTimeout(800);
      const r = await row.evaluate((el) => {
        const parse = (c: string) => { const m = c.match(/[0-9.]+/g)!.map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
        const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
        const lum = (c: { r: number; g: number; b: number }) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
        const probe = document.createElement('div'); probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--fr-slight-long').trim();
        document.body.appendChild(probe); const fg = parse(getComputedStyle(probe).color); probe.remove();
        // composite the row's own background and every ancestor's, from the row outward, until opaque
        const layers: { r: number; g: number; b: number; a: number }[] = [];
        for (let e: Element | null = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0) layers.push(c); if (c.a >= 1) break; }
        let bg = { r: 255, g: 255, b: 255 };
        for (const l of layers.reverse()) bg = { r: l.r * l.a + bg.r * (1 - l.a), g: l.g * l.a + bg.g * (1 - l.a), b: l.b * l.a + bg.b * (1 - l.a) };
        const [x, y] = [lum(fg), lum(bg)];
        return { fg, bg, on: el.classList.contains('on'), layers: layers.length, ratio: Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100, token: getComputedStyle(document.documentElement).getPropertyValue('--fr-slight-long').trim() };
      });
      console.log(`[S3] --fr-slight-long ${r.token} on the selected row: ${r.ratio}:1 (fg ${JSON.stringify(r.fg)} bg ${JSON.stringify(r.bg)})`);
      expect(r.on, 'the clicked row did not become the selected row, so the measurement is not of a selected row').toBe(true);
      expect(r.token, 'the token --fr-slight-long is not defined in the light theme').not.toBe('');
      expect(r.ratio, `the chip colour measures ${r.ratio}:1 on the selected row`).toBeGreaterThanOrEqual(4.5);
    } finally { await ctx.close(); }
  });

  test('S4. the chart live-feed dot has an accessible name', async ({ browser }) => {
    const { ctx, page } = await newPage(browser, 1280, 'dark');
    try {
      await gotoGuarded(page, '/arena');
      const dot = page.locator('.klc-ws-dot').first();
      await dot.waitFor({ state: 'attached', timeout: 60_000 });
      const a = await dot.evaluate(el => ({ role: el.getAttribute('role'), label: el.getAttribute('aria-label'), cls: el.className }));
      console.log(`[S4] ${JSON.stringify(a)}`);
      expect(a.role).toBe('img');
      expect(a.label ?? '', 'the dot has no accessible name').toMatch(/price feed (live|offline|connecting)/i);
    } finally { await ctx.close(); }
  });

  test('S5. a MEGA / WHALE row writes BUY or SELL', async ({ browser }) => {
    const { ctx, page } = await newPage(browser, 1280, 'dark');
    try {
      let found: string[] = [];
      for (const path of ['/liq', '/live-tracking', '/dashboard']) {
        await gotoGuarded(page, path);
        await page.waitForTimeout(12_000);
        found = await page.locator('.wf-row-side').allInnerTexts();
        if (found.length) { console.log(`[S5] ${path}: ${found.length} side badges`); break; }
      }
      console.log(`[S5] badges=${JSON.stringify(found.slice(0, 12))}`);
      test.skip(found.length === 0, 'the whale feed showed no trade on any page: this cell measured nothing, UNPROVEN');
      const big = found.filter(t => /mega|whale/i.test(t));
      test.skip(big.length === 0, 'no MEGA or WHALE trade on screen in this window: UNPROVEN');
      for (const t of big) expect(t, 'a big trade shows no side in words').toMatch(/buy|sell/i);
    } finally { await ctx.close(); }
  });
});

test.describe('#2229 dashboard new play', () => {
  test.describe.configure({ timeout: 120_000 });
  for (const theme of ['dark', 'light'] as const) {
    test(`S6. "new play" is clear of the Ask AI button at 390px, ${theme}`, async ({ browser }) => {
      const { ctx, page } = await newPage(browser, 390, theme, 844);
      try {
        await gotoGuarded(page, '/dashboard');
        const btn = page.locator('.sotd-refresh').first();
        await btn.waitFor({ state: 'visible', timeout: 60_000 });
        await btn.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        const fab = page.locator('.gchat-fab').first();
        const fb = (await fab.count()) ? await fab.boundingBox() : null;
        /* the overlap only exists while the row scrolls THROUGH the button's band, so put the button's centre on the FAB's centre line first */
        const b0 = await btn.boundingBox();
        if (b0 && fb) { await page.evaluate((d) => window.scrollBy(0, d), (b0.y + b0.height / 2) - (fb.y + fb.height / 2)); await page.waitForTimeout(500); }
        const bb = await btn.boundingBox();
        const sw = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
        console.log(`[S6] ${theme} button=${JSON.stringify(bb)} fab=${JSON.stringify(fb)} overlap=${bb && fb ? overlapPct(bb, fb) : 'n/a'}% doc=${JSON.stringify(sw)}`);
        await shot(page, `s6-dashboard-new-play-390-${theme}`);
        expect(bb, 'the button has no box').not.toBeNull();
        expect(fb, 'the Ask AI button was not on screen, so nothing was compared').not.toBeNull();
        expect(hits(bb!, fb!), 'the "new play" button sits under the Ask AI button').toBe(false);
        expect(sw.sw, 'the page scrolls sideways').toBeLessThanOrEqual(sw.iw);
      } finally { await ctx.close(); }
    });
  }
});

test.describe('#1413 five extra pages', () => {
  test.describe.configure({ timeout: 120_000 });
  const PAGES = ['/accessibility', '/changelog', '/help', '/security', '/status'];
  for (const path of PAGES) for (const width of [390, 768, 1280]) for (const theme of ['dark', 'light'] as const) {
    test(`P. ${path} at ${width}px ${theme}: no sideways scroll, no page or console errors`, async ({ browser }) => {
      const { ctx, page } = await newPage(browser, width, theme);
      const errors: string[] = [];
      page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 160)));
      page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|favicon|WebSocket connection to/i.test(m.text())) errors.push('console: ' + m.text().slice(0, 160)); });
      try {
        await gotoGuarded(page, path);
        await page.waitForTimeout(4_000);
        const m = await page.evaluate(() => ({
          sw: document.documentElement.scrollWidth, iw: window.innerWidth, h1: !!document.querySelector('h1'),
          theme: document.documentElement.getAttribute('data-theme'), len: document.body.innerText.length,
        }));
        console.log(`[P] ${path} ${width} ${theme} sw=${m.sw} iw=${m.iw} h1=${m.h1} theme=${m.theme} text=${m.len} errors=${errors.length}`);
        if (width === 390) await shot(page, `p-${path.slice(1)}-390-${theme}`);
        expect(m.len, 'the page rendered almost no text').toBeGreaterThan(200);
        expect(m.theme, 'the requested theme did not apply').toBe(theme);
        expect(m.sw, `${path} scrolls sideways at ${width}px (${m.sw} > ${m.iw})`).toBeLessThanOrEqual(m.iw);
        expect(errors, 'errors on the page').toEqual([]);
      } finally { await ctx.close(); }
    });
  }
  for (const path of PAGES) {
    test(`P-links. ${path}: every same-origin link answers below 400`, async ({ browser }) => {
      const { ctx, page } = await newPage(browser, 1280, 'dark');
      try {
        await gotoGuarded(page, path);
        await page.waitForTimeout(3_000);
        const hrefs = await page.evaluate(() => Array.from(new Set(Array.from(document.querySelectorAll('a[href]')).map(a => (a as HTMLAnchorElement).href)
          .filter(h => h.startsWith(location.origin) && !h.includes('#') && !/\/api\//.test(h)))));
        const bad: string[] = [];
        for (const h of hrefs.slice(0, 60)) { const r = await page.request.get(h, { timeout: 30_000 }).catch(() => null); if (!r || r.status() >= 400) bad.push(`${h} ${r ? r.status() : 'no answer'}`); }
        console.log(`[P-links] ${path}: ${hrefs.length} same-origin links, bad=${JSON.stringify(bad)}`);
        expect(hrefs.length, 'the page has no same-origin link: nothing measured').toBeGreaterThan(0);
        expect(bad, 'a link is broken').toEqual([]);
      } finally { await ctx.close(); }
    });
  }
});
