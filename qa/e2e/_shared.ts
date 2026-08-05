import type { Page } from '@playwright/test';

/** Every route the suite sweeps. Public + app routes, signed out. */
export const ROUTES = [
  '/', '/about', '/login', '/forgot-password', '/faq', '/learn', '/disclaimer',
  '/privacy', '/terms', '/refund', '/upgrade', '/markets', '/news', '/calc',
  '/hours', '/econ-calendar', '/playbook', '/arena', '/dashboard', '/scanner',
  '/backtest', '/correlation', '/funding', '/liq', '/research', '/briefing',
  '/journal', '/alerts', '/settings', '/live-tracking', '/offline', '/ops/login',
] as const;

/**
 * BASELINES — known-failing counts as of the 2026-08-04 audit.
 *
 * These exist so CI is green on today's code while still blocking regressions.
 * A spec fails if a count goes UP. When the dev session fixes something, lower
 * the number in the same commit; that is the ratchet.
 *
 * Do not raise a baseline to make a build pass. Raising one silently converts
 * a regression into the new normal - which is exactly how the 93 lint warnings
 * became a backlog nobody owns.
 *
 * Full detail + file:line for each: pendings/QA_AUDIT_2026-08-04.md
 */
export const BASELINE = {
  /**
   * Interactive elements whose rendered box is under 24x24 CSS px, mobile, all
   * routes.
   *
   * READ THIS BEFORE CALLING IT A WCAG NUMBER. It is not one. Earlier versions
   * of this comment, and audit §4.1, described it as "tap targets below the
   * WCAG 2.2 AA 24px floor". That framing is wrong and was corrected
   * 2026-08-05. WCAG 2.2 SC 2.5.8 has exceptions a getBoundingClientRect()
   * sweep cannot model:
   *
   *   - Spacing: an undersized target conforms if a 24px-diameter circle
   *     centred on it does not intersect another target's circle.
   *   - Inline: targets inside a sentence or block of text are exempt outright.
   *     That covers a.pf-footer-bottom-link, the largest single contributor.
   *
   * axe-core's `target-size` rule, run at this exact viewport, reports
   * violations=0 / incomplete=0 / passes=156 on /playbook alone. So this metric
   * tracks something real and worth reducing - small touch targets on a PWA,
   * against the 44px Apple HIG comfort target - but it is NOT a conformance
   * failure count, and it must not be cited as one.
   *
   * 122, RATCHETED DOWN from 217 on 2026-08-05 after PR #23
   * (fix/tap-target-sizes) cleared button.pb-star (55) and
   * button.pf-footer-expand (28). Remaining: 84 a.pf-footer-bottom-link,
   * 31 a.consent-link, 7 bare <a>.
   *
   * 217 itself was CORRECTED UP from the audit's 159 - which was not a ratchet
   * violation and is not precedent for raising a baseline.
   *
   * The number must match the viewport THIS SUITE runs at: the mobile project
   * is devices['iPhone 13'], which is 390x844. At the audit's 375x812 the count
   * is 213. Setting the baseline from the audit's viewport instead of the
   * suite's is a mistake that was made once already and showed up as a 213-vs-
   * 217 failure - if you re-measure, re-measure at 390x844.
   *
   * The audit's 159 was an undercount of unchanged code, not a number the app
   * has since regressed past. §4.1's table lists `button.pb-star` on /playbook
   * as a single row; there are 55 of them, each 16x13. The audit counted the
   * footer links per instance (84 + 28 across ~30 routes) but collapsed the
   * stars to one. 213 - 55 + 1 = 159 reproduces the old figure exactly.
   *
   * Verified 2026-08-05 by two independent harnesses: 213 at the audit's own
   * 375x812 and 217 at iPhone 13's real 390x844 - a difference of 4, so
   * viewport is not what explains the gap from 159. Composition at 375x812:
   *   84 a.pf-footer-bottom-link · 55 button.pb-star · 28 button.pf-footer-expand
   *   27 a.consent-link · 12 a · 5 button · 1 div · 1 button.st-toggle
   *
   * This also reorders audit §8: the footer is 112/213 (53%), not the ~85% it
   * claims, and /playbook's stars are 26% on their own.
   *
   * The only legitimate reason to change this number again is DOWNWARD, when a
   * fix lands.
   */
  tapTargetsUnder24: 122,
  /** §4.2 - controls whose only label is a placeholder. */
  controlsWithoutName: 4,
  /** §6.4 - pages with no <h1>, desktop. */
  pagesWithoutH1: 13,
  /** §6.2 - pages emitting <link rel="canonical">. Target is ALL of them. */
  pagesWithCanonical: 0,
} as const;

