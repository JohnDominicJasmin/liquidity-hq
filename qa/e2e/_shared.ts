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
   *
   * THIS NUMBER CANNOT DETECT THE REGRESSION IT LOOKS LIKE IT DETECTS.
   * Re-measured 2026-08-06 (issue #46): all 122 are <a>, none is a control -
   * 84 a.pf-footer-bottom-link, 31 a.consent-link, 7 bare a. Every one is a link
   * inside a block of text, which SC 2.5.8 exempts outright, so the real count
   * of WCAG failures here is ZERO. A genuine 16x16 button appearing anywhere
   * moves this 122 -> 123, a 0.8% change in a number that already drifts when a
   * footer link is added. Deleting footer links moves it DOWN, which reads as an
   * improvement while conformance is unchanged.
   *
   * So this stays as the loose "small touch targets on a PWA" signal it actually
   * is, and axeTargetSizeViolations below is what guards conformance.
   */
  tapTargetsUnder24: 122,
  /**
   * SC 2.5.8 failures per axe-core's own `target-size` rule, which models BOTH
   * exceptions (spacing and inline) rather than re-deriving them by hand.
   *
   * Hand-rolling the exceptions is how tapTargetsUnder24 came to be quoted as a
   * conformance count twice - 159, then 217, then 122, none of them a number of
   * WCAG failures. axe reported 0 violations / 0 incomplete / 156 passes on
   * /playbook alone, so this starts at the true value.
   *
   * Asserted with toBe(0), not a ratchet. Zero is the target and the only
   * acceptable value; one real failure is 0 -> 1, which is unmissable. If this
   * ever goes non-zero, that is a defect to file, not a baseline to raise.
   */
  axeTargetSizeViolations: 0,
  /** §4.2 - controls whose only label is a placeholder. */
  controlsWithoutName: 4,

  /**
   * SIGNED-IN controls with no accessible name by ANY route - not aria-label,
   * aria-labelledby, label[for], a wrapping label, or title.
   *
   * Every number here was measured in the browser on 2026-08-06, signed in as
   * the seeded account A, against the six claims in
   * pendings/QA_A11Y_FINDINGS_2026-08-05.md §4. Those claims came from a source
   * read and had sat unverifiable since 2026-08-05 because nothing automated
   * could reach past the onboarding gate.
   *
   * These are WCAG 2.2 SC 4.1.2 Name, Role, Value failures at Level A. A screen
   * reader announces "edit text, blank" and nothing else; voice control has no
   * phrase to match. Ratchet DOWN as fixes land.
   */
  authUnnamedControls: {
    /**
     * components/SettingsModal.tsx, opened from the nav drawer's Settings tile.
     * 9 controls unnamed, and 12 <label> elements that carry the visible text
     * but have no for= and wrap nothing, so they name nothing.
     *
     * The claim that produced this said "~24 inputs". The real figure is 9.
     *
     * Note the split this exposes: app/settings/page.tsx renders the same
     * settings UI with aria-label on every st-input (13 of 14 named), while the
     * MODAL has none. Two implementations, one fixed and one not. Whoever fixes
     * the modal should check they are not fixing the page a second time.
     */
    settingsModal: 9,
    /** components/TradeJournal.tsx .tj-edit-form - the inline edit on a history
     *  row. select.tj-edit-select, two input.tj-inp, textarea.tj-notes. The
     *  original claim said 4 and 4 is exactly right. */
    journalInlineEdit: 0,  /* was 4. Fixed with id/htmlFor pairs on the labels
                              that were already there - NOT aria-label, which
                              would have overridden the visible text. */
    /** TradeJournal rule builder, behind Rules -> "+ Custom Rule". Three bare
     *  <select> with inline styles, no class, no id, no label of any kind. */
    journalRuleBuilder: 0, /* was 3. These have no visible label at all, so
                              aria-label is correct here. Two placeholder-only
                              inputs in the same form were fixed at the same
                              time; they were outside this count because the
                              sweep looks at <select> only. */
  },

  /**
   * Status messages that render visibly but are never announced - WCAG 2.2
   * SC 4.1.3 Status Messages, Level AA.
   *
   * These are BASELINES, not acceptance. They exist for the same reason every
   * other number in this file does: CI has to be green on today's code or the
   * gate stops meaning anything, and a red suite here would block unrelated
   * releases. Both target ZERO and both are filed as defects.
   */
  unannouncedStatus: {
    /**
     * 3 - the .login-error container on the /login password form, the /login
     * magic-link form, and /forgot-password. All three render
     * `<div className="login-error">` with no role and no aria-live, and there
     * is no live region anywhere else on those pages, so a screen reader user
     * submits, hears nothing, and cannot tell whether anything happened.
     * The original claim named /login only.
     */
    authForms: 3,
    /**
     * 1 - .gchat-msgs in components/GrokChat.tsx has neither aria-live nor
     * role, and the whole .gchat-panel contains zero live regions. A reply
     * streams in silently.
     */
    grokChat: 1,
  },

  /**
   * Colour contrast, WCAG 2.2 SC 1.4.3, Level AA, per axe's `color-contrast`
   * rule. Measured on staging (57a6766) 2026-08-06, all 32 routes, 1440x900.
   *
   * WHY THIS TRACKS DISTINCT COLOURS AND NOT VIOLATION COUNT.
   * Two full runs an hour apart gave 938 and 1001 raw violations - the same
   * build, the same routes. The difference is market data: /scanner alone
   * contributed 539, and how many rows of coloured numbers render depends on
   * what the market is doing. A baseline that drifts by 60 on its own cannot
   * detect a regression, which is the exact failure issue #46 identified in
   * tapTargetsUnder24.
   *
   * Distinct failing foreground colours is stable across both runs at 56,
   * because 500 rows of the same unreadable green is still one token to fix.
   * It also matches what a fix actually looks like: nobody fixes 1001 elements,
   * they fix a handful of tokens.
   */
  contrast: {
    /**
     * Dark theme: 5 distinct failing foreground colours.
     *
     * CORRECTION. This was briefly recorded as 0 and hard-asserted, on a
     * staging sweep that reported zero dark violations across all 32 routes.
     * That measurement was incomplete, not wrong: running the same rule against
     * a local build surfaced real failures on states staging never rendered -
     *
     *   /news          3.07:1  #585d6d on #06070a  .nfeed-empty (EMPTY state)
     *   /econ-calendar 2.10:1  #414551 on #06070a  (EMPTY state)
     *   /hours         2.77:1  #eff6f2 on #5ca279  ("current hour" badge)
     *   /hours         4.05:1  #f4f1e8 on #91711d  (a second badge tone)
     *
     * - because staging had news and calendar data loaded and local did not,
     * and because which /hours badge is highlighted depends on the time of day.
     *
     * This is qa/TEST_GAPS.md §1 (market data and the clock cannot be
     * controlled) demonstrated on QA's own measurement. Two honest sweeps of the
     * same rule against the same code disagreed, because they saw different
     * application states. Neither number is the truth; the union is closer, and
     * even the union is only "every state we happened to render".
     *
     * So dark is NOT proven clean, and this is a ratchet like everything else.
     * Empty states are the interesting part: they are what a new user sees.
     *
     * 13, measured against a LOCAL production build (15 total violations) -
     * deliberately not the staging figure. CI runs `npm run build && npm start`
     * in the runner, so a local build is the environment this assertion will
     * actually face. Staging reported 0 for the reason above; if you re-measure
     * there and get a small number, that is the same sampling difference and not
     * a fix.
     */
    darkDistinctColours: 13,
    /**
     * Light theme: 56 distinct foreground colours fail.
     *
     * Light had NEVER been measured in a browser before 2026-08-06 - it was
     * carried as "not verified" in every release note since 2026-08-05. It is
     * badly broken, and it is one story rather than 56: the semantic green
     * (#34d399, #4ade80, #6ee7b7...), the semantic red (#f87171, #fca5a5,
     * #fcbcbc...) and the muted greys (#8a8a8a, #8e8e93, #a0a0a0...) were
     * chosen against the near-black dark background and reused unchanged on
     * light. Worst measured: 1.39:1 against a 4.5:1 floor.
     *
     * That matters more than a normal contrast bug on this product, because
     * green and red ARE how price direction is communicated - and the four
     * worst routes (/scanner, /funding, /liq, /markets) are the dense numeric
     * screens where those colours carry the meaning.
     *
     * Filed for dev. Ratchet DOWN as light-mode token variants land; the fix
     * belongs in the [data-theme="light"] block on the foreground tokens, NOT
     * on the backgrounds - lightening those would break dark.
     *
     * 57 against a LOCAL production build (990 total violations); staging gave
     * 56 (1001). That the DISTINCT count moved by one across two environments
     * with completely different data, while the raw violation count moved by 11,
     * is the evidence this metric was chosen on: the raw number is noise, the
     * token count is signal. Local is the baseline because CI builds and serves
     * locally, so that is the environment this assertion actually faces.
     *
     * Worst ratios measured, all far below the 4.5:1 floor:
     *   #86efac 1.24:1 · #fbbf24 1.33:1 · #fcbcbc 1.39:1 · #34d399 1.43:1
     * Highest volume: #8a8a8a (196), #f87171 (191), #34d399 (170).
     */
    /* 57 -> 38, lowered by the fix in #58 rather than by a re-measurement.
       Verified by running THIS spec with that change merged in, all 32 routes:
       990 total violations -> 65, and 57 distinct colours -> 38. Dark measured
       13 on the same sweep, identical to the baseline above, which is what
       proves a 58-file change left dark alone.

       Worth noting the ratio, because it is this metric working rather than a
       contradiction: violations fell 93% while distinct colours fell 33%. The
       high-volume families (#f87171 191, #8a8a8a 196, #34d399 170) collapsed to
       zero; what remains is a long tail where each colour appears 1-7 times -
       brand colours (#627eea Ethereum, #f3ba2f Binance), chart accents, and
       near-white text on near-white panels. Each needs its own decision, not a
       token mapping. The count is the harder number to move, which is exactly
       why it is the one asserted. */
    lightDistinctColours: 38,
  },
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

  /* /scanner moved here from CLS_UNSTABLE on 2026-08-05, meeting the retirement
     condition that entry set for itself ("fix the race, re-measure over >=10
     runs, then give /scanner a real CLS_BUDGET").

     The instability was real when measured, and it was measured on `dev`, which
     had fix/scanner-layout-shift (the heatmap tile-height fix) but NOT
     fix/scanner-card-layout-shift, which rewrote the heatmap ranking, three card
     skeletons and PageHint. Both are now on main.

     24 runs on the shipped build, production server, two batches:
       cold  0.176 0.010 0.013 0.016 0.010 0.011 0.010 0.016 0.009 0.028 0.007 0.014
       warm  0.008 0.007 0.007 0.008 0.012 0.010 0.028 0.007 0.011 0.012 0.016 0.011
     Warm: min 0.007, median 0.011, mean 0.011, max 0.028.
     The single 0.176 was run #1 against a just-started server; the second batch
     was run to test exactly that, and reproduced nothing above 0.028. That is a
     cold-start cost, not the ~3x race the old distribution showed.

     Budget is 0.25 rather than deleting the route outright, even though the
     median is well under CLS_GOOD, because CI always measures a cold server -
     the webServer builds and starts immediately before the run - so 0.1 would
     gate on the one number that legitimately varies. 0.25 clears the observed
     cold worst case with headroom and is still ~9x tighter than the ~2.0 a
     ceiling would have needed before the fix.
     Lower it to CLS_GOOD (delete this line) if cold-start ever measures <0.1. */
  '/scanner': 0.25,
};

