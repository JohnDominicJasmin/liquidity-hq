import { test, expect } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { ROUTES, BASELINE } from './_shared';
import { installMarketFixtures } from './_fixtures';

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

/**
 * Collapse computed near-white blends into ONE bucket.
 *
 * /funding renders a signal chip per row whose background is a tint blended
 * against the page, and its text is near-white. The resulting pair is COMPUTED,
 * not a design token - which coins happen to render decides the exact hex. Two
 * sweeps minutes apart produced #f9f9f8, #fafafb, #faf9f5, #f7faf9, #f3f9f8 and
 * #f3f5f7, all between 1.06:1 and 1.15:1.
 *
 * Enumerating those is unbounded and pointless: it is ONE defect - near-white
 * text on a near-white chip - wearing a different hex each run. So anything with
 * every channel above 0xE0 collapses to `near-white`, and the set tracks the
 * defect rather than the sample.
 *
 * Deliberately narrow. It only merges colours that are already almost white, so
 * a genuine token regression cannot hide inside it - a readable foreground is
 * never 0xE0+ on all three channels against a light background.
 */
function bucket(fg: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(fg);
  if (!m) return fg;
  const [r, g, b] = m.slice(1).map(h => parseInt(h, 16));
  return (r > 0xE0 && g > 0xE0 && b > 0xE0) ? 'near-white' : fg;
}

interface Violation { route: string; fg: string; bg: string; ratio: number; target: string }

/**
 * Wait until the rendered DOM stops changing, then refuse to measure anything
 * that does not look rendered.
 *
 * This replaced `waitForLoadState('networkidle')`, which cost ~8s on nearly
 * every route — 8.1 minutes across the 58 page loads this file performs. The
 * app polls market data continuously, so network idleness is orthogonal to
 * whether the page has painted; it was waiting for the wrong thing, expensively.
 *
 * MEASURED BEFORE AND AFTER, because "faster" is worthless here if it finds
 * fewer violations. Both waits were run against the same 12 routes in the same
 * session and their violation sets compared element by element:
 *
 *   attempt 1  (3 stable samples, no floor)   74% faster, MISSED 1 on /arena
 *   attempt 2  (6 samples + 3s floor)         49% and 62% faster over two runs,
 *                                             0 missed, 0 set differences
 *
 * Attempt 1 is why the floor exists. /arena renders a late `<b>` inside a span
 * once its data arrives, and three identical samples declared stability in the
 * gap before it landed. A page can look settled between two bursts of the same
 * render, so elapsed time is a second, independent condition rather than a
 * belt-and-braces nicety.
 *
 * The signature includes rendered TEXT, not just element count — the missed node
 * changed text without changing the count.
 *
 * If this ever needs re-tuning: re-run the A/B, do not eyeball it. A wait that
 * is slightly too short does not fail, it silently under-counts, which reads as
 * an improvement and would ratchet a baseline onto a number that was never true.
 */
async function settleForMeasurement(page: Page): Promise<void> {
  const started = Date.now();
  await page.waitForFunction(() => {
    const w = window as unknown as { __sig?: { last: string; stable: number } };
    const sig = document.querySelectorAll('*').length + ':' + (document.body.innerText || '').length;
    w.__sig = w.__sig || { last: '', stable: 0 };
    if (sig === w.__sig.last) w.__sig.stable++; else { w.__sig.last = sig; w.__sig.stable = 0; }
    return w.__sig.stable >= 6;
  }, undefined, { timeout: 20_000, polling: 300 }).catch(() => { /* fall through to the floor + guard */ });

  const elapsed = Date.now() - started;
  if (elapsed < 3_000) await page.waitForTimeout(3_000 - elapsed);
}

