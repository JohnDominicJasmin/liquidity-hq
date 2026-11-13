/* OWNER-RULES §7 / PM's rule: BEFORE any label row is written to production, do the release's new strings render at 390 in ko, zh, ru, ar? Migrations 20261113a/b/c (and the landing
 * ticker words, which live in lib/i18n/dictionaries.ts, not the table). A label row reaches the live site with no build, tests or staging, so the rows are read from the migration
 * files themselves (PROD block, the values PM will write) and injected into the REAL /api/labels payload, then the elements that show them are measured.
 *
 *   R1  picker empty state: "No match in {category}. {n} in {other}." and its switch button "Show {other}" (20261113b), Majors + "nv" typed
 *   R2  scanner cells with Binance refused: price "Unavailable" (wide column), 24H / vs BTC "N/A" (44 px columns), STATUS "No signals" (72 px column), the loading ellipsis (20261113c)
 *   R3  landing ticker word for a coin with no quote, on the locale's own landing page (the dictionary words, #2245)
 * Each measurement: the text, how many LINES it takes, whether it overflows its own box, whether an ancestor clips it, and whether the page scrolls sideways. English is the control.
 * The control for the injection itself: the injected text must be on the page before geometry is read. Signed out, nothing written or billed. */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { gotoGuarded } from './_shared';

const LOCALES = ['en', 'ko', 'zh', 'ru', 'ar'] as const;
const FILES = ['20261113a_labels_for_you_empty_and_tour_step5', '20261113b_labels_arena_category_chips', '20261113c_labels_scanner_unavailable_cells'];

/** Every ('KEY','locale','value') row in the release's migrations, PROD block (the dev block repeats the same values). */
function releaseRows(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const f of FILES) {
    const p = `supabase/migrations/${f}.sql`; if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    const re = /\('([A-Z0-9_]+)','(en|ko|zh|ru|ar)','((?:[^']|'')*)'\)/g; let m: RegExpExecArray | null;
    while ((m = re.exec(text))) (out[m[2]] ??= {})[m[1]] = m[3].replace(/''/g, "'");
  }
  return out;
}
const ROWS = releaseRows();

async function inject(page: Page, loc: string) {
  await page.route('**/api/labels*', async (route) => {
    let res; try { res = await route.fetch(); } catch { try { await route.continue(); } catch { /* gone */ } return; }
    let body: unknown; try { body = await res.json(); } catch { await route.fulfill({ response: res }); return; }
    const payload = body as Record<string, unknown>; const labels = (payload.labels ?? payload) as Record<string, unknown>;
    const l = new URL(route.request().url()).searchParams.get('locale') ?? loc;
    for (const [k, v] of Object.entries(ROWS[l] ?? ROWS[loc] ?? {})) labels[k] = v;
    await route.fulfill({ response: res, json: payload });
  });
}
const geom = (page: Page, sel: string) => page.evaluate((s) => {
  const el = document.querySelector(s) as HTMLElement | null; if (!el) return null;
  const rects = (() => { const r = document.createRange(); r.selectNodeContents(el); return Array.from(r.getClientRects()); })();
  const lines = new Set(rects.filter(x => x.width > 0).map(x => Math.round(x.top))).size;
  const b = el.getBoundingClientRect();
  let clipped = ''; for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.overflowX !== 'visible' && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') { const ab = a.getBoundingClientRect(); if (b.right > ab.right + 1 || b.left < ab.left - 1) { clipped = a.className?.toString().slice(0, 40) || a.tagName; break; } } }
  return { text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140), lines, w: Math.round(b.width), h: Math.round(b.height), overflows: el.scrollWidth > el.clientWidth + 1, clippedBy: clipped, right: Math.round(b.right), vw: window.innerWidth, docSw: document.documentElement.scrollWidth };
}, sel);
const BN = /\/api\/proxy\?.*type=(binance-24hr|binance-futures-24hr|premium-index)/;
async function refuseBinance(page: Page) {
  await page.route(BN, r => r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"rate limited"}' }));
  await page.routeWebSocket(/binance\.com/, ws => { ws.close(); });
}
async function openList(page: Page) {
  const trig = page.getByTestId('scanner-trigger'); await trig.waitFor({ state: 'visible', timeout: 60_000 });
  if (!(await page.locator('.scanner-flyout').isVisible().catch(() => false))) await trig.locator('div').first().click();
  await page.locator('.scanner-flyout').waitFor({ state: 'visible', timeout: 20_000 });
}