/** The "good" CLS threshold every route not in CLS_BUDGET must meet. */
export const CLS_GOOD = 0.1;

/**
 * Routes whose CLS is too UNSTABLE to assert any number against.
 *
 * Still measured and attached to the report on every run - the value stays
 * visible, it just is not a pass/fail gate. Nothing here is "allowed"; it is
 * unmeasurable-by-threshold, which is a WORSE state than a bad fixed number.
 *
 * EMPTY as of 2026-08-05. /scanner was the only entry and has been retired to
 * CLS_BUDGET at 0.25 - see the note there for the 24-run distribution that
 * justified it. The mechanism stays because the distinction it draws is a real
 * one, and re-deriving it under pressure would be worse than keeping it.
 *
 * The bar for adding a route here, unchanged: an entry must carry a measured
 * distribution (>=10 runs, not 3 - an earlier 3-run sample of /scanner read
 * 0.432/0.691/0.454 and was reported as "fixed", which 10 runs disproved) AND
 * a retirement condition saying what has to be true to remove it. Without both
 * this becomes the place flaky tests go to be forgotten, which is the failure
 * mode it exists to prevent.
 */
export const CLS_UNSTABLE = new Set<string>([]);

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

/**
 * Inject axe-core into the page and run it.
 *
 * axe-core is already installed (a transitive dependency of
 * eslint-plugin-jsx-a11y) but is declared explicitly in devDependencies so a
 * lint-config change cannot silently remove the test suite's dependency.
 *
 * Loaded from node_modules rather than a CDN: the suite must run offline and in
 * CI without a network round-trip, and a CDN version bump would change results
 * under us.
 */
export async function runAxe(
  page: Page,
  opts: { runOnly?: string[]; rules?: Record<string, { enabled: boolean }> } = {},
): Promise<{ id: string; nodes: string[] }[]> {
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  return page.evaluate(async (o) => {
    const cfg: Record<string, unknown> = {};
    if (o.runOnly) cfg.runOnly = { type: 'rule', values: o.runOnly };
    if (o.rules) cfg.rules = o.rules;
    // @ts-expect-error injected at runtime
    const res = await window.axe.run(document, cfg);
    return res.violations.map((v: { id: string; nodes: { target: string[] }[] }) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')),
    }));
  }, opts);
}
