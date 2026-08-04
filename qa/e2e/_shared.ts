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
  /** §4.1 - tap targets under the WCAG 2.2 AA 24px floor, mobile, all routes. */
  tapTargetsUnder24: 159,
  /** §4.2 - controls whose only label is a placeholder. */
  controlsWithoutName: 4,
  /** §6.4 - pages with no <h1>, desktop. */
  pagesWithoutH1: 13,
  /** §6.2 - pages emitting <link rel="canonical">. Target is ALL of them. */
  pagesWithCanonical: 0,
} as const;

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
