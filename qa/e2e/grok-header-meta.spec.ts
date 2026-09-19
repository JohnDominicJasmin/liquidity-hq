import { test, expect, type Page, type Browser } from '@playwright/test';
import { gotoSignedIn, signedInContext, AUTH_READY, AUTH_SKIP_REASON } from './_auth';

/**
 * The Grok chat header's quota meta must never wrap into the header row or
 * push the Fast/Live pill above it (#995, owner-reported: "chatbot text is
 * ugly now").
 *
 * WHY THIS IS A NUMERIC CHECK, NOT A SNAPSHOT. A pixel-diff baseline captured
 * before #998 landed would have enshrined the broken layout as correct and
 * passed forever - the header shipped ugly BECAUSE nothing was comparing it
 * to anything, and a snapshot is exactly "compared to what shipped last
 * time". `scrollWidth <= clientWidth` on the wrapping spans and the pill's
 * `top >= header.bottom` assert a PROPERTY the layout must hold, which a
 * broken build cannot satisfy no matter when the baseline was taken. See
 * CONTRIBUTING.md §3d.
 *
 * WHY ONLY TWO OF THE FOUR STATES NAMED ON #995. The full set is default,
 * live-search-note, warn-icon (1 remaining), and zero-quota. The last two
 * depend on `usage` from `GET /api/grok`, which reads a real Supabase row
 * with no test-mode override anywhere in the code (checked directly:
 * GrokUsageProvider.tsx's `setUsage` has no query-param, header or
 * NODE_ENV-gated caller). Reaching them for real costs real Live-mode search
 * quota against a shared daily cap (confirmed live on #998: 8 real sends to
 * walk 8→0) - not something a spec can spend on every CI run without either
 * burning real money or leaving the account too exhausted to test itself a
 * second time the same day. Posted as a finding on #995 rather than silently
 * scoped down: those two states stay a deliberate manual QA pass until a
 * dev/test-only override exists on the usage endpoint.
 *
 * live-search-note IS fully deterministic with no hook needed - it is a pure
 * regex test on the typed message text (`lib/searchTriggers.ts`), no account
 * state involved - which is exactly why it's here and the quota states are
 * not.
 */

/* The two `current` pairs were removed with the design itself (#1111). After that change a
 * stored `lhq-design-mode=current` is ignored, so they would have measured terminal twice
 * under a `current` label. The names keep the `terminal/` prefix so history stays readable. */
const DESIGN_THEME_PAIRS: ReadonlyArray<{ design: 'terminal'; theme: 'dark' | 'light' }> = [
  { design: 'terminal', theme: 'dark' },
  { design: 'terminal', theme: 'light' },
];

/** Seeds theme/consent the same way contrast.spec.ts and a11y.spec.ts do - before
 *  hydration, via localStorage, so the page never renders a frame we are not measuring
 *  and the cookie banner never inflates the header's neighbourhood. The design needs no
 *  seed: `data-design="terminal"` is static on <html> (#1111). */
async function openArenaChat(
  browser: Browser,
  theme: 'dark' | 'light',
): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await signedInContext(browser, 'a', { viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('theme', t); } catch { /* private mode */ }
  }, theme);
  await ctx.addInitScript(() => {
    try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
  });

  const page = await ctx.newPage();
  await gotoSignedIn(page, '/arena');

  /* WITHOUT THIS, EVERY ASSERTION BELOW IS A COIN FLIP.
   *
   * `.gchat-panel.gchat-open` animates in via `transform: scale(...)
   * translateY(...)` (globals.css ~2278-2292). `getBoundingClientRect()`
   * reflects the CURRENT transform, not the settled one, so a rect read
   * while the open transition is still running is a rect of a
   * still-scaling panel — not a layout defect, an animation frame. First
   * version of this spec measured immediately after the FAB click and
   * every one of the 8 cases failed with the pill "above" the header by
   * ~100-150px: fixed dimensions, no wrap possible from that. Confirmed
   * against the real deployed build (#998, manual pass, same session) that
   * the layout itself is correct — this was the spec racing its own
   * subject, the same trap #989's hover-glow reading hit and #971's
   * terminal-transition reading hit earlier the same day. Kill transitions
   * globally rather than tuning a wait: a fixed delay is a guess about how
   * long an animation takes on THIS machine; removing the animation removes
   * the race instead of out-waiting it. */
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });

  await page.locator('.gchat-fab').click();
  await page.waitForSelector('.gchat-header', { timeout: 10_000 });

  return { page, close: () => ctx.close() };
}

