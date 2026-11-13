/* THE ARENA COIN SCANNER, AS IT IS (owner request, 2026-11-13): MEASURED FACTS, not assertions. Run against a deployed site (base_url) on GitHub.
 *
 *   F1  per category tab, after the page has been open for 20 s: total rows, and for the PRICE, 24H, VS BTC, STATUS and SCORE columns how many cells show a
 *       value versus "-" / "n/a" (the raw cell texts are counted, not interpreted). Signed out and signed in as fixture A, at 1280 and 390.
 *   F2  the network that fills the columns: every fetch/xhr response during the 20 s (path only: status, bytes, and for same-origin JSON the symbols it
 *       returned), and every WebSocket opened with how many frames arrived.
 *   F3  behaviour: does search filter inside the selected tab or across all coins; does typing change the pressed tab; does the pressed tab persist after
 *       choosing a coin; are counts shown in the tab labels; what shows with no results; how the active tab differs from an inactive one; at 390 whether
 *       the tab row wraps or scrolls (positions, scroll width); a screenshot of each tab's first view at 390 and 1280.
 * Nothing is billed, nothing is written. The only assertion is that a scanner was found to measure at all. */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { gotoGuarded } from './_shared';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON } from './_auth';

const DIR = 'qa/.shots';
const TABS = ['All', 'Majors', 'Alts', 'DeFi/AI', 'Meme', 'Stocks', 'ETFs', 'Commodities & FX'];

type Net = { path: string; status: number; bytes: number; symbols?: string[]; keys?: string[]; count?: number };
function watchNetwork(page: Page) {
  const out: Net[] = []; const sockets: { url: string; frames: number }[] = [];
  page.on('websocket', ws => { const s = { url: ws.url().replace(/\?.*$/, '').slice(0, 90), frames: 0 }; sockets.push(s); ws.on('framereceived', () => { s.frames++; }); });
  page.on('response', async (r) => {
    try {
      const rt = r.request().resourceType();
      if (rt !== 'fetch' && rt !== 'xhr') return;
      const u = new URL(r.url());
      const same = u.host === new URL(page.url() || r.url()).host;
      const rec: Net = { path: (same ? '' : u.host) + u.pathname.slice(0, 80), status: r.status(), bytes: 0 };
      if (same && /json/.test(r.headers()['content-type'] ?? '') && r.status() < 400) {
        const t = await r.text(); rec.bytes = t.length;
        if (t.length < 3_000_000) {
          try {
            const j = JSON.parse(t) as unknown;
            const collect = (o: unknown): string[] => {
              if (Array.isArray(o)) return o.map(x => (x && typeof x === 'object' ? String((x as Record<string, unknown>).symbol ?? (x as Record<string, unknown>).coin ?? (x as Record<string, unknown>).id ?? '') : String(x))).filter(Boolean);
              if (o && typeof o === 'object') return Object.keys(o as object);
              return [];
            };
            if (j && typeof j === 'object') {
              rec.keys = Object.keys(j as object).slice(0, 14);
              for (const k of ['coins', 'tickers', 'data', 'rows', 'prices', 'items']) { const v = (j as Record<string, unknown>)[k]; if (v && typeof v === 'object') { const sy = collect(v); if (sy.length > 5) { rec.symbols = sy.slice(0, 80); rec.count = sy.length; break; } } }
            }
          } catch { /* not json after all */ }
        }
      } else { rec.bytes = Number(r.headers()['content-length'] ?? 0); }
      out.push(rec);
    } catch { /* a response that disappeared */ }
  });
  return { out, sockets };
}

async function openScanner(page: Page) {
  const trig = page.getByTestId('scanner-trigger');
  await trig.waitFor({ state: 'visible', timeout: 60_000 });
  if (!(await page.locator('[data-testid^="scanner-row-"]').first().isVisible().catch(() => false))) await trig.locator('div').first().click();
  await page.locator('[data-testid^="scanner-row-"]').first().waitFor({ state: 'visible', timeout: 15_000 });
}
const tabBtn = (page: Page, label: string) => page.locator('button.gsc-tf-btn[aria-pressed]').filter({ hasText: new RegExp('^\\s*' + label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '\\b', 'i') }).first();