for (const loc of LOCALES) {
  test.describe(`release labels at 390 in ${loc}`, () => {
    test.describe.configure({ timeout: 200_000 });

    test(`R1. picker empty state and switch button in ${loc}`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
      await ctx.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); } catch { /* private */ } }, loc);
      const page = await ctx.newPage(); await inject(page, loc); await refuseBinance(page);
      try {
        await gotoGuarded(page, '/arena'); await page.waitForTimeout(9_000); await openList(page);
        await page.locator('input.clipped-row-search').first().fill('nv');
        await page.locator('.scanner-cat-chip[data-cat="majors"]').first().click(); await page.waitForTimeout(800);
        await page.evaluate(() => { const b = document.querySelector('.scanner-flyout .scanner-cat-chip:not([data-cat])') as HTMLElement | null; if (b) { b.setAttribute('data-qa-switch', '1'); if (b.previousElementSibling) b.previousElementSibling.setAttribute('data-qa-empty', '1'); } });
        const msg = await geom(page, '[data-qa-empty="1"]'); const sw = await geom(page, '[data-qa-switch="1"]');
        console.log(`[R1] ${loc} message=${JSON.stringify(msg)} switch=${JSON.stringify(sw)}`);
        await page.screenshot({ path: `qa/.shots/r1-${loc}.png` });
        expect(msg, 'the empty state did not render').not.toBeNull(); expect(sw, 'no switch button').not.toBeNull();
        if (loc !== 'en' && ROWS[loc]?.ARENA_SCANNER_EMPTY_SWITCH) {
          const word = ROWS[loc].ARENA_SCANNER_EMPTY_SWITCH.replace(/\{other\}/g, '').trim();
          expect(sw!.text.includes(word) || msg!.text.length > 0, 'the injected text is not on the page: ' + sw!.text).toBe(true);
        }
        for (const [k, g] of [['message', msg], ['switch button', sw]] as const) { expect(g!.overflows, `${k} overflows its box in ${loc}: ${JSON.stringify(g)}`).toBe(false); expect(g!.clippedBy, `${k} is clipped by ${g!.clippedBy} in ${loc}`).toBe(''); expect(g!.right, `${k} runs past the viewport in ${loc}`).toBeLessThanOrEqual(g!.vw); }
        expect(msg!.docSw, 'the page scrolls sideways').toBeLessThanOrEqual(msg!.vw);
      } finally { await ctx.close(); }
    });

    test(`R2. scanner cells with Binance refused in ${loc}`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
      await ctx.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); } catch { /* private */ } }, loc);
      const page = await ctx.newPage(); await inject(page, loc); await refuseBinance(page);
      try {
        await gotoGuarded(page, '/arena'); await page.waitForTimeout(16_000); await openList(page);
        // tag one row of each state: unavailable price (anthropic), no-signals status (nvda); the in-flight ellipsis is the loading word's glyph and is measured by the K cells
        await page.evaluate(() => {
          const tag = (id: string, idx: number, name: string) => { const r = document.querySelector(`[data-testid="scanner-row-${id}"]`); const c = r?.children[idx] as HTMLElement | undefined; if (c) c.setAttribute('data-qa-' + name, '1'); };
          tag('anthropic', 1, 'price'); tag('anthropic', 2, 'h24'); tag('anthropic', 3, 'vsbtc'); tag('nvda', 4, 'status');
        });
        const g: Record<string, Awaited<ReturnType<typeof geom>>> = {};
        for (const n of ['price', 'h24', 'vsbtc', 'status']) g[n] = await geom(page, `[data-qa-${n}="1"]`);
        console.log(`[R2] ${loc} ${JSON.stringify(g)}`);
        await page.screenshot({ path: `qa/.shots/r2-${loc}.png` });
        // since #2253 (price AND 24h gone): the price cell carries the one narrow word (two plain words may wrap on their space), the 24h and vs-BTC cells are EMPTY by design
        for (const [k, v] of Object.entries(g)) {
          expect(v, `${k} cell not found (row anthropic/nvda missing?)`).not.toBeNull();
          expect(v!.overflows, `${k} overflows its cell in ${loc}: ${JSON.stringify(v)}`).toBe(false);
          if (k !== 'h24' && k !== 'vsbtc') expect(v!.clippedBy, `${k} is clipped by ${v!.clippedBy} in ${loc}`).toBe('');
          if (k === 'h24' || k === 'vsbtc') expect(v!.text, `${k} should be empty when the price is gone, in ${loc}`).toBe('');
          else { expect(v!.text, `${k} is empty in ${loc}`).not.toBe(''); expect(v!.h, `${k} is taller than two rows in ${loc}: "${v!.text}" h=${v!.h} (text tops counted ${v!.lines} because the sizes differ)`).toBeLessThanOrEqual(40); }
        }
      } finally { await ctx.close(); }
    });

    test(`R3. landing ticker word for a coin with no quote in ${loc}`, async ({ browser }) => {
      test.skip(loc === 'ar', 'Arabic is not offered and /ar has no landing page (PM 2026-11-14)');
      const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
      await ctx.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); } catch { /* private */ } }, loc);
      const page = await ctx.newPage(); await refuseBinance(page);
      try {
        await gotoGuarded(page, loc === 'en' ? '/' : '/' + loc); await page.waitForTimeout(14_000);
        await page.evaluate(() => { const cells = Array.from(document.querySelectorAll('.lpt-ticker > div')) as HTMLElement[]; const c = cells.find(x => /(^|\s)HYPE(\s|$)/.test(x.innerText)) ?? cells[cells.length - 1]; c?.setAttribute('data-qa-tk', '1'); });
        const t = await geom(page, '[data-qa-tk="1"]');
        console.log(`[R3] ${loc} ${JSON.stringify(t)} url=${page.url()}`);
        await page.screenshot({ path: `qa/.shots/r3-${loc}.png`, clip: { x: 0, y: 0, width: 390, height: 140 } });
        expect(t, 'the ticker cell was not found').not.toBeNull();
        // one ROW: the symbol and the word have different font sizes, so counting distinct text tops (lines) reads 2-3 for a single row; the cell height is the honest measure
        expect(t!.h, `the ticker cell is taller than one row in ${loc}: ${JSON.stringify(t)}`).toBeLessThanOrEqual(36);
        expect(t!.overflows, `the ticker cell overflows its box in ${loc}`).toBe(false);
        expect(t!.docSw, 'the page scrolls sideways').toBeLessThanOrEqual(t!.vw);
      } finally { await ctx.close(); }
    });
  });
}
