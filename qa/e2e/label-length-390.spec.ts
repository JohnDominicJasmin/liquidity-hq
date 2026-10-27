import { test, expect } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence, assertNoUnstubbedPaidAi } from './_no-paid-ai';

/* #675: DO THE PLAIN-LANGUAGE LABELS FIT AT 390px, AND WHAT DOES UPPERCASE DO TO THEM?
 *
 * 30 English label rows were rewritten on production on 2026-10-27 so the wording stops using jargon the
 * owner rejected - `24h` became `24 hours`, `BTC RSI (14, 15m)` became `BTC RSI (15-minute chart)`. Several
 * of them sit in table column headers and badges, where a longer string is a layout question rather than a
 * copy one.
 *
 * ── WHY THIS INJECTS RATHER THAN OBSERVES ──────────────────────────────────────────────────────────────────
 *
 * The new strings exist ONLY on production. `lhq_dev_labels`, which serves qa AND staging, still holds the old
 * values, and these keys render on authenticated screens - so the host with the new copy is the one without
 * test credentials, and the hosts with credentials serve the old copy. Waiting for a dev sync would make the
 * measurement wait on someone else's write.
 *
 * So `/api/labels` is intercepted and the six values are substituted into the real payload, leaving every other
 * label untouched. The page then renders the new copy through its own code path. Same shape as delaying the
 * entitlement read in auth-gate-render: inject the condition, do not wait to observe it.
 *
 * ── THE CONTROL, WITHOUT WHICH THIS IS VACUOUS ─────────────────────────────────────────────────────────────
 *
 * If the route pattern misses, the page renders the OLD short strings, nothing overflows, and the spec passes
 * while measuring nothing. So each target is asserted to CONTAIN the injected text before its geometry is
 * read, and a cell that cannot find its string FAILS rather than skipping.
 *
 * ── AND WHY WIDTH IS THE MEASUREMENT, NOT TEXT ─────────────────────────────────────────────────────────────
 *
 * Two of these render through `text-transform: uppercase` - the RSI label inline at
 * components/MarketConditionsWidget.tsx:173, and the /hours title via `.lbl` at globals.css:923.
 * `text-transform` does NOT change `textContent`: the DOM still says "15-minute chart" while the glyphs say
 * "15-MINUTE CHART". A text assertion is blind to it; only the rendered width sees it. That is the whole
 * reason this spec measures boxes instead of reading strings.
 *
 * usage: E2E_BASE_URL=https://liquidity-hq-qa.onrender.com npx playwright test label-length-390 --project=desktop */

const WIDTH = 390;
const HEIGHT = 844;

/* The six values as MEASURED on production `lhq_labels`, locale en, 2026-10-27 - not invented, and not taken
   from the issue text. `git`-style provenance matters here because an injected value that does not match
   production would measure a string nobody ships. */
const PRODUCTION_VALUES: Record<string, string> = {
  MARKET_CONDITIONS_WIDGET_RSI_LABEL: 'BTC RSI (15-minute chart)',
  HOURS_SESSION_MAP_TITLE: '24-hour session map',
  ARENA_SCANNER_COL_24H: '24 hours',
  MARKETS_24H_COL_LABEL: '24 hours',
  FUNDING_RANGE_24H: '24 hours',
  ABSORPTION_DETECTOR_MTF_BADGE: '1-hour ✓',
};

/* What each string was before, so the report says how much longer it got rather than only how wide it is. */
const PREVIOUS: Record<string, string> = {
  MARKET_CONDITIONS_WIDGET_RSI_LABEL: 'BTC RSI (14, 15m)',
  HOURS_SESSION_MAP_TITLE: '24h Session Map',
  ARENA_SCANNER_COL_24H: '24h',
  MARKETS_24H_COL_LABEL: '24h',
  FUNDING_RANGE_24H: '24h',
  ABSORPTION_DETECTOR_MTF_BADGE: '1H ✓',
};

interface Target { key: string; path: string; note: string }