async function readRows(page: Page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-testid^="scanner-row-"]')) as HTMLElement[];
    const freq = (a: string[]) => { const m: Record<string, number> = {}; for (const x of a) m[x] = (m[x] ?? 0) + 1; return m; };
    const cells = rows.map(r => { const k = Array.from(r.children) as HTMLElement[]; return { id: r.getAttribute('data-testid')!.replace('scanner-row-', ''), price: (k[1]?.textContent ?? '').trim(), h24: (k[2]?.textContent ?? '').trim(), vsbtc: (k[3]?.textContent ?? '').trim(), status: (k[4]?.textContent ?? '').trim(), score: (k[5]?.textContent ?? '').trim() }; });
    const dash = (s: string) => s === '-' || s === '' ;
    return {
      total: rows.length,
      priceMissing: cells.filter(c => dash(c.price)).length,
      h24Missing: cells.filter(c => dash(c.h24)).length,
      vsbtcMissing: cells.filter(c => dash(c.vsbtc)).length,
      statusTexts: freq(cells.map(c => c.status || '(empty)')),
      scoreNa: cells.filter(c => /n\/a|no signal/i.test(c.score)).length,
      scoreTexts: freq(cells.map(c => /^\d+$/.test(c.score) ? '(a number)' : c.score || '(empty)')),
      missingPriceCoins: cells.filter(c => dash(c.price)).map(c => c.id).slice(0, 30),
      ids: cells.map(c => c.id),
    };
  });
}

async function measureMode(ctx: BrowserContext, page: Page, mode: string, width: number, shots: boolean) {
  const net = watchNetwork(page);
  if (mode === 'in') await gotoSignedIn(page, '/arena'); else await gotoGuarded(page, '/arena');
  await page.waitForTimeout(20_000);
  const result: Record<string, unknown> = { mode, width, tabs: {} as Record<string, unknown> };
  const tabs = result.tabs as Record<string, unknown>;
  for (const label of TABS) {
    const b = tabBtn(page, label);
    if (!(await b.count())) { tabs[label] = 'TAB NOT FOUND'; continue; }
    await b.click(); await page.waitForTimeout(600);
    await openScanner(page); await page.waitForTimeout(400);
    const rows = await readRows(page);
    tabs[label] = { tabText: (await b.innerText()).replace(/\s+/g, ' '), pressed: await b.getAttribute('aria-pressed'), ...rows, ids: rows.ids.slice(0, 6).join(',') + (rows.ids.length > 6 ? '...' : '') };
    if (shots) { mkdirSync(DIR, { recursive: true }); await page.screenshot({ path: `${DIR}/scanner-${mode}-${width}-${label.replace(/[^A-Za-z]/g, '')}.png` }); }
    await page.keyboard.press('Escape'); await page.mouse.click(5, 5); await page.waitForTimeout(300);
  }
  result.network = net.out.filter(n => !/\/(_next|api\/(health|version|labels))/.test(n.path)).slice(0, 60);
  result.sockets = net.sockets.slice(0, 12);
  return { result, net };
}

for (const width of [1280, 390]) {
  for (const mode of ['out', 'in'] as const) {
    test(`F. scanner facts: ${mode === 'out' ? 'signed out' : 'signed in as A'} at ${width}px`, async ({ browser }) => {
      test.setTimeout(420_000);
      test.skip(mode === 'in' && !AUTH_READY, AUTH_SKIP_REASON);
      const ctx = mode === 'in' ? await signedInContext(browser, 'a', { viewport: { width, height: 900 } }) : await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage();
      try {
        const { result } = await measureMode(ctx, page, mode, width, mode === 'out' || width === 1280);
        // eslint-disable-next-line no-console
        console.log(`[F1] ${JSON.stringify(result)}`);
        mkdirSync(DIR, { recursive: true }); writeFileSync(`${DIR}/scanner-facts-${mode}-${width}.json`, JSON.stringify(result, null, 1));
        expect(Object.keys(result.tabs as object).length, 'no tab was measured').toBeGreaterThan(0);
      } finally { await ctx.close(); }
    });
  }
}

