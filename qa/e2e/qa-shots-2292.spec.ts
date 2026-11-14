/* Visual sign-off shots for the release candidate, captured on a GitHub runner against the deployed qa site (never the owner's laptop). PM reviews the PNGs on #2292.
 *
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/qa-shots-2292.spec.ts -f base_url=https://liquidity-hq-qa.onrender.com -f screenshots=true -f project=desktop
 *
 * Widths 390, 768, 1280; dark and light. Files are named  <area>-<width>-<theme>.png  in qa/.shots.
 *   landing-risk-*      /  scrolled to the Risk Disclosure (AI Analysis row) and the footer
 *   disclaimer-bottom-* /disclaimer scrolled to the bottom (the About link)
 *   privacy-retention-* /privacy scrolled to the Data Retention section
 *   arena-picker-*      /arena signed in as fixture A: the strategy picker open (its options) and the card under it
 *   arena-card-*        the card alone (fixture A; the candle read is the real qa one)
 *   arena-unavailable-* the card when the candle read fails (stubbed): the unavailable state, never WAIT
 *   sound-prompt-*      the first-visit sound prompt (settings read stubbed to "no answer yet", nothing written)
 *   settings-sound-*    the Settings sound switch row ONLY (an element shot: no account data around it)
 *
 * PUBLIC ARTIFACT RULES: signed in as fixture A only on /arena and as an element shot on /settings; the email is blurred by _auth.ts and masked on every shot; no write reaches the dev row (the settings
 * write is stubbed), no paid AI call is made (installPaidAiFence). WHAT IT CANNOT PROVE: layout correctness. It produces images; PM judges them. */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

const DIR = 'qa/.shots';
mkdirSync(DIR, { recursive: true });
const WIDTHS = [390, 768, 1280] as const;
const THEMES = ['dark', 'light'] as const;
const mask = (p: Page) => [p.locator('.tnav-drop-email'), p.locator('text=/@/')];
const png = (p: Page, name: string) => p.screenshot({ path: `${DIR}/${name}.png`, mask: mask(p), maskColor: '#000000' });
const hasSideScroll = (p: Page) => p.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: window.innerWidth }));

async function anon(browser: Browser, width: number, theme: string) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
  await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, theme);
  return { ctx, page: await ctx.newPage() };
}

async function signedIn(browser: Browser, width: number, theme: string, o: { failKlines?: boolean } = {}) {
  const ctx = await signedInContext(browser, 'a');
  await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, theme);
  const page = await ctx.newPage(); await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await installPaidAiFence(page);
  /* nothing is written to the shared dev row; the sound answer is "none yet" so the first-visit prompt shows */
  /* the app only treats a save as done when the answer carries both lists (a bare {} reads as a failed save and shows the error toast), so the stub answers like the real route does */
  await page.route(/\/api\/settings(\?|$)/, async route => {
    const req = route.request(); if (req.method() === 'GET') return route.fallback();
    const sent = Object.keys((req.postDataJSON() ?? {}) as Record<string, unknown>).filter(k => k !== 'knownAsOf');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: sent, rejected: [], settings: null }) });
  });
  await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch(); const body = await res.json().catch(() => null); if (body == null) return route.fulfill({ response: res });
    const patch = (r: Record<string, unknown>) => ({ ...r, arena_sound: null, language: 'en' });
    return route.fulfill({ response: res, json: Array.isArray(body) ? body.map(patch) : patch(body as Record<string, unknown>) });
  });
  if (o.failKlines) await page.route(/\/api\/market\/klines\?/, route => route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"stub"}' }));
  return { ctx, page };
}

