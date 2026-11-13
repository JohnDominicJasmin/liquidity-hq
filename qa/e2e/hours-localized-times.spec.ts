/* #2267: /hours in ko, zh, ru reads 24-hour times, the language's own weekday names and its own countdown units; English is unchanged.
 * Label rows of migrations 20261113h and 20261113j (PROD blocks, the values PM will write) are injected into the real /api/labels payload.
 *   T0  control: the English page still reads AM/PM or an English weekday, so the checks below can fire
 *   T1  ru, ko, zh at 1280: no AM/PM, no English weekday abbreviation (Mon..Sun), no "2h 19m"-style countdown anywhere on /hours
 *   T2  ru at 390: same, the page is 390 wide, and a shot of the full page is written (qa/.shots/hours-ru-390.png)
 * Signed out, nothing written or billed. A cell that finds nothing to measure fails. */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { gotoGuarded } from './_shared';

mkdirSync('qa/.shots', { recursive: true });
function rows(file: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}; const p = `supabase/migrations/${file}`; if (!existsSync(p)) return out;
  const re = /\('([A-Z0-9_]+)','(ko|zh|ru|ar)','((?:[^']|'')*)'\)/g; const t = readFileSync(p, 'utf8'); let m: RegExpExecArray | null;
  while ((m = re.exec(t))) (out[m[2]] ??= {})[m[1]] = m[3].replace(/''/g, "'"); return out;
}
const H = rows('20261113h_labels_session_holidays_and_ranges.sql'); const J = rows('20261113j_labels_hours_durations.sql');
const ROWS: Record<string, Record<string, string>> = {}; for (const loc of ['ko', 'zh', 'ru', 'ar']) ROWS[loc] = { ...(H[loc] ?? {}), ...(J[loc] ?? {}) };

async function open(browser: Browser, loc: string, width: number) {
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
  await gotoGuarded(page, '/hours'); await page.waitForTimeout(12_000);
  return { ctx, page };
}
const text = (page: Page) => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
const AMPM = /\b\d{1,2}:\d{2}(:\d{2})?\s?(AM|PM)\b|\b(AM|PM)\b/;
const WEEKDAY = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/;
const HMS = /\b\d+h\s+\d+m\b|\b\d+h\s+\d+m\s+\d+s\b/;

test.describe('#2267 hours localized times', () => {
  test.describe.configure({ timeout: 150_000 });

  test('T0. control: the English /hours has AM/PM, an English weekday or an h/m countdown', async ({ browser }) => {
    const { ctx, page } = await open(browser, 'en', 1280);
    try { const t = await text(page); const hit = { ampm: AMPM.test(t), weekday: WEEKDAY.test(t), hms: HMS.test(t) }; console.log(`[T0] ${JSON.stringify(hit)} sample="${(t.match(/(\d+h \d+m[^.]{0,20}|\d{1,2}:\d{2}[^.]{0,30})/) || [''])[0]}"`); expect(hit.ampm || hit.weekday || hit.hms, 'the English page shows none of the patterns the localized cells forbid').toBe(true); } finally { await ctx.close(); }
  });

  for (const loc of ['ru', 'ko', 'zh']) {
    test(`T1. /hours in ${loc} at 1280: 24-hour, own weekdays, own countdown units`, async ({ browser }) => {
      test.skip(!J[loc], 'migration 20261113j is not in this tree');
      const { ctx, page } = await open(browser, loc, 1280);
      try {
        const t = await text(page); const hit = { ampm: (t.match(AMPM) || [''])[0], weekday: (t.match(WEEKDAY) || [''])[0], hms: (t.match(HMS) || [''])[0] };
        console.log(`[T1] ${loc} ${JSON.stringify(hit)} clockSample="${(t.match(/\d{1,2}:\d{2}:\d{2}[^.]{0,24}/) || [''])[0]}" away="${(t.match(/[^ ]{0,12}\d+[^ ]{0,4} [^ ]{0,10}\d+[^ ]{0,6}[^.]{0,16}/) || [''])[0]}"`);
        expect(hit.ampm, `AM/PM on /hours in ${loc}`).toBe(''); expect(hit.weekday, `English weekday on /hours in ${loc}`).toBe(''); expect(hit.hms, `an h/m countdown on /hours in ${loc}`).toBe('');
      } finally { await ctx.close(); }
    });
  }

  test('T2. /hours in ru at 390: same checks, page 390 wide, shot written', async ({ browser }) => {
    test.skip(!J.ru, 'migration 20261113j is not in this tree');
    const { ctx, page } = await open(browser, 'ru', 390);
    try {
      const t = await text(page); const sw = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
      await page.screenshot({ path: 'qa/.shots/hours-ru-390.png', fullPage: true });
      console.log(`[T2] ${JSON.stringify({ ampm: AMPM.test(t), weekday: WEEKDAY.test(t), hms: HMS.test(t), sw })}`);
      expect(AMPM.test(t), 'AM/PM on /hours in ru').toBe(false); expect(WEEKDAY.test(t), 'English weekday on /hours in ru').toBe(false); expect(HMS.test(t), 'an h/m countdown on /hours in ru').toBe(false);
      expect(sw.s, 'page scrolls sideways').toBeLessThanOrEqual(sw.w);
    } finally { await ctx.close(); }
  });
});
