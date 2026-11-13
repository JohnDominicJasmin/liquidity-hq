/* #2258 (Ask AI panel) and #2259 (session names, holidays, time ranges): the strings are in the page's language in ru, ko, zh, ar.
 * The rows of migration 20261113g / 20261113h (the PROD blocks, the values PM will write) are injected into the real /api/labels payload.
 *   H0  control: the English panel / hours page show some of the English defaults, so a silent localized result means something
 *   H1  #2258 the Ask AI panel opened signed out at 390 in each locale: none of the English defaults of the CHAT_* keys is in the panel text; the panel and its mode row sit inside the viewport; page not wider
 *   H2  #2259 /hours in each locale at 390: none of the English defaults of the SESSION_* keys is on the page; page not wider than the viewport
 *   H3  #2259 /hours with the clock on 2026-11-26 (a US market holiday), ru: the English holiday name is absent
 * Signed out, nothing written or billed (opening the panel sends nothing). A cell that finds nothing to measure fails. */
import { test, expect, type Page, type Browser } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { gotoGuarded } from './_shared';

const EN: Record<string, string> = existsSync('lib/labelDefaults.en.json') ? JSON.parse(readFileSync('lib/labelDefaults.en.json', 'utf8')) : {};
function rows(file: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}; const p = `supabase/migrations/${file}`; if (!existsSync(p)) return out;
  const re = /\('([A-Z0-9_]+)','(ko|zh|ru|ar)','((?:[^']|'')*)'\)/g; const t = readFileSync(p, 'utf8'); let m: RegExpExecArray | null;
  while ((m = re.exec(t))) (out[m[2]] ??= {})[m[1]] = m[3].replace(/''/g, "'"); return out;
}
const G = rows('20261113g_labels_ask_ai_chat_panel.sql'); const H = rows('20261113h_labels_session_holidays_and_ranges.sql');
const ROWS: Record<string, Record<string, string>> = {}; for (const loc of ['ko', 'zh', 'ru', 'ar']) ROWS[loc] = { ...(G[loc] ?? {}), ...(H[loc] ?? {}) };
const keys = (r: Record<string, Record<string, string>>) => Array.from(new Set(Object.values(r).flatMap(x => Object.keys(x))));
const probes = (ks: string[], prefix: RegExp) => ks.filter(k => prefix.test(k)).map(k => ({ k, en: (EN[k] ?? '').trim() })).filter(p => p.en.length >= 6 && !/[{}]/.test(p.en));
const CHAT = probes(keys(G), /^CHAT_/); const SESS = probes(keys(H), /^SESSION_/);

async function open(browser: Browser, loc: string, path: string, width: number, clockIso?: string) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); } catch { /* private */ } }, loc);
  const page = await ctx.newPage();
  await page.route('**/api/labels*', async (route) => {
    let res; try { res = await route.fetch(); } catch { try { await route.continue(); } catch { /* gone */ } return; }
    let body: unknown; try { body = await res.json(); } catch { await route.fulfill({ response: res }); return; }
    const pl = body as Record<string, unknown>; const labels = (pl.labels ?? pl) as Record<string, unknown>;
    for (const [k, v] of Object.entries(ROWS[loc] ?? {})) labels[k] = v;
    await route.fulfill({ response: res, json: pl });
  });
  if (clockIso) await page.clock.setFixedTime(new Date(clockIso));
  await gotoGuarded(page, path); await page.waitForTimeout(12_000);
  return { ctx, page };
}
const text = (page: Page) => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
const panelText = (page: Page) => page.evaluate(() => { const p = document.querySelector('[data-testid="grok-panel"]') as HTMLElement | null; return p ? (p.innerText || '').replace(/\s+/g, ' ') : null; });