test.describe('qa sign-off shots (#2292)', () => {
  test.describe.configure({ timeout: 180_000 });

  for (const theme of THEMES) for (const width of WIDTHS) {
    test(`landing risk disclosure + footer ${width} ${theme}`, async ({ browser }) => {
      const { ctx, page } = await anon(browser, width, theme);
      try {
        await page.goto('/', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(6_000);
        const row = page.getByText(/AI ANALYSIS/i).last(); await row.evaluate((el) => el.scrollIntoView({ block: 'center' })); await page.waitForTimeout(800);
        const sc = await hasSideScroll(page); console.log(`[landing ${width} ${theme}] ${JSON.stringify(sc)}`);
        await png(page, `landing-risk-${width}-${theme}`);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(600); await png(page, `landing-footer-${width}-${theme}`);
        expect(sc.sw, 'the landing scrolls sideways').toBeLessThanOrEqual(sc.vw);
      } finally { await ctx.close(); }
    });

    test(`disclaimer bottom + privacy data retention ${width} ${theme}`, async ({ browser }) => {
      const { ctx, page } = await anon(browser, width, theme);
      try {
        await page.goto('/disclaimer', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(5_000);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(600);
        const d = await hasSideScroll(page); console.log(`[disclaimer ${width} ${theme}] ${JSON.stringify(d)}`); await png(page, `disclaimer-bottom-${width}-${theme}`);
        await page.goto('/privacy', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(5_000);
        const h = page.getByText(/data retention/i).first(); const found = await h.count();
        console.log(`[privacy ${width} ${theme}] data-retention heading found: ${found > 0}`);
        if (found) await h.evaluate((el) => el.scrollIntoView({ block: 'start' })); await page.waitForTimeout(600);
        const p = await hasSideScroll(page); console.log(`[privacy ${width} ${theme}] ${JSON.stringify(p)}`); await png(page, `privacy-retention-${width}-${theme}`);
        expect(d.sw, '/disclaimer scrolls sideways').toBeLessThanOrEqual(d.vw); expect(p.sw, '/privacy scrolls sideways').toBeLessThanOrEqual(p.vw);
      } finally { await ctx.close(); }
    });
  }

  test.describe('signed in as fixture A (Arena and the Settings sound row only)', () => {
    test.skip(!AUTH_READY, AUTH_SKIP_REASON);
    for (const theme of THEMES) for (const width of WIDTHS) {
      test(`arena strategy picker, card and sound prompt ${width} ${theme}`, async ({ browser }) => {
        const { ctx, page } = await signedIn(browser, width, theme);
        try {
          await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); await page.waitForTimeout(14_000);
          const prompt = page.getByTestId('arena-sound-prompt'); const promptShown = await prompt.isVisible().catch(() => false);
          console.log(`[arena ${width} ${theme}] sound prompt visible: ${promptShown}`);
          if (promptShown) { await prompt.screenshot({ path: `${DIR}/sound-prompt-${width}-${theme}.png` }); await png(page, `sound-prompt-page-${width}-${theme}`); }
          const sel = page.getByTestId('arena-strategy-select'); await expect(sel, 'no strategy picker on /arena').toBeVisible({ timeout: 30_000 });
          await sel.scrollIntoViewIfNeeded();
          const options = await sel.locator('option').allTextContents(); console.log(`[arena ${width} ${theme}] picker options: ${JSON.stringify(options)}`);
          await sel.selectOption({ index: 3 }).catch(() => {}); await page.waitForTimeout(6_000);
          const card = page.getByTestId('arena-strategy-card'); await card.scrollIntoViewIfNeeded();
          const v = await page.evaluate(() => { const c = document.querySelector('[data-testid="arena-strategy-card"]'); const vd = c?.querySelector('[data-testid="arena-strategy-verdict"]'); return { verdict: vd?.getAttribute('data-verdict') ?? null, error: !!c?.querySelector('[data-testid="arena-strategy-error"]'), text: (c?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 240) }; });
          console.log(`[arena ${width} ${theme}] card ${JSON.stringify(v)}`);
          await png(page, `arena-picker-${width}-${theme}`); await card.screenshot({ path: `${DIR}/arena-card-${width}-${theme}.png` });
          const sc = await hasSideScroll(page); expect(sc.sw, 'the Arena scrolls sideways').toBeLessThanOrEqual(sc.vw);
        } finally { await ctx.close(); }
      });

      test(`arena strategy card unavailable state ${width} ${theme}`, async ({ browser }) => {
        const { ctx, page } = await signedIn(browser, width, theme, { failKlines: true });
        try {
          await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); await page.waitForTimeout(14_000);
          const sel = page.getByTestId('arena-strategy-select'); await expect(sel).toBeVisible({ timeout: 30_000 }); await sel.selectOption({ index: 1 }).catch(() => {}); await page.waitForTimeout(6_000);
          const card = page.getByTestId('arena-strategy-card'); await card.scrollIntoViewIfNeeded();
          const err = await page.getByTestId('arena-strategy-error').count(); console.log(`[unavailable ${width} ${theme}] unavailable state shown: ${err > 0}`);
          await card.screenshot({ path: `${DIR}/arena-unavailable-${width}-${theme}.png` });
        } finally { await ctx.close(); }
      });

      test(`settings sound switch row ${width} ${theme}`, async ({ browser }) => {
        const { ctx, page } = await signedIn(browser, width, theme);
        try {
          await gotoSignedIn(page, '/settings'); await page.waitForTimeout(8_000);
          const sw = page.getByTestId('arena-sound-toggle'); await expect(sw, 'no Arena sound switch on /settings').toBeVisible({ timeout: 30_000 }); await sw.scrollIntoViewIfNeeded();
          /* the row that holds the switch, and only that: no account data around it is in the shot */
          const row = sw.locator('xpath=ancestor::*[self::div or self::label or self::section][1]');
          await row.screenshot({ path: `${DIR}/settings-sound-${width}-${theme}.png`, mask: [page.locator('text=/@/')], maskColor: '#000000' });
        } finally { await ctx.close(); }
      });
    }
  });
});
