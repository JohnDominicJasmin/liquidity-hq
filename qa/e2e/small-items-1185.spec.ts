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

  test('S5. a MEGA and a WHALE row write BUY and SELL beside the tier label (the feed is injected: one MEGA buy, one WHALE sell)', async ({ browser }) => {
    const { ctx, page } = await newPage(browser, 1280, 'dark');
    try {
      /* The runner sees no real whale trade, so the feed's own Binance aggTrade socket is answered with two known prints:
         BTC 11 x 100,000 = 1.1M (MEGA, buyer is taker: BUY) and ETH 100 x 3,000 = 300K (WHALE, buyer is maker: SELL). */
      const frame = (s: string, p: number, q: number, m: boolean) => JSON.stringify({ stream: s.toLowerCase() + '@aggTrade', data: { e: 'aggTrade', s, p: String(p), q: String(q), m } });
      await page.routeWebSocket(/fstream.binance.com/, (ws) => {
        const send = () => { try { ws.send(frame('BTCUSDT', 100000, 11, false)); ws.send(frame('ETHUSDT', 3000, 100, true)); } catch { /* closed */ } };
        setTimeout(send, 1500); setTimeout(send, 4000); setTimeout(send, 8000);
      });
      await gotoGuarded(page, '/liq');
      await page.waitForTimeout(14_000);
      const badges = await page.locator('.wf-row-side').allInnerTexts();
      console.log('[S5] badges=' + JSON.stringify(badges.slice(0, 12)));
      mkdirSync(DIR, { recursive: true });
      await page.locator('.wf-wrap').first().screenshot({ path: DIR + '/s5-whale-feed.png' });   // the feed itself, not the page above it
      expect(badges.length, 'the injected trades never rendered: nothing was measured').toBeGreaterThan(0);
      const mega = badges.filter(t => /mega/i.test(t)); const whale = badges.filter(t => /whale/i.test(t));
      expect(mega.length, 'no MEGA row rendered').toBeGreaterThan(0);
      expect(whale.length, 'no WHALE row rendered').toBeGreaterThan(0);
      for (const t of mega) expect(t, 'the MEGA row does not say BUY').toMatch(/buy/i);
      for (const t of whale) expect(t, 'the WHALE row does not say SELL').toMatch(/sell/i);
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

test.describe('#1185 liquidation map: the Ask AI button does not cover a row total', () => {
  test.describe.configure({ timeout: 120_000 });
  for (const width of [1280, 1440, 1920]) {
    test('S7. on /liq at ' + width + 'px no TOTAL cell sits under the Ask AI button as the rows scroll past it', async ({ browser }) => {
      const { ctx, page } = await newPage(browser, width, 'dark', 900);
      try {
        await gotoGuarded(page, '/liq');
        await page.waitForTimeout(8_000);
        /* the TOTAL cell is the unclassed third child of each cluster row (grid 80px 1fr 60px 24px); find those by their grid */
        const count = await page.evaluate(() => {
          let n = 0;
          document.querySelectorAll('div').forEach(d => {
            const g = getComputedStyle(d).gridTemplateColumns.split(' ');
            if (d.children.length === 4 && g.length === 4 && g[0] === '80px' && g[2] === '60px' && /^\$[0-9.]+[KMB]?$/.test((d.children[2].textContent || '').trim())) { d.setAttribute('data-qa-liq-row', String(n)); n++; }
          });
          return n;
        });
        expect(count, 'no liquidation cluster row rendered, so nothing was measured').toBeGreaterThan(0);
        const fab = page.locator('.gchat-fab').first();
        expect(await fab.count(), 'the Ask AI button is not on the page').toBeGreaterThan(0);
        const fb = (await fab.boundingBox())!;
        const bad: string[] = []; let measured = 0;
        for (let i = 0; i < Math.min(count, 12); i++) {
          const cell = page.locator('[data-qa-liq-row="' + i + '"] > :nth-child(3)').first();
          await cell.scrollIntoViewIfNeeded();
          const b0 = await cell.boundingBox(); if (!b0) continue;
          await page.evaluate((d) => window.scrollBy(0, d), (b0.y + b0.height / 2) - (fb.y + fb.height / 2));
          await page.waitForTimeout(250);
          const cb = await cell.boundingBox(); const f2 = await fab.boundingBox();
          if (cb && f2) { measured++; if (hits(cb, f2)) bad.push('row ' + i + ' ' + overlapPct(cb, f2) + '%'); }
        }
        console.log('[S7] ' + width + 'px rows=' + count + ' measured=' + measured + ' covered=' + JSON.stringify(bad));
        await shot(page, 's7-liq-' + width);
        expect(measured, 'no row was compared with the button').toBeGreaterThan(0);
        expect(bad, 'the Ask AI button covers a TOTAL value').toEqual([]);
      } finally { await ctx.close(); }
    });
  }
});
