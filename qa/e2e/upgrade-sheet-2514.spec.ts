/* #2514 EVERY LOCK OPENS THE SAME UPGRADE SHEET (PM 2026-11-17). Free fixture, /arena on HYPE (locked coin) and BTC, 1280 dark. For each lock control found: click it, expect the upgrade dialog (role=dialog, aria-modal) with the SAME label and heading text as the first one seen, Escape closes it, and focus returns to the control that opened it.
 *   gh workflow run ci.yml --ref <branch> -f e2e=true [-f base_url=<url>] -f project=desktop -f "spec=qa/e2e/upgrade-sheet-2514.spec.ts"
 *   US:<coin>   controls tried: top Quick Research, top Deep Research, panel QUICK, panel DEEP, S/R layer chip, Liq clusters chip, Draw Structure, a locked timeframe button (1m), the "With Pro" row (data-testid=locked-feature)
 * One [SHEET] JSON line per control: found / enabled / opened / sheet signature / closed by Escape / focus returned. Soft assertions, so every control is reported even when one fails. A control that is found but DISABLED cannot open anything: that is reported as "disabled", and counts as a failure of "every lock opens the same sheet". Nothing is bought; the paid AI route is fenced. */
import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

/* `hypeOnly`: locks that exist only on a locked coin (on BTC a Free user has Quick, Deep and the S/R / Liq layers, so clicking them runs a read or flips a layer instead of opening a sheet). */
const CONTROLS: Array<{ name: string; hypeOnly?: boolean; locate: (p: Page) => ReturnType<Page['locator']> }> = [
  { name: 'top Quick Research', hypeOnly: true, locate: (p) => p.locator('.arena-quick-btn').first() },
  { name: 'top Deep Research', hypeOnly: true, locate: (p) => p.locator('button.arena-fire-btn').filter({ hasText: /deep/i }).first() },
  { name: 'panel QUICK', hypeOnly: true, locate: (p) => p.locator('.strat-panel .strat-btn').filter({ hasText: /^\s*QUICK\s*$/i }).first() },
  { name: 'panel DEEP', hypeOnly: true, locate: (p) => p.locator('.strat-panel .strat-btn').filter({ hasText: /^\s*DEEP\s*$/i }).first() },
  { name: 'S/R layer chip', hypeOnly: true, locate: (p) => p.getByRole('switch', { name: /s\/r/i }).first() },
  { name: 'Liq clusters chip', hypeOnly: true, locate: (p) => p.getByRole('switch', { name: /liq/i }).first() },
  { name: 'Draw Structure', locate: (p) => p.getByRole('button', { name: /draw structure/i }).first() },
  { name: 'locked timeframe 1m', locate: (p) => p.locator('.klc-tf-btn').filter({ hasText: /^1m$/i }).first() },
  { name: 'With Pro row', locate: (p) => p.locator('[data-testid="locked-feature"]').first() },
];
const dialog = (p: Page) => p.locator('[role="dialog"][aria-modal="true"]').first();

for (const coin of ['hype', 'btc'] as const) {
  test(`US:${coin}: every lock opens the same upgrade sheet; Escape closes it; focus returns`, async ({ browser }) => {
    test.setTimeout(240_000);
    const ctx = await signedInContext(browser, 'b', { viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await ctx.newPage();
    try {
      await installPaidAiFence(page); await gotoSignedIn(page, `/arena?coin=${coin}&tf=1h`); await page.locator('.strat-panel').first().waitFor({ state: 'visible', timeout: 60_000 }); await page.waitForTimeout(12_000);
      let signature = '';
      for (const c of CONTROLS) {
        if (c.hypeOnly && coin !== 'hype') continue;
        const el = c.locate(page); const found = (await el.count()) > 0;
        if (!found) { console.log(`[SHEET] ${JSON.stringify({ coin, control: c.name, found: false })}`); continue; }
        const enabled = await el.isEnabled().catch(() => false), ariaDisabled = (await el.getAttribute('aria-disabled').catch(() => null)) === 'true';
        let opened = false, sig = '', closed = false, focusBack = false;
        if (enabled && !ariaDisabled) {
          await el.scrollIntoViewIfNeeded().catch(() => {}); await el.focus().catch(() => {}); await el.click({ timeout: 8_000 }).catch(() => {}); await page.waitForTimeout(1_200);
          opened = await dialog(page).isVisible().catch(() => false);
          if (opened) { sig = `${await dialog(page).getAttribute('aria-label')} | ${((await dialog(page).locator('h1,h2,h3').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 60)}`; await page.keyboard.press('Escape'); await page.waitForTimeout(800); closed = !(await dialog(page).isVisible().catch(() => false)); focusBack = await el.evaluate((n) => n === document.activeElement || n.contains(document.activeElement)).catch(() => false); }
        }
        console.log(`[SHEET] ${JSON.stringify({ coin, control: c.name, found, enabled: enabled && !ariaDisabled, opened, sig, closedByEscape: closed, focusReturned: focusBack })}`);
        if (!signature && sig) signature = sig;
        expect.soft(enabled && !ariaDisabled, `${coin}: "${c.name}" is a lock but it is DISABLED, so it opens no upgrade sheet`).toBe(true);
        if (enabled && !ariaDisabled) {
          expect.soft(opened, `${coin}: "${c.name}" did not open the upgrade sheet`).toBe(true);
          if (opened) { expect.soft(sig, `${coin}: "${c.name}" opened a DIFFERENT sheet`).toBe(signature); expect.soft(closed, `${coin}: Escape did not close the sheet opened by "${c.name}"`).toBe(true); expect.soft(focusBack, `${coin}: focus did not return to "${c.name}" after Escape`).toBe(true); }
        }
        if (await dialog(page).isVisible().catch(() => false)) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
      }
    } finally { await ctx.close(); }
  });
}