async function measure(page: Page, theme: string, route: string): Promise<Violation[] | null> {
  /* Serve recorded market data instead of the live market.
   *
   * This sweep visits 32 routes in two themes, and 29 of those routes call a
   * third-party API - MarketProvider mounts on every page, so /about is as
   * chatty as /arena. Measured: ~6,000 third-party requests per pass.
   *
   * Two things that buys, and the second is why this landed:
   *
   *   1. `workers: 1` exists because parallel runs trip Binance and Bybit
   *      per-IP limits and the 429s look like product bugs (#114).
   *   2. THE SWEEP STOPS DEPENDING ON WHAT THE MARKET DID TODAY. #48484a hid on
   *      /hours until a specific session window rendered; #9ca3af sits in
   *      neutral branches that need the market to be neither bullish nor
   *      bearish. Three release gates failed in one day on colours that were
   *      always there and only sometimes on screen.
   *
   * Installed per page rather than once, because each measurement runs in its
   * own context. */
  await installMarketFixtures(page);
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await settleForMeasurement(page);

  // Return null rather than [] when the theme did not take. An empty array here
  // would be scored as "no violations", which is how a broken measurement turns
  // into a clean report — the exact vacuous-pass failure this suite has hit
  // three times (unseeded BOLA, a cold-start placeholder, an unstyled page).
  const applied = await page.getAttribute('html', 'data-theme');
  if (applied !== theme) return null;

  // The render guard. Now that the wait is bounded rather than "until the
  // network goes quiet", something has to assert the page actually rendered —
  // otherwise a slow route measures a skeleton, finds nothing, and reports
  // clean. Returning null routes it into the same "measurement invalid" path as
  // a theme that did not apply, which FAILS the test rather than scoring zero.
  //
  // Two signals, both chosen after the obvious ones failed:
  //
  //   TEXT LENGTH is wrong. The first version rejected under 200 characters and
  //   false-positived on /ops/login, which is a legitimately minimal page — 75
  //   characters, 82 elements, fully styled. A sparse page is not a broken one.
  //
  //   STYLESHEET COUNT is wrong. The failure this guard exists for — a local
  //   build serving the page with the app's CSS missing, which once produced a
  //   confident report of green and red text on white — still had
  //   document.styleSheets.length === 2. The app's sheet was the missing one.
  //
  // What does separate them is the computed body colour. The app sets --txt in
  // both themes and neither resolves to pure black; rgb(0, 0, 0) is the user
  // agent default and appears only when the app's CSS never applied. That is
  // exactly the state that produced the bogus reading.
  const rendered = await page.evaluate(() => ({
    elements: document.querySelectorAll('*').length,
    color: getComputedStyle(document.body).color,
  }));
  if (rendered.elements < 30 || rendered.color === 'rgb(0, 0, 0)') return null;

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
  /*
   * NOT parallelised, deliberately, and this note exists so nobody tries it
   * again as an obvious speed-up.
   *
   * This file is the slowest in the suite: two sweeps of 32 routes with an axe
   * pass each. It was ~12 minutes and is now ~4.8 after settleForMeasurement
   * replaced the networkidle wait - but it is still the biggest single item, and
   * at 12 minutes it is what pushed the E2E job to 45.3 minutes against
   * `timeout-minutes: 45` on release 2026-08-06.4, cancelling the job mid-run.
   *
   * `test.describe.configure({ mode: 'parallel' })` was the first thing tried
   * and it changes nothing: playwright.config.ts pins `workers: 1`, so the
   * runner reported "Running 2 tests using 1 worker" and the file still took
   * 12.1 minutes. That pin is not an oversight - parallel specs multiply
   * traffic to Binance/Bybit and trip the app's own per-IP rate limiter,
   * producing 429s that read as product bugs. Buying six minutes by
   * manufacturing fake failures is a bad trade.
   *
   * The cap was raised instead. See the E2E job in .github/workflows/ci.yml.
   */

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
    // 20 minutes, not the 600_000 this used to be.
    //
    // Each sweep measures 9-10 minutes IN CI (5.4-5.7 local; the runner is
    // ~1.6x slower). A 10-minute per-test cap therefore sat directly on the
    // measured runtime, and on 2026-08-07 the light sweep hit it, retried, and
    // passed on the retry in 9.0m - so the FIRST attempt failed on the clock
    // rather than on a finding, and the retry then re-ran the slowest test in
    // the suite. That single flake put ~9 extra minutes on the critical path
    // and is what actually blew the job cap, not the job cap being too small.
    //
    // Raising the job total alone would only have absorbed the flake, not
    // stopped it. Found by Dev Team reading the run log; the setting is here,
    // so the fix is here.
    //
    // 20 gives ~2x the measured CI time. Size it from a CI number, never a
    // local one - that is the mistake that produced both the 90 and this 10.
    test.setTimeout(1_200_000);
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

    expect(skipped,
      `These routes were NOT measured, so this run is invalid rather than clean: ${skipped.join(', ')}.
` +
      `Either data-theme never applied, or the page did not render (fewer than 30 elements, or the app CSS never applied). ` +
      `Both are scored the same way on purpose - a route that could not be measured must never be counted as a route with no violations.`,
    ).toEqual([]);

    const colours = new Map<string, { n: number; worst: number; where: string }>();
    for (const v of all) {
      const key = bucket(v.fg);
      const e = colours.get(key) ?? { n: 0, worst: Infinity, where: v.route };
      colours.set(key, { n: e.n + 1, worst: Math.min(e.worst, v.ratio), where: e.where });
    }

    const known = new Set(BASELINE.contrast.darkTokens);
    const unexpected = [...colours].filter(([fg]) => !known.has(fg));
    const fixed = BASELINE.contrast.darkTokens.filter(fg => !colours.has(fg));

    testInfo.attach('contrast-dark.txt', {
      body: `${all.length} violations across ${colours.size} tokens\n\n`
        + [...colours].sort((a, b) => a[1].worst - b[1].worst)
            .map(([fg, e]) => `${fg}  worst ${e.worst.toFixed(2)}:1  x${e.n}  first seen ${e.where}`).join('\n')
        + (fixed.length ? `\n\nno longer failing (remove from BASELINE.contrast.darkTokens):\n${fixed.join('\n')}` : ''),
      contentType: 'text/plain',
    });

    expect(
      unexpected.map(([fg]) => fg),
      `Dark theme: ${unexpected.length} foreground token(s) failing SC 1.4.3 that are not in ` +
      `BASELINE.contrast.darkTokens.

` +
      unexpected.map(([fg, e]) => `  ${fg}  worst ${e.worst.toFixed(2)}:1  on ${e.where}`).join('\n') +
      `

This is NOT automatically a regression. It is either:
` +
      `  (a) a state that had not rendered during a sweep before - add the token to the list ` +
      `with a note saying where, or
` +
      `  (b) a token that actually changed - a real regression, and the diff will show it in ` +
      `app/globals.css or a component's inline style.
` +
      `Check the diff before doing either. Do not add a token just to go green.`,
    ).toEqual([]);
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
    // 20 minutes, not the 600_000 this used to be.
    //
    // Each sweep measures 9-10 minutes IN CI (5.4-5.7 local; the runner is
    // ~1.6x slower). A 10-minute per-test cap therefore sat directly on the
    // measured runtime, and on 2026-08-07 the light sweep hit it, retried, and
    // passed on the retry in 9.0m - so the FIRST attempt failed on the clock
    // rather than on a finding, and the retry then re-ran the slowest test in
    // the suite. That single flake put ~9 extra minutes on the critical path
    // and is what actually blew the job cap, not the job cap being too small.
    //
    // Raising the job total alone would only have absorbed the flake, not
    // stopped it. Found by Dev Team reading the run log; the setting is here,
    // so the fix is here.
    //
    // 20 gives ~2x the measured CI time. Size it from a CI number, never a
    // local one - that is the mistake that produced both the 90 and this 10.
    test.setTimeout(1_200_000);
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

    expect(skipped,
      `These routes were NOT measured, so this run is invalid rather than clean: ${skipped.join(', ')}.
` +
      `Either data-theme never applied, or the page did not render (fewer than 30 elements, or the app CSS never applied). ` +
      `Both are scored the same way on purpose - a route that could not be measured must never be counted as a route with no violations.`,
    ).toEqual([]);

    const byColour = new Map<string, { n: number; worst: number }>();
    for (const v of all) {
      const key = bucket(v.fg);
      const e = byColour.get(key) ?? { n: 0, worst: Infinity };
      byColour.set(key, { n: e.n + 1, worst: Math.min(e.worst, v.ratio) });
    }

    const known = new Set(BASELINE.contrast.lightTokens);
    const unexpected = [...byColour].filter(([fg]) => !known.has(fg));
    const fixed = BASELINE.contrast.lightTokens.filter(fg => !byColour.has(fg));

    testInfo.attach('contrast-light.txt', {
      body: `${all.length} violations across ${byColour.size} tokens\n\n`
        + [...byColour].sort((a, b) => a[1].worst - b[1].worst)
            .map(([fg, e]) => `${fg}  worst ${e.worst.toFixed(2)}:1  x${e.n}`).join('\n')
        + (fixed.length ? `\n\nno longer failing (remove from BASELINE.contrast.lightTokens):\n${fixed.join('\n')}` : ''),
      contentType: 'text/plain',
    });

    expect(
      unexpected.map(([fg]) => fg),
      `Light theme: ${unexpected.length} foreground token(s) failing that are not in ` +
      `BASELINE.contrast.lightTokens.

` +
      unexpected.map(([fg, e]) => `  ${fg}  worst ${e.worst.toFixed(2)}:1  x${e.n}`).join('\n') +
      `

Same triage as the dark test: a state that had not rendered before (add it, with a ` +
      `note) or a token that changed (a regression - check app/globals.css and inline styles).
` +
      `The fix for this family belongs in the [data-theme="light"] block on the FOREGROUND ` +
      `tokens. Do not lighten the backgrounds - that breaks dark.`,
    ).toEqual([]);
  });
});
