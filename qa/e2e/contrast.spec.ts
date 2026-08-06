import { test, expect } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { ROUTES, BASELINE } from './_shared';

/**
 * Colour contrast — WCAG 2.2 SC 1.4.3, Level AA — on BOTH themes.
 *
 * The app ships a light theme and it had never been measured in a browser. Not
 * "measured once and stale" — never. Every contrast number QA has ever reported,
 * including the fixes pinned in __tests__/contrastTokens.test.mts, describes dark
 * mode, and that unit test would pass today with light mode as broken as it is.
 *
 * Measured on staging 2026-08-06: dark 0 violations, light 1001 across 56
 * distinct foreground colours.
 *
 * Using axe's `color-contrast` rule rather than a hand-rolled sweep, for the
 * reason issue #46 established: the rule already models the large-text
 * threshold, font weight, opacity and pseudo-elements, and — the part that
 * matters most — it reports what it could NOT determine as `incomplete` instead
 * of silently passing it. A hand-rolled sweep has no way to say "I could not
 * tell", so it says "fine".
 */

/** Seed the theme and prove it applied before measuring anything. */
async function themedPage(browser: Browser, theme: 'dark' | 'light'): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // app/layout.tsx runs an inline script that reads localStorage BEFORE
  // hydration and stamps data-theme, so seeding the key is enough — no click on
  // a theme toggle, and no race with hydration.
  await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch { /* private mode */ } }, theme);
  const page = await ctx.newPage();
  page.on('dialog', d => d.dismiss());
  return { page, close: () => ctx.close() };
}

interface Violation { route: string; fg: string; bg: string; ratio: number; target: string }

async function measure(page: Page, theme: string, route: string): Promise<Violation[] | null> {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => { /* long-poll routes never idle */ });

  // Return null rather than [] when the theme did not take. An empty array here
  // would be scored as "no violations", which is how a broken measurement turns
  // into a clean report — the exact vacuous-pass failure this suite has hit
  // three times (unseeded BOLA, a cold-start placeholder, an unstyled page).
  const applied = await page.getAttribute('html', 'data-theme');
  if (applied !== theme) return null;

  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const found = await page.evaluate(async () => {
    // @ts-expect-error injected at runtime
    const res = await window.axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } });
    return res.violations.flatMap((v: { nodes: { target: string[]; any?: { message?: string }[] }[] }) =>
      v.nodes.map(n => {
        const msg = n.any?.[0]?.message || '';
        const m = /contrast of ([\d.]+).*foreground color: (#[0-9a-f]{3,8}), background color: (#[0-9a-f]{3,8})/i.exec(msg);
        return m
          ? { fg: m[2].toLowerCase(), bg: m[3].toLowerCase(), ratio: Number(m[1]), target: n.target.join(' ').slice(0, 80) }
          : null;
      }).filter(Boolean));
  }) as Omit<Violation, 'route'>[];

  return found.map(f => ({ ...f, route }));
}