/** The property this whole spec exists to assert. Not "does it look right" -
 *  can the header's own fixed row and the meta strip below it ever overlap. */
async function assertHeaderNeverCrowded(page: Page) {
  const layout = await page.evaluate(() => {
    const header = document.querySelector('.gchat-header');
    const pill = document.querySelector('.gchat-mode');
    if (!header || !pill) return null;
    const h = header.getBoundingClientRect();
    const p = pill.getBoundingClientRect();
    return { headerBottom: h.bottom, headerHeight: h.height, pillTop: p.top };
  });

  expect(layout, 'the header or the Fast/Live pill is not in the DOM - nothing to measure').not.toBeNull();
  expect(layout!.pillTop,
    `the pill's top (${layout!.pillTop}) is above the header's bottom (${layout!.headerBottom}) - ` +
    `it is riding up into the header row, the exact #995 symptom.`)
    .toBeGreaterThanOrEqual(layout!.headerBottom);
}

/** `scrollWidth > clientWidth` is a wrap or an overflow, on either the quota
 *  counter or the auto-search note - whichever is present. Absence of one is
 *  not a failure; a state that doesn't show that span has nothing to check. */
async function assertNoWrap(page: Page) {
  const overflow = await page.evaluate(() => {
    const out: Array<{ selector: string; scrollWidth: number; clientWidth: number }> = [];
    for (const sel of ['[data-testid="grok-mode-count"]', '[data-testid="grok-auto-search"]']) {
      const el = document.querySelector(sel);
      if (el) out.push({ selector: sel, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
    }
    return out;
  });

  for (const { selector, scrollWidth, clientWidth } of overflow) {
    expect(scrollWidth,
      `${selector} is wrapping or overflowing: scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`)
      .toBeLessThanOrEqual(clientWidth);
  }
}

test.describe('Grok header meta strip (#995)', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  for (const { design, theme } of DESIGN_THEME_PAIRS) {
    test(`default state stays clear of the header — ${design}/${theme}`, async ({ browser }) => {
      const { page, close } = await openArenaChat(browser, theme);
      try {
        // Confirm the seed actually applied before trusting anything measured under it.
        const applied = await page.evaluate(() => ({
          design: document.documentElement.getAttribute('data-design'),
          theme: document.documentElement.getAttribute('data-theme'),
        }));
        expect(applied.design).toBe('terminal');
        if (theme === 'light') expect(applied.theme).toBe('light');

        await assertHeaderNeverCrowded(page);
        await assertNoWrap(page);
      } finally { await close(); }
    });

    test(`live-search-note stays clear of the header — ${design}/${theme}`, async ({ browser }) => {
      const { page, close } = await openArenaChat(browser, theme);
      try {
        const textarea = page.locator('textarea[placeholder*="Ask about"]');
        await textarea.fill('What is the CPI report saying today?');

        const note = page.locator('[data-testid="grok-auto-search"]');
        await expect(note, 'typing a message with a search-trigger word did not surface the auto-search note - ' +
          'either the trigger list changed or the note stopped rendering').toBeVisible({ timeout: 5000 });
        await expect(note).toHaveText(/uses a live search/);

        await assertHeaderNeverCrowded(page);
        await assertNoWrap(page);
      } finally { await close(); }
    });
  }
});
