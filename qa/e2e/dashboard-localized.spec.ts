/* #2257 (#1185): /dashboard in ru, ko, zh, ar: the market read, the card titles, the session pill and the Ask AI button are in the page's language.
 * The rows of migration 20261113f (the PROD block, the values PM will write) are injected into the real /api/labels payload, because the table is not written yet.
 *   D0  control: the English page DOES show some of the default texts, so a silent localized result means something
 *   D1  every English default of a key the migration carries (whole text, no placeholder, >= 6 characters) is ABSENT from the visible text of /dashboard in that locale
 *   D2  /dashboard at 390: the page is 390 wide, nothing outside the nav drawer and the quick-question scroll row is past the viewport, the Ask AI button (data-testid grok-launcher) sits inside the viewport
 * Signed out, nothing written or billed. */
import { test, expect, type Page, type Browser } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { gotoGuarded } from './_shared';

const FILE = 'supabase/migrations/20261113f_labels_dashboard_market_read_and_session_names.sql';
const EN: Record<string, string> = existsSync('lib/labelDefaults.en.json') ? JSON.parse(readFileSync('lib/labelDefaults.en.json', 'utf8')) : {};
const ROWS: Record<string, Record<string, string>> = (() => { const out: Record<string, Record<string, string>> = {}; if (!existsSync(FILE)) return out; const re = /\('([A-Z0-9_]+)','(ko|zh|ru|ar)','((?:[^']|'')*)'\)/g; const t = readFileSync(FILE, 'utf8'); let m: RegExpExecArray | null; while ((m = re.exec(t))) (out[m[2]] ??= {})[m[1]] = m[3].replace(/''/g, "'"); return out; })();
const KEYS = Array.from(new Set(Object.values(ROWS).flatMap(r => Object.keys(r)))).filter(k => /^(MARKET_READ_TXT_|SESSION_NAME_|GROK_FAB_)/.test(k));
const PROBES = KEYS.map(k => ({ k, en: (EN[k] ?? '').trim() })).filter(p => p.en.length >= 6 && !/[{}]/.test(p.en));

async function inject(page: Page, loc: string) {
  await page.route('**/api/labels*', async (route) => {
    let res; try { res = await route.fetch(); } catch { try { await route.continue(); } catch { /* gone */ } return; }
    let body: unknown; try { body = await res.json(); } catch { await route.fulfill({ response: res }); return; }
    const pl = body as Record<string, unknown>; const labels = (pl.labels ?? pl) as Record<string, unknown>;
    for (const [k, v] of Object.entries(ROWS[loc] ?? {})) labels[k] = v;
    await route.fulfill({ response: res, json: pl });
  });
}
const open = async (browser: Browser, loc: string, path: string, width: number) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); } catch { /* private */ } }, loc);
  const page = await ctx.newPage(); await inject(page, loc); await gotoGuarded(page, path); await page.waitForTimeout(12_000);
  return { ctx, page };
};
const pageText = (page: Page) => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));

test.describe('#2257 dashboard localized', () => {
  test.describe.configure({ timeout: 150_000 });

  test('D0. control: the English page shows some of the default texts', async ({ browser }) => {
    const { ctx, page } = await open(browser, 'en', '/dashboard', 1280);
    try {
      const t = await pageText(page); const shown = PROBES.filter(p => t.includes(p.en));
      console.log(`[D0] probes=${PROBES.length} shown in en=${shown.length} ${JSON.stringify(shown.map(p => p.en).slice(0, 8))}`);
      expect(PROBES.length, 'no probes: migration or defaults missing from this tree').toBeGreaterThan(10);
      expect(shown.length, 'the English page shows none of the probe texts').toBeGreaterThan(0);
    } finally { await ctx.close(); }
  });

  for (const loc of ['ru', 'ko', 'zh', 'ar']) {
    test(`D1. /dashboard in ${loc}: none of the English defaults of the new keys is on the page`, async ({ browser }) => {
      test.skip(!ROWS[loc], 'migration 20261113f is not in this tree');
      const { ctx, page } = await open(browser, loc, '/dashboard', 1280);
      try {
        const t = await pageText(page); const left = PROBES.filter(p => t.includes(p.en));
        console.log(`[D1] ${loc} left=${JSON.stringify(left.map(p => p.k + '=' + p.en))}`);
        expect(left.map(p => p.k + ' = "' + p.en + '"'), `English still on /dashboard in ${loc}`).toEqual([]);
        const fab = (await page.getByTestId('grok-launcher').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
        console.log(`[D1] ${loc} ask-ai="${fab}"`);
        expect(fab, `the Ask AI button still reads English in ${loc}`).not.toMatch(/^\W*Ask AI\W*$/i);
      } finally { await ctx.close(); }
    });
  }

  for (const loc of ['ru', 'ko', 'zh', 'ar']) {
    test(`D2. /dashboard at 390 in ${loc}: page 390 wide, Ask AI button inside the viewport`, async ({ browser }) => {
      test.skip(!ROWS[loc], 'migration 20261113f is not in this tree');
      const { ctx, page } = await open(browser, loc, '/dashboard', 390);
      try {
        const m = await page.evaluate(() => {
          const vw = window.innerWidth; const fab = document.querySelector('[data-testid="grok-launcher"]') as HTMLElement | null; const fr = fab?.getBoundingClientRect();
          const wide = Array.from(document.querySelectorAll('body *')).filter(e => !e.closest('#nav-drawer') && !e.closest('.nav-drawer') && !e.closest('.gchat-quick-row')).map(e => ({ e, r: e.getBoundingClientRect() })).filter(x => x.r.width > 0 && x.r.right > vw + 1)
            .map(x => ({ el: x.e.tagName.toLowerCase() + '.' + String((x.e as HTMLElement).className).slice(0, 30), right: Math.round(x.r.right), text: (x.e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30) }));
          return { docSw: document.documentElement.scrollWidth, vw, fab: fr ? { l: Math.round(fr.left), r: Math.round(fr.right), w: Math.round(fr.width), text: (fab!.innerText || '').replace(/\s+/g, ' ').trim() } : null, wide: wide.slice(0, 8) };
        });
        console.log(`[D2] ${loc} ${JSON.stringify(m)}`);
        expect(m.docSw, 'page scrolls sideways').toBeLessThanOrEqual(m.vw);
        expect(m.wide, 'elements past the viewport').toEqual([]);
        expect(m.fab, 'no Ask AI button').not.toBeNull();
        expect(m.fab!.r, 'the Ask AI button runs past the viewport').toBeLessThanOrEqual(m.vw);
        expect(m.fab!.l, 'the Ask AI button starts off screen').toBeGreaterThanOrEqual(0);
      } finally { await ctx.close(); }
    });
  }
});

test.describe('#2257 sign-off shots', () => {
  test.describe.configure({ timeout: 150_000 });
  for (const loc of ['ru', 'ko', 'zh', 'ar']) {
    test(`S. /dashboard at 390 in ${loc} dark`, async ({ browser }) => {
      test.skip(!ROWS[loc], 'migration 20261113f is not in this tree');
      const { ctx, page } = await open(browser, loc, '/dashboard', 390);
      try { await page.screenshot({ path: `qa/.shots/dash-${loc}-390.png`, fullPage: true }); } finally { await ctx.close(); }
    });
  }
});