test.describe('colour contrast', () => {
  test.beforeEach(({ }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'same tokens as desktop; mobile doubles runtime for no extra signal');
  });

  /**
   * Dark, tracked the same way as light and for the same reason.
   *
   * This started as a hard `toBe(0)` on the strength of a staging sweep that
   * reported zero. That was an incomplete sample rather than a clean result: a
   * local run of the identical rule found failures on /news and /econ-calendar
   * EMPTY states, and on the /hours "current hour" badge — states staging never
   * rendered because it had data loaded and because the highlighted hour
   * depends on the time of day.
   *
   * Two honest sweeps of the same code disagreed because they saw different
   * application states. That is qa/TEST_GAPS.md §1 landing on QA's own work, and
   * it is why this is a ratchet and why the empty-state failures are worth more
   * attention than their count suggests — an empty state is what a new user sees
   * before any data arrives.
   */
  test('dark theme failing colours do not increase', async ({ browser }, testInfo) => {
    test.setTimeout(600_000);
    const { page, close } = await themedPage(browser, 'dark');
    const all: Violation[] = [];
    const skipped: string[] = [];
    try {
      for (const route of ROUTES) {
        const found = await measure(page, 'dark', route);
        if (found === null) { skipped.push(route); continue; }
        all.push(...found);
      }
    } finally { await close(); }

    expect(skipped, `theme never applied on these routes — measurement invalid, not clean: ${skipped.join(', ')}`).toEqual([]);

    const colours = new Map<string, { n: number; worst: number; where: string }>();
    for (const v of all) {
      const e = colours.get(v.fg) ?? { n: 0, worst: Infinity, where: v.route };
      colours.set(v.fg, { n: e.n + 1, worst: Math.min(e.worst, v.ratio), where: e.where });
    }

    testInfo.attach('contrast-dark.txt', {
      body: `${all.length} violations across ${colours.size} distinct colours\n\n`
        + all.map(v => `${v.route}  ${v.ratio}:1  ${v.fg} on ${v.bg}  ${v.target}`).join('\n'),
      contentType: 'text/plain',
    });

    expect(
      colours.size,
      `Dark theme: ${BASELINE.contrast.darkDistinctColours} -> ${colours.size} distinct failing colours ` +
      `(${all.length} total violations).\n` +
      `Known at baseline: empty-state text on /news and /econ-calendar, and the /hours badges. ` +
      `If this went UP, check whether a new application STATE rendered rather than assuming a token ` +
      `changed — this sweep only ever sees the states that happened to render.\n` +
      [...colours].map(([fg, e]) => `  ${String(e.n).padStart(3)}  ${fg}  worst ${e.worst.toFixed(2)}:1`).join('\n'),
    ).toBeLessThanOrEqual(BASELINE.contrast.darkDistinctColours);
  });

  /**
   * Light is broken; this holds the line while it gets fixed.
   *
   * Asserts on DISTINCT FOREGROUND COLOURS, not violation count. Two full runs
   * an hour apart on the same build gave 938 and 1001 raw violations, because
   * /scanner contributes ~539 and that depends on how many rows of market data
   * happen to render. A number that drifts by 60 on its own cannot detect
   * anything. Distinct colours was 56 in both runs — and it is also the shape of
   * the actual fix, since nobody repaints 1001 elements, they retune a token.
   */
  test('light theme failing colours do not increase', async ({ browser }, testInfo) => {
    test.setTimeout(600_000);
    const { page, close } = await themedPage(browser, 'light');
    const all: Violation[] = [];
    const skipped: string[] = [];
    try {
      for (const route of ROUTES) {
        const found = await measure(page, 'light', route);
        if (found === null) { skipped.push(route); continue; }
        all.push(...found);
      }
    } finally { await close(); }

    expect(skipped, `theme never applied on these routes — measurement invalid, not clean: ${skipped.join(', ')}`).toEqual([]);

    const byColour = new Map<string, { n: number; worst: number }>();
    for (const v of all) {
      const e = byColour.get(v.fg) ?? { n: 0, worst: Infinity };
      byColour.set(v.fg, { n: e.n + 1, worst: Math.min(e.worst, v.ratio) });
    }
    const ranked = [...byColour].sort((a, b) => b[1].n - a[1].n);

    testInfo.attach('contrast-light.txt', {
      body: `${all.length} violations across ${byColour.size} distinct foreground colours\n\n`
        + ranked.map(([fg, e]) => `${String(e.n).padStart(4)}  ${fg}  worst ${e.worst.toFixed(2)}:1`).join('\n'),
      contentType: 'text/plain',
    });

    expect(
      byColour.size,
      `Light theme: ${BASELINE.contrast.lightDistinctColours} -> ${byColour.size} distinct failing colours ` +
      `(${all.length} total violations — that raw number drifts with market data, which is why it is not asserted).\n` +
      `Fix belongs in the [data-theme="light"] block on the FOREGROUND tokens. Do not lighten the ` +
      `backgrounds — dark is clean and that would break it.\n` +
      ranked.slice(0, 12).map(([fg, e]) => `  ${String(e.n).padStart(4)}  ${fg}  worst ${e.worst.toFixed(2)}:1`).join('\n'),
    ).toBeLessThanOrEqual(BASELINE.contrast.lightDistinctColours);
  });
});
