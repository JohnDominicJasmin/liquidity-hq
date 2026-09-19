import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { SUPABASE_URL, AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { gotoGuarded, getGuarded, servedLabels } from './_shared';

/* #1255 fix, PR #1387 (Dev Team, owner option E): the Russian desktop nav fits from 768px.
 * The PR's "How to test (QA)" names the assertions this file makes:
 *
 *   1. In Russian at 768, 800, 945, 1000, 1100 and 1200px - PRO, TRIAL and signed out -
 *      `.tnav` scrollWidth equals clientWidth and every nav item and the account/sign-in
 *      control is inside the bar. (850, 900 and 1280 are added: the PR's own table has them.)
 *   2. English does not overflow either (control), and the trims are scoped to Russian.
 *   4. The mobile drawer (below 768px, Russian): the Dashboard entry reads the shortened label.
 *
 * tnav-russian-768.spec.ts stays as the single-width instrument for the ORIGINAL report and
 * still carries its test.fail(). This file measures the whole range the fix claims. It has NO
 * test.fail(): it is written for the state after the fix, and against a build without it the
 * Russian sweeps are expected RED. Nothing in it is marked known-failing so that it cannot
 * quietly go green-by-annotation.
 *
 * TWO HALVES, AND THE TESTS KEEP THEM APART. The fix is CSS (this PR) PLUS a database row:
 * NAV_DASHBOARD ru "Панель Управления" -> "Панель" (migration 20260919e, applied by PM/DevOps
 * at release). Dev measured that the CSS alone still overflows (+68px at 768). So:
 *   - the width sweeps say what the page DOES with whatever label the project serves, and
 *     record which label that was in the failure message, so a red before the row is applied
 *     reads as "row missing", not "CSS wrong";
 *   - `the shortened Dashboard label is served` checks the row itself, and the drawer test
 *     checks it renders. Those two are the ones that depend on the row.
 *
 * NOT RUN when written: nothing touches the dev database until PM/DevOps says it answers
 * quickly, and the fix is unmerged. Loaded (`--list`), type-checked and linted only.
 *
 * MEASURED THE WAY tnav-russian-768 MEASURES, including its two traps: a signed-in account's
 * SAVED language beats the local one (so the settings READ is rewritten, never written) and
 * the page paints English first (so the nav text is polled for Cyrillic before measuring).
 * The viewport is resized in place rather than reloading per width: the rules are media
 * queries and the bar re-lays-out; one load per state keeps this to a handful of requests.
 *
 * "Inside the bar" is measured on the elements, not just on scrollWidth: an item pushed past
 * the bar is clipped by overflow rules and scrollWidth alone can read equal in some layouts.
 * TRIAL is a stubbed READ of user_subscriptions (a 14-day window: two-digit days are the worst
 * case Dev measured). Nothing is written to any account. No AI credits. */

const WIDTHS = [768, 800, 850, 900, 945, 1000, 1100, 1200, 1280] as const;
const HEIGHT = 900;

interface Row {
  width: number;
  scrollWidth: number;
  clientWidth: number;
  spare: number;
  pushedOut: string[];
}

/** Everything the tests need from one width. `spare` > 0 is slack, < 0 is overflow. */
async function measureNav(page: Page): Promise<Omit<Row, 'width'>> {
  return page.evaluate(() => {
    const el = document.querySelector('.tnav') as HTMLElement | null;
    if (!el) throw new Error('no .tnav in the document');
    const rect = el.getBoundingClientRect();
    const controls = Array.from(el.querySelectorAll<HTMLElement>('a, button'))
      // A dropdown's menu is positioned out of flow and is not part of the bar's row.
      .filter(c => !c.closest('.tnav-dropdown') && c.getClientRects().length > 0);
    const pushedOut = controls
      .filter(c => c.getBoundingClientRect().right > rect.right + 0.5)
      .map(c => (c.getAttribute('aria-label') || c.textContent || c.className).trim().replace(/\s+/g, ' ').slice(0, 40));
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      spare: el.clientWidth - el.scrollWidth,
      pushedOut,
    };
  });
}

