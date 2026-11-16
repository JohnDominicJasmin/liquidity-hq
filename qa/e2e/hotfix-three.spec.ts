/* THE THREE #2408 CODE-REVIEW FIXES, behaviour in a browser (Dev's hotfix/staging-three-fixes). Run on a CI-local build of the branch (no base_url) or on a deployed build:
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/hotfix-three.spec.ts -f project=desktop
 *   H2  LiqFeed history reads the NEWEST rows: the /rest/v1/liq_events request carries order=ts.desc and limit=5000 (it was ascending, so a day of more than 5000 rows showed the OLDEST 5000).
 *   H3  the strategy menu, with chips ON (fixture A, Pro): 'Let the read choose' (auto) clears the chips AND stays on auto; 'Custom' keeps the chips; with zero chips, 'Custom' stays on Custom; a strategy
 *       picked, then 'Custom': the chips stay. The browser-without-AbortSignal case is legacy-abortsignal.spec.ts; the OI unit is __tests__/oiTrendWindow.test.mts.
 * Fixture A's saved selection is written the way the sibling arena specs write it and put back at the end. Paid AI is fenced; nothing here presses QUICK / DEEP / ASK AI. */
import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installSyntheticSocket } from './_fixtures';
import { installPaidAiFence } from './_no-paid-ai';
import { chip } from './_shared';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

async function saveSelection(page: Page, selection: string[]) {
  await page.evaluate(async (sel) => {
    const raw = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
    const token = raw ? JSON.parse(localStorage.getItem(raw)!).access_token : null;
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ strategy_selection: sel, arena_strategy: null, knownAsOf: { strategy_selection: new Date().toISOString(), arena_strategy: new Date().toISOString() } }),
    });
    localStorage.removeItem('lhq_settings_v1');
    for (const k of Object.keys(localStorage)) if (k.startsWith('lhq_settings_unconfirmed_v1')) localStorage.removeItem(k);
  }, selection);
}

test('H2. the LiqFeed 24 h history asks for the NEWEST rows (order ts desc, limit 5000)', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await signedInContext(browser, 'a');
  const page = await ctx.newPage();
  const asks: string[] = [];
  /* THE TABLE CARRIES AN ENVIRONMENT PREFIX (lib/tables.ts: `${p}liq_events`), so match any prefix: the first run matched the bare name and measured nothing */
  page.on('request', (r) => { if (/\/rest\/v1\/[a-z0-9_]*liq_events/.test(r.url())) asks.push(decodeURIComponent(r.url())); });
  await installSyntheticSocket(page);
  await installPaidAiFence(page);
  try {
    await gotoSignedIn(page, '/arena');
    await expect.poll(() => asks.length, { message: 'the page never asked for the liquidation history, so this run measured nothing', timeout: 30_000 }).toBeGreaterThan(0);
    const q = asks.find((u) => /limit=5000/.test(u)) ?? asks[0];
    console.log(`[HOTFIX] liq history request: ${q.replace(/^.*\/rest\/v1\//, '')}`);
    expect(q, 'the history query is not ordered newest first: with limit=5000 it returns the OLDEST 5000 rows of the window').toMatch(/order=ts\.desc/);
    expect(q).toMatch(/limit=5000/);
  } finally { await ctx.close(); }
});

test('H3. strategy menu with chips on: Let the read choose clears them and stays; Custom keeps them; zero chips + Custom stays Custom; a strategy then Custom keeps its chips', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await signedInContext(browser, 'a');
  const page = await ctx.newPage();
  await installSyntheticSocket(page);
  await installPaidAiFence(page);
  try {
    await gotoSignedIn(page, '/about');
    await saveSelection(page, ['SMA', 'MACD']);
    await page.goto('/arena');
    await expect(page.locator('.plan-badge-pro').first(), "the Pro account's plan never resolved, so menu picks would be no-ops").toBeVisible({ timeout: 45_000 });
    const sel = page.locator('select.strat-sel');
    const sma = chip(page, 'SMA'); const macd = chip(page, 'MACD');
    await expect(sma, 'the saved SMA chip is not on').toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
    await expect(macd).toHaveAttribute('aria-pressed', 'true');
    await expect(sel, 'with chips on and no strategy the menu should read Custom').toHaveValue('custom');

    // 1. Let the read choose, with chips on: the chips clear AND the menu stays on it.
    await sel.selectOption('auto');
    await expect(sma, "'Let the read choose' left the SMA chip on").toHaveAttribute('aria-pressed', 'false', { timeout: 10_000 });
    await expect(macd, "'Let the read choose' left the MACD chip on").toHaveAttribute('aria-pressed', 'false', { timeout: 10_000 });
    await page.waitForTimeout(2_000);
    await expect(sel, "the menu snapped away from 'Let the read choose' (it derived Custom from chips that were still on)").toHaveValue('auto');

    // 2. A chip on, then Custom: the chip stays.
    await sma.click();
    await expect(sma).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
    await sel.selectOption('custom');
    await page.waitForTimeout(1_500);
    await expect(sma, "'Custom' cleared a chip: it must keep them").toHaveAttribute('aria-pressed', 'true');
    await expect(sel).toHaveValue('custom');

    // 3. Zero chips, then Custom: it stays on Custom.
    await sma.click();
    await expect(sma).toHaveAttribute('aria-pressed', 'false', { timeout: 10_000 });
    await sel.selectOption('auto');
    await sel.selectOption('custom');
    await page.waitForTimeout(2_000);
    await expect(sel, "with zero chips, picking 'Custom' fell back to 'Let the read choose'").toHaveValue('custom');

    // 4. A strategy picked, then Custom: whatever chips the strategy turned on stay on.
    const values = await sel.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    const strategy = values.find((v) => v !== 'auto' && v !== 'custom');
    expect(strategy, 'the menu offers no strategy to pick').toBeTruthy();
    await sel.selectOption(strategy!);
    await page.waitForTimeout(2_000);
    const pressed = async () => (await page.locator('button.strat-ind-chip').evaluateAll((els) => els.filter((e) => e.getAttribute('aria-pressed') === 'true').map((e) => e.getAttribute('data-testid') ?? '').sort()));
    const before = await pressed();
    await sel.selectOption('custom');
    await page.waitForTimeout(2_000);
    expect(await pressed(), `'Custom' after a strategy changed the chip set (before: ${JSON.stringify(before)})`).toEqual(before);
    await expect(sel).toHaveValue('custom');
  } finally {
    await saveSelection(page, []).catch(() => {});
    await ctx.close();
  }
});
