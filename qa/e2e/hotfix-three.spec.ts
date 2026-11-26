/* THE THREE #2408 CODE-REVIEW FIXES, behaviour in a browser (Dev's hotfix/staging-three-fixes). Run on a CI-local build of the branch (no base_url) or on a deployed build:
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/hotfix-three.spec.ts -f project=desktop
 *   H2  LiqFeed history reads the NEWEST rows in PAGES (#2767: supabase-js .range(), offset + limit 1000): every liq_events request carries order=ts.desc, offset and limit=1000 (never limit=5000, the cap the API ignores: it answers 1000 rows); the all-coins read has no coin= filter, the per-coin read has coin=in.(<the selected coin's stored names>); at most 8 liq_events requests on load (5 pages all coins + 3 for the coin).
 *   H3  the strategy menu, with chips ON (fixture A, Pro): 'Let the read choose' (auto) clears the chips AND stays on auto; 'Custom' keeps the chips; with zero chips, 'Custom' stays on Custom; a strategy
 *       picked, then 'Custom': the chips stay. The browser-without-AbortSignal case is legacy-abortsignal.spec.ts; the OI unit is __tests__/oiTrendWindow.test.mts.
 * Fixture A's saved selection is written the way the sibling arena specs write it and put back at the end. Paid AI is fenced; nothing here presses QUICK / DEEP / ASK AI. */
import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installSyntheticSocket } from './_fixtures';
import { installPaidAiFence } from './_no-paid-ai';
import { chip } from './_shared';
import { writesAccountA } from './_one-at-a-time';

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

test('H2. the LiqFeed history asks for the NEWEST rows in pages (order ts desc, offset, limit 1000); all-coins read without coin=, coin read with coin=in.(...), at most 8 asks', async ({ browser }) => {
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
    await page.waitForTimeout(10_000);   /* the pages and the per-coin read are separate requests: let them all go out before counting */
    const short = asks.map((u) => u.replace(/^.*\/rest\/v1\//, ''));
    console.log(`[HOTFIX] ${asks.length} liq_events request(s):\n  ${short.join('\n  ')}`);
    const wide = asks.filter((u) => !/[?&]coin=/.test(u)), perCoin = asks.filter((u) => /[?&]coin=in\.\(/.test(u));
    for (const u of asks) {
      expect(u, `a liq_events request is not ordered newest first: ${u}`).toMatch(/order=ts\.desc/);
      expect(u, `a liq_events request has no offset (a paged read): ${u}`).toMatch(/[?&]offset=\d+/);
      expect(u, `a liq_events request does not ask for limit=1000, the most the API returns: ${u}`).toMatch(/[?&]limit=1000(&|$)/);
      expect(u, `limit=5000 is back: the API answers 1000 rows and the rest of the window is silently lost: ${u}`).not.toMatch(/limit=5000/);
    }
    expect(perCoin.length, 'no per-coin liq_events read (coin=in.(...)) went out for the selected coin').toBeGreaterThan(0);
    /* the page reads the SELECTED coin and one more per-coin set (ETH on staging 2295543): each per-coin read names at least one coin, and one of them names the selected coin (BTC) */
    for (const u of perCoin) expect(u, `a per-coin read names no coin: ${u}`).toMatch(/coin=in\.\([A-Za-z0-9_,.-]+\)/);
    expect(perCoin.some((u) => /coin=in\.\([^)]*BTC/i.test(u)), `no per-coin read names the selected coin (BTC): ${perCoin.join(' | ')}`).toBe(true);
    for (const u of wide) expect(u, `the all-coins read carries a coin filter after all: ${u}`).not.toMatch(/coin=/);
    console.log(`[HOTFIX] all-coins reads ${wide.length} (first offset ${/offset=(\d+)/.exec(wide[0] ?? '')?.[1] ?? 'n/a'}) · per-coin reads ${perCoin.length} · total ${asks.length}`);
    expect(asks.length, `${asks.length} liq_events requests on load (budget 8: 5 pages for all coins + 3 for the coin)`).toBeLessThanOrEqual(8);
  } finally { await ctx.close(); }
});

/* Only H3 saves to the account; H2 reads, so it still runs on both legs. */
test.describe('saves to fixture A', () => {
  writesAccountA(test);

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
});