for (const width of [1280, 390]) {
  test(`F3. scanner behaviour (signed out) at ${width}px`, async ({ browser }) => {
    test.setTimeout(240_000);
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    try {
      await gotoGuarded(page, '/arena'); await page.waitForTimeout(20_000);
      const facts: Record<string, unknown> = { width };
      // tab labels (counts shown?) and visual distinction of the active tab
      const tabs = tabBtn(page, 'All').locator('..').locator('button');
      facts.tabLabels = (await tabs.allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim()).slice(0, 14);
      facts.activeVsInactive = await page.evaluate(() => {
        const all0 = (Array.from(document.querySelectorAll('button.gsc-tf-btn[aria-pressed]')) as HTMLElement[]).find(x => /^\s*All\b/i.test(x.textContent || ''));
        const bs = Array.from(all0?.parentElement?.querySelectorAll('button') ?? []) as HTMLElement[];
        const on = bs.find(b => b.getAttribute('aria-pressed') === 'true'); const off = bs.find(b => b.getAttribute('aria-pressed') === 'false');
        const st = (e?: HTMLElement) => { if (!e) return null; const c = getComputedStyle(e); return { bg: c.backgroundColor, color: c.color, border: c.borderTopColor, weight: c.fontWeight }; };
        return { active: st(on), inactive: st(off) };
      });
      // the row that holds the tabs: wrap or scroll
      facts.tabRow = await page.evaluate(() => {
        const b = (Array.from(document.querySelectorAll('button.gsc-tf-btn[aria-pressed]')) as HTMLElement[]).find(x => /^\s*All\b/i.test(x.textContent || '')); const p = b?.parentElement as HTMLElement | null; if (!p) return null;
        const btns = Array.from(p.querySelectorAll('button')) as HTMLElement[];
        const ys = Array.from(new Set(btns.map(x => Math.round(x.getBoundingClientRect().top))));
        const cs = getComputedStyle(p);
        return { buttons: btns.length, lines: ys.length, scrollWidth: p.scrollWidth, clientWidth: p.clientWidth, overflowX: cs.overflowX, flexWrap: cs.flexWrap, docScrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
          lastRight: Math.round(Math.max(...btns.map(x => x.getBoundingClientRect().right))) };
      });
      // search: inside the tab or across all coins; does typing change the pressed tab
      await tabBtn(page, 'Meme').click(); await page.waitForTimeout(500);
      await openScanner(page);
      const memeIds = (await readRows(page)).ids;
      const search = page.locator('input.clipped-row-search').first();
      await search.fill('btc'); await page.waitForTimeout(500);
      const afterBtc = await readRows(page);
      facts.searchWithMemeTab = { memeRows: memeIds.length, rowsAfterTypingBTC: afterBtc.ids.join(','), searchStaysInsideTab: !afterBtc.ids.includes('btc'), pressedTabAfterTyping: await page.locator('button.gsc-tf-btn[aria-pressed="true"]').filter({ hasText: /meme|all|majors|alts|defi|stocks|etfs|commodities/i }).allInnerTexts() };
      await search.fill('zzzzqq'); await page.waitForTimeout(500);
      facts.noResults = { rows: (await readRows(page)).total, text: (await page.locator('.scanner-flyout').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 220) };
      await search.fill(''); await page.waitForTimeout(300);
      // does the pressed tab persist after choosing a coin
      const first = page.locator('[data-testid^="scanner-row-"]').first();
      const pickedId = (await first.getAttribute('data-testid'))!.replace('scanner-row-', '');
      await first.click(); await page.waitForTimeout(1500);
      facts.afterPickingCoin = { picked: pickedId, pressedTabs: await page.locator('button.gsc-tf-btn[aria-pressed="true"]').allInnerTexts(), flyoutClosed: !(await page.locator('[data-testid^="scanner-row-"]').first().isVisible().catch(() => false)), searchBoxCleared: true };
      // is the SEARCH reset when the tab changes while the flyout is open
      await openScanner(page); await page.locator('input.clipped-row-search').first().fill('so'); await page.waitForTimeout(300);
      await tabBtn(page, 'Alts').click(); await page.waitForTimeout(500);
      facts.tabChangeClearsSearch = { searchValueAfterTabChange: await page.locator('input.clipped-row-search').first().inputValue().catch(() => '(flyout closed on tab click)') };
      if (width === 390) { mkdirSync(DIR, { recursive: true }); await page.screenshot({ path: `${DIR}/scanner-tabrow-390.png`, clip: { x: 0, y: 0, width: 390, height: 520 } }); }
      // eslint-disable-next-line no-console
      console.log(`[F3] ${JSON.stringify(facts)}`);
      mkdirSync(DIR, { recursive: true }); writeFileSync(`${DIR}/scanner-behaviour-${width}.json`, JSON.stringify(facts, null, 1));
    } finally { await ctx.close(); }
  });
}