/**
 * Routes whose CLS is known-bad, with the budget each is held to.
 *
 * Every other route is held to the strict < 0.1 "good" threshold. These two are
 * listed because they FAIL it today, measured 2026-08-05 - which contradicts
 * audit §3.2's claim of "CLS = 0.000 on every page measured", a claim that
 * named both of these routes. No app code changed between the audit and the
 * measurement, so §3.2 is wrong, not stale.
 *
 * Confirmed by two independent harnesses across three runs, with shift
 * attribution:
 *
 *   /arena     0.367  - one 0.3031 shift at t=763ms from FOOTER.pf-footer +
 *                       BUTTON.gchat-fab lands late and pushes the page. That
 *                       single shift is 83% of the route's total.
 *   /briefing  0.148-0.176 across runs - 0.0933 at t=652ms from five DIV.card
 *                       (.mb-brief-card) elements resizing after data arrives.
 *
 * /dashboard measured 0.006 on the same harness, which is why these are read
 * as real product behaviour rather than an observer artefact.
 *
 * Budgets carry a little headroom over the worst observed value so normal
 * run-to-run variance is not reported as a regression. Lower them when the
 * shifts are fixed; a route that reaches < 0.1 should be deleted from this map
 * entirely so it falls back to the strict threshold.
 */
export const CLS_BUDGET: Record<string, number> = {
  /* /arena was here at 0.40. Removed 2026-08-05, per the rule above: the shift
     was fixed, so the route goes back to the strict threshold rather than
     keeping a budget it now passes by 6x.
     PlatformFooter was painting before the page body existed - main.app-content
     rendered 460px tall while auth resolved, so the 296px footer sat at y=132
     in a 900px viewport and was thrown off screen when .arena-ws finally
     mounted. Holding the footer back until auth settles took the route from
     0.365 to 0.068 over three runs. Note it was the footer, not gchat-fab:
     per-source attribution put the FAB at 0.1% of the shift. */
  '/briefing': 0.20,  // observed 0.148, 0.153, 0.176
};

/** The "good" CLS threshold every route not in CLS_BUDGET must meet. */
export const CLS_GOOD = 0.1;

/**
 * Settle a page: wait for hydration, then assert the stylesheet actually
 * applied.
 *
 * This guard is not optional. During the audit an entire run reported 3,315
 * sub-24px tap targets (true value: 159) and a phantom horizontal overflow,
 * because a CSS chunk 404'd and every page rendered unstyled - the desktop nav
 * was visible at 375px and all elements collapsed to inline size. Numbers from
 * an unstyled render are worse than no numbers, because they look real.
 */
export async function settle(page: Page, path: string): Promise<void> {
  const res = await page.goto(path, { waitUntil: 'domcontentloaded' });
  if (res && res.status() >= 400) {
    throw new Error(`${path} returned HTTP ${res.status()}`);
  }
  // Client components fetch on mount; give them room before measuring.
  await page.waitForTimeout(2500);

  const css = await page.evaluate(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    return {
      sheets: document.styleSheets.length,
      bg,
      themed: bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent',
    };
  });
  if (css.sheets === 0 || !css.themed) {
    throw new Error(
      `${path} rendered UNSTYLED (styleSheets=${css.sheets}, body bg=${css.bg}). ` +
      `Measurements from this page would be meaningless. Usual cause is a stale ` +
      `.next - delete it and rebuild (docs/HANDOVER.md §8).`,
    );
  }
}

/** Elements a user can actually operate. Mirrors the audit's definition. */
export const INTERACTIVE_SELECTOR =
  'a[href],button,input:not([type=hidden]),select,textarea,' +
  '[role=button],[role=link],[role=tab],[role=switch],[tabindex]:not([tabindex="-1"])';