/** Wait for the nav to be in the requested language (the page paints shipped English first). */
async function waitForLanguage(page: Page, lang: 'ru' | 'en') {
  const nav = page.locator('.tnav:visible').first();
  await expect(nav, 'no visible .tnav at desktop width - the desktop nav is not showing, so this measures nothing').toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => /[Ѐ-ӿ]/.test(await nav.innerText()), {
    message: lang === 'ru'
      ? 'the nav never switched to Russian (no Cyrillic after 30s) - measuring the wrong language'
      : 'the nav has Cyrillic in an English run - measuring the wrong language',
    timeout: 30_000,
  }).toBe(lang === 'ru');
}

async function sweep(page: Page, widths: readonly number[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: HEIGHT });
    // Let the media query, the layout and any resize-driven React state settle.
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    await page.waitForTimeout(400);
    rows.push({ width, ...(await measureNav(page)) });
  }
  return rows;
}

const table = (rows: Row[]) => rows.map(r => `${r.width}px: ${r.spare >= 0 ? `ok(${r.spare})` : `+${-r.spare} over`}${r.pushedOut.length ? ` pushed out: ${r.pushedOut.join(', ')}` : ''}`).join(' | ');

function expectAllFit(rows: Row[], what: string, label: string) {
  test.info().annotations.push({ type: `sweep-${what}`, description: table(rows) });
  const bad = rows.filter(r => r.spare < 0 || r.pushedOut.length > 0);
  expect(bad.map(r => r.width),
    `.tnav does not fit at ${bad.map(r => r.width).join(', ')}px (${what}). Dashboard label served: "${label}". ${table(rows)}`).toEqual([]);
}

/** Russian language on a signed-in context WITHOUT writing it: the account's saved language
 *  is overridden on the READ. */
async function forceLanguageOnRead(page: Page, lang: 'ru' | 'en') {
  await page.route(`${SUPABASE_URL}/rest/v1/**`, async route => {
    if (!/user_settings/.test(route.request().url()) || route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch();
    const json = await res.json().catch(() => null);
    const patch = (row: unknown) => (row && typeof row === 'object' ? { ...(row as Record<string, unknown>), language: lang } : row);
    await route.fulfill({ response: res, json: Array.isArray(json) ? json.map(patch) : patch(json) });
  });
}

/** A 14-day trial as a stubbed READ of the subscription row. */
async function stubTrialRead(page: Page) {
  await page.route(`${SUPABASE_URL}/rest/v1/**`, async route => {
    if (!/user_subscriptions/.test(route.request().url())) return route.fallback();
    const row = { role: 'free', trial_ends_at: new Date(Date.now() + 14 * 864e5).toISOString() };
    const single = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(single ? row : [row]) });
  });
}

async function withContext<T>(ctx: BrowserContext, fn: (page: Page) => Promise<T>): Promise<T> {
  try { return await fn(await ctx.newPage()); } finally { await ctx.close(); }
}

async function signedOutContext(browser: Browser, lang: 'ru' | 'en', viewport = { width: 1280, height: HEIGHT }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript((l) => { localStorage.setItem('lhq_lang_v1', l); }, lang);
  return ctx;
}

async function signedInAs(browser: Browser, lang: 'ru' | 'en') {
  const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: HEIGHT } });
  await ctx.addInitScript((l) => { localStorage.setItem('lhq_lang_v1', l); }, lang);
  return ctx;
}

async function servedDashboardLabel(request: import('@playwright/test').APIRequestContext, locale: string): Promise<string> {
  return (await servedLabels(request, locale)).NAV_DASHBOARD;
}