const TARGETS: Target[] = [
  { key: 'MARKET_CONDITIONS_WIDGET_RSI_LABEL', path: '/dashboard', note: 'uppercase inline, .06em tracking, flex space-between with the value on the right' },
  { key: 'HOURS_SESSION_MAP_TITLE', path: '/hours', note: 'uppercase via .lbl, .12em tracking' },
  { key: 'MARKETS_24H_COL_LABEL', path: '/markets', note: 'column header, right-aligned' },
  { key: 'FUNDING_RANGE_24H', path: '/funding', note: 'range selector' },
  /* /arena, not /dashboard - AbsorptionDetector renders from app/arena/page.tsx. And the badge is gated on
     `d.mtfConfirmed` (AbsorptionDetector.tsx:342), a live-market condition, so it is absent most of the time
     through no fault of the override. The sentinel below tells those two apart. */
  { key: 'ABSORPTION_DETECTOR_MTF_BADGE', path: '/arena', note: 'badge, flex-shrink: 0, gated on d.mtfConfirmed' },
];

async function installLabelOverride(page: import('@playwright/test').Page) {
  await page.route('**/api/labels*', async (route) => {
    /* The REAL payload is fetched and then edited, rather than a stub being invented. Every label the page
       needs keeps working and only the six under test change - a hand-built payload would make an empty page
       look like a layout result. */
    /* route.fetch() throws "Request context disposed" when a late poll races ctx.close(). That is the harness
       tearing down, not the app, so it must not fail the cell - and it failed a DIFFERENT cell on each run,
       which is how a flaky instrument gets mistaken for a flaky product. */
    let res;
    try { res = await route.fetch(); } catch { try { await route.continue(); } catch { /* already gone */ } return; }
    let body: unknown;
    try { body = await res.json(); } catch { await route.fulfill({ response: res }); return; }
    const payload = body as Record<string, unknown>;
    const labels = (payload.labels ?? payload) as Record<string, unknown>;
    for (const [k, v] of Object.entries(PRODUCTION_VALUES)) labels[k] = v;
    await route.fulfill({ response: res, json: payload });
  });
}