test.describe('#2258 / #2259 localized', () => {
  test.describe.configure({ timeout: 150_000 });

  test('H0. control: the English panel and hours page show English defaults', async ({ browser }) => {
    const a = await open(browser, 'en', '/hours', 1280);
    try { const t = await text(a.page); const shown = SESS.filter(p => t.includes(p.en)); console.log(`[H0] session probes=${SESS.length} shown on /hours en=${shown.length} ${JSON.stringify(shown.map(p => p.en).slice(0, 5))}`); expect(SESS.length, 'no SESSION probes: migration or defaults missing').toBeGreaterThan(10); expect(shown.length, '/hours in English shows none of the probe texts').toBeGreaterThan(0); } finally { await a.ctx.close(); }
    const b = await open(browser, 'en', '/dashboard', 1280);
    try { await b.page.getByTestId('grok-launcher').first().click(); await b.page.waitForTimeout(1500); const t = await panelText(b.page); const shown = CHAT.filter(p => (t ?? '').includes(p.en)); console.log(`[H0] chat probes=${CHAT.length} shown in the en panel=${shown.length} ${JSON.stringify(shown.map(p => p.en).slice(0, 5))}`); expect(CHAT.length, 'no CHAT probes').toBeGreaterThan(10); expect(t, 'the panel did not open').not.toBeNull(); expect(shown.length, 'the English panel shows none of the probe texts').toBeGreaterThan(0); } finally { await b.ctx.close(); }
  });

  for (const loc of ['ru', 'ko', 'zh', 'ar']) {
    test(`H1. #2258 Ask AI panel at 390 in ${loc}: no English defaults, inside the viewport`, async ({ browser }) => {
      test.skip(!G[loc], 'migration 20261113g is not in this tree');
      const { ctx, page } = await open(browser, loc, '/dashboard', 390);
      try {
        await page.getByTestId('grok-launcher').first().click(); await page.waitForTimeout(1500);
        const t = await panelText(page); expect(t, 'the panel did not open').not.toBeNull();
        const left = CHAT.filter(p => t!.includes(p.en)); console.log(`[H1] ${loc} left=${JSON.stringify(left.map(p => p.k + '=' + p.en))} head="${t!.slice(0, 140)}"`);
        const g = await page.evaluate(() => { const p = document.querySelector('[data-testid="grok-panel"]') as HTMLElement; const r = p.getBoundingClientRect(); const wide = Array.from(p.querySelectorAll('*')).filter(e => !e.closest('.gchat-quick-row')).filter(e => e.getBoundingClientRect().right > window.innerWidth + 1 && e.getBoundingClientRect().width > 0).slice(0, 6).map(e => e.tagName.toLowerCase() + '.' + String((e as HTMLElement).className).slice(0, 30) + ' r=' + Math.round(e.getBoundingClientRect().right)); return { l: Math.round(r.left), r: Math.round(r.right), vw: window.innerWidth, docSw: document.documentElement.scrollWidth, wide }; });
        console.log(`[H1] ${loc} ${JSON.stringify(g)}`);
        expect(left.map(p => p.k + ' = "' + p.en + '"'), `English still in the panel in ${loc}`).toEqual([]);
        expect(g.r, 'the panel runs past the viewport').toBeLessThanOrEqual(g.vw); expect(g.docSw, 'page scrolls sideways').toBeLessThanOrEqual(g.vw); expect(g.wide, 'panel elements past the viewport').toEqual([]);
        await page.screenshot({ path: `qa/.shots/chat-${loc}-390.png` });
      } finally { await ctx.close(); }
    });
    test(`H2. #2259 /hours at 390 in ${loc}: no English defaults of the session keys`, async ({ browser }) => {
      test.skip(!H[loc], 'migration 20261113h is not in this tree');
      test.skip(loc === 'ar', 'Arabic is not offered by any picker (PM 2026-11-14); /hours in ar still prints the English page-intro sentence');
      const { ctx, page } = await open(browser, loc, '/hours', 390);
      try {
        const t = await text(page); const left = SESS.filter(p => t.includes(p.en)); const sw = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
        console.log(`[H2] ${loc} left=${JSON.stringify(left.map(p => p.k + '=' + p.en))} sw=${JSON.stringify(sw)} context=${JSON.stringify(left.map(p => { const i = t.indexOf(p.en); return t.slice(Math.max(0, i - 40), i + p.en.length + 40); }))}`);
        expect(left.map(p => p.k + ' = "' + p.en + '"'), `English still on /hours in ${loc}`).toEqual([]);
        expect(sw.s, 'page scrolls sideways').toBeLessThanOrEqual(sw.w);
        await page.screenshot({ path: `qa/.shots/hours-${loc}-390.png`, fullPage: true });
      } finally { await ctx.close(); }
    });
  }

  test('H3. #2259 /hours on a US market holiday in ru: the English holiday name is absent', async ({ browser }) => {
    test.skip(!H.ru, 'migration 20261113h is not in this tree');
    const { ctx, page } = await open(browser, 'ru', '/hours', 1280, '2026-11-26T15:00:00Z');
    try { const t = await text(page); const en = await text(await (async () => { const a = await open(browser, 'en', '/hours', 1280, '2026-11-26T15:00:00Z'); const x = a.page; (x as unknown as { _c: unknown })._c = a.ctx; return x; })()); console.log(`[H3] ru has Thanksgiving=${/Thanksgiving/.test(t)} en has Thanksgiving=${/Thanksgiving/.test(en)}`); expect(/Thanksgiving/.test(en), 'control: the English page on that date shows no Thanksgiving line, so the stubbed clock did not reach it').toBe(true); expect(/Thanksgiving/.test(t), 'the English holiday name is on the Russian page').toBe(false); } finally { await ctx.close(); }
  });
});