test.describe('.tnav fits in Russian from 768px to 1280px (#1255, PR #1387)', () => {
  test('signed out', async ({ browser, request }) => {
    const label = await servedDashboardLabel(request, 'ru');
    await withContext(await signedOutContext(browser, 'ru'), async page => {
      await gotoGuarded(page, '/markets');
      await waitForLanguage(page, 'ru');
      expectAllFit(await sweep(page, WIDTHS), 'ru signed out', label);
    });
  });

  test.describe('signed in', () => {
    test.skip(!AUTH_READY, AUTH_SKIP_REASON);

    test('PRO badge', async ({ browser, request }) => {
      const label = await servedDashboardLabel(request, 'ru');
      const ctx = await signedInAs(browser, 'ru');
      await withContext(ctx, async page => {
        await forceLanguageOnRead(page, 'ru');
        await gotoSignedIn(page, '/dashboard');
        await waitForLanguage(page, 'ru');
        await expect(page.locator('.tnav:visible .plan-badge').first(), 'no PRO badge in the bar: this is not the PRO state, so the widest signed-in layout was not measured').toBeVisible();
        expectAllFit(await sweep(page, WIDTHS), 'ru PRO', label);
      });
    });

    test('TRIAL badge (14 days, the widest text Dev measured)', async ({ browser, request }) => {
      const label = await servedDashboardLabel(request, 'ru');
      const ctx = await signedInAs(browser, 'ru');
      await withContext(ctx, async page => {
        await forceLanguageOnRead(page, 'ru');
        await stubTrialRead(page);
        await gotoSignedIn(page, '/dashboard');
        await waitForLanguage(page, 'ru');
        await expect(page.locator('.tnav:visible .plan-badge').first(), 'no badge in the bar: the stubbed trial did not take, so the TRIAL layout was not measured').toBeVisible();
        expectAllFit(await sweep(page, WIDTHS), 'ru TRIAL', label);
      });
    });

    test('CONTROL: English fits at the same widths, so the instrument can read "fits" and the Russian result is language-specific', async ({ browser, request }) => {
      const label = await servedDashboardLabel(request, 'en');
      const ctx = await signedInAs(browser, 'en');
      await withContext(ctx, async page => {
        await forceLanguageOnRead(page, 'en');
        await gotoSignedIn(page, '/dashboard');
        await waitForLanguage(page, 'en');
        expectAllFit(await sweep(page, [768, 1000, 1280]), 'en PRO', label);
      });
    });
  });
});

test.describe('the shortened Russian Dashboard label (needs migration 20260919e applied - a red here before release means "row not applied", not a CSS defect)', () => {
  test('/api/labels serves NAV_DASHBOARD ru as the short word, and only ru changed', async ({ request }) => {
    const ru = await (await getGuarded(request, '/api/labels?locale=ru')).json() as Record<string, string>;
    expect(ru.NAV_DASHBOARD, 'NAV_DASHBOARD has no ru database row').toBeTruthy();
    expect(ru.NAV_DASHBOARD.trim(), `the ru Dashboard label is still "${ru.NAV_DASHBOARD}": the CSS trims alone leave the bar overflowing (+68px at 768 by Dev's measurement), the row is the other half`)
      .toBe('Панель');
    const en = (await servedLabels(request, 'en')).NAV_DASHBOARD;
    expect(en, 'the English Dashboard label must be untouched by this PR').toBeTruthy();
    expect(en.toLowerCase(), 'the English Dashboard label looks changed').toContain('dashboard');
  });

  test('the mobile drawer (390px, Russian) shows the served short label on its Dashboard entry', async ({ browser, request }) => {
    const served = await servedDashboardLabel(request, 'ru');
    await withContext(await signedOutContext(browser, 'ru', { width: 390, height: 844 }), async page => {
      await gotoGuarded(page, '/markets');
      const tile = page.locator('.nav-drawer a[href="/dashboard"] .nav-tile-label').first();
      await expect(tile, 'no Dashboard entry in the mobile drawer').toBeAttached({ timeout: 30_000 });
      // The drawer is rendered while closed (aria-hidden), so its text can be read without opening it.
      await expect.poll(async () => (await tile.textContent())?.trim(), {
        message: `the drawer's Dashboard entry does not read the served ru label "${served}"`, timeout: 30_000,
      }).toBe(served.trim());
    });
  });
});