for (const target of TARGETS) {
  test(`#675 ${target.key} at ${WIDTH}px`, async ({ browser }) => {
    test.skip(test.info().project.name !== 'desktop', 'sets its own viewport');
    test.skip(!AUTH_READY, AUTH_SKIP_REASON);

    const ctx = await signedInContext(browser, 'a', { viewport: { width: WIDTH, height: HEIGHT } });
    const page = await ctx.newPage();
    await installLabelOverride(page);
    await installPaidAiFence(page);
    /* STUBS GO AFTER THE FENCE, because Playwright matches the most recently registered handler FIRST - so
       these win for the three paths they name and the fence still catches every other paid route.
       /dashboard polls GET /api/macro-context on load (#1632), which the fence correctly aborted on the first
       run of this spec: a spec that reaches a route costing money has a stub that no longer matches. The fix
       is the stub, never removing the fence. `{}` is enough - these widgets are not what is being measured,
       and if one of them fails to render the label under test the CONTROL fails loudly rather than quietly. */
    for (const seg of ['macro-context', 'dry-powder', 'onchain']) {
      await page.route(`**/api/${seg}**`, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    }

    try {
      await gotoSignedIn(page, target.path);

      const injected = PRODUCTION_VALUES[target.key];
      const measured = await page.evaluate(([text, vw]) => {
        /* Locate by the injected TEXT rather than by a selector: these six sit in six different components,
           several with inline styles and no stable class, and a selector list would rot the first time one
           is restyled. The text is the thing under test, so it is also the right handle. */
        const all = Array.from(document.querySelectorAll('*'));
        const holders = all.filter((el) => {
          if (!el.textContent || !el.textContent.includes(text as string)) return false;
          /* Innermost element containing it - a parent also "contains" the string. */
          return !Array.from(el.children).some((c) => c.textContent?.includes(text as string));
        });
        if (!holders.length) return null;
        /* PREFER AN EXACT MATCH ON THE ELEMENT'S OWN TEXT. "Innermost containing" is not enough: on /hours the
           title sits inside a Tip whose wrapper also carries the tooltip copy, so the innermost container was a
           266x74 block and the geometry reported belonged to that wrapper rather than to the label. An element
           whose entire trimmed text IS the string is the label itself. `exactHandle` below reports which one
           was measured, so a wrapper reading is visible instead of silently wrong. */
        const exact = holders.filter((el) => el.textContent?.trim() === (text as string));
        const el = exact[0] ?? holders.sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0))[0];
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
        return {
          found: true,
          exactHandle: el.textContent?.trim() === (text as string),
          text: el.textContent?.trim().slice(0, 60) ?? '',
          transform: cs.textTransform,
          tracking: cs.letterSpacing,
          fontSize: cs.fontSize,
          width: Math.round(r.width),
          height: Math.round(r.height),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          overflowsSelf: el.scrollWidth > el.clientWidth + 1,
          /* More than ~1.5 line boxes means it wrapped. Reported, not asserted - wrapping in a header is a
             judgement, overflowing the viewport is not. */
          wrapped: r.height > lineHeight * 1.5,
          pageScrollWidth: document.documentElement.scrollWidth,
          viewport: vw as number,
        };
      }, [injected, WIDTH] as [string, number]);

      /* THE CONTROL, AND IT HAS TO SEPARATE TWO FAILURES THAT LOOK IDENTICAL.
       *
       * A missed route pattern renders the OLD short string, nothing overflows, and the spec passes having
       * measured the copy it exists to replace. So the string must be found. But "not found" has a second,
       * innocent cause: the element's own render condition is not met - the MTF badge is gated on
       * `d.mtfConfirmed`, a live-market state nobody can summon. Failing on that reports a defect that does
       * not exist; passing on it measures nothing.
       *
       * The sentinel tells them apart. If ANY other injected value is on the page, the override demonstrably
       * took, so a missing target is the render condition and the cell SKIPS with that reason. If no injected
       * value is present at all, the override failed and the cell FAILS. */
      if (measured === null) {
        const sentinel = await page.evaluate((vals) =>
          vals.some((v) => document.body.textContent?.includes(v)), Object.values(PRODUCTION_VALUES));
        test.skip(sentinel,
          `the override took (another injected value is on ${target.path}) but "${injected}" is absent - `
          + 'its render condition is not met, which is not something this spec can force');
      }
      expect(measured, `NO injected value appears anywhere on ${target.path} - the label override did not take, so nothing was measured`).not.toBeNull();

      const m = measured!;
      // eslint-disable-next-line no-console
      console.log(`#675 ${target.key}\n`
        + `  was "${PREVIOUS[target.key]}" (${PREVIOUS[target.key].length} ch) -> now "${injected}" (${injected.length} ch)\n`
        + `  ${target.note}\n`
        + `  handle=${m.exactHandle ? "the label itself" : "WRAPPER - geometry is the container"}
  transform=${m.transform} tracking=${m.tracking} fontSize=${m.fontSize}\n`
        + `  box ${m.width}x${m.height}  scrollWidth ${m.scrollWidth} vs clientWidth ${m.clientWidth}`
        + `  overflowsSelf=${m.overflowsSelf}  wrapped=${m.wrapped}\n`
        + `  page scrollWidth ${m.pageScrollWidth} vs viewport ${m.viewport}`);

      /* The page must not scroll sideways. This is the assertion that matters: a wrapped header is a
         judgement call for the owner, a horizontally scrolling phone page is a defect either way. */
      expect(m.pageScrollWidth,
        `${target.path} scrolls sideways at ${WIDTH}px with the new copy: scrollWidth ${m.pageScrollWidth}`)
        .toBeLessThanOrEqual(m.viewport + 1);

      /* And the element must not clip its own text. */
      expect(m.overflowsSelf,
        `${target.key} overflows its own box: scrollWidth ${m.scrollWidth} vs clientWidth ${m.clientWidth}`)
        .toBe(false);
    } finally {
      assertNoUnstubbedPaidAi(page, `#675 ${target.key}`);
      await ctx.close();
    }
  });
}
