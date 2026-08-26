import type { Page, APIRequestContext, APIResponse } from '@playwright/test';

/** Every route the suite sweeps. Public + app routes, signed out. */
/* Every route the sweeping specs measure — contrast, layout, a11y, seo, perf.
 *
 * `/backtest` and `/live-tracking` were REMOVED on 2026-08-11 (#264, shipped in
 * #265): both now redirect to `/dashboard`, so leaving them here would not fail
 * loudly — it would silently measure `/dashboard` twice and report a clean sweep
 * over a surface two routes smaller than the list claims.
 *
 * That is the quieter half of the problem. `settle()` throws on `HTTP >= 400`, so
 * a 404 would have been obvious; a redirect is the case that passes while
 * measuring the wrong thing.
 *
 * PUT THEM BACK if the redirect is lifted. The pages still exist in `app/` — they
 * are hidden, not deleted — so this list and the redirect have to move together
 * in both directions. */
export const ROUTES = [
  '/', '/about', '/login', '/forgot-password', '/faq', '/learn', '/disclaimer',
  '/privacy', '/terms', '/refund', '/upgrade', '/markets', '/news', '/calc',
  '/hours', '/econ-calendar', '/playbook', '/arena', '/dashboard', '/scanner',
  '/correlation', '/funding', '/liq', '/research', '/briefing',
  '/journal', '/alerts', '/settings', '/offline', '/ops/login',
] as const;

/* Hidden behind a redirect, and asserted as such by `hidden-routes.spec.ts`.
 * Kept as a named list so "which routes are hidden" has one answer rather than
 * living in a redirect config, a nav component and a test file separately. */
export const HIDDEN_ROUTES = ['/backtest', '/live-tracking'] as const;

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
   *
   * ── 122 -> 84, 2026-08-11 (#263). The first REPRODUCIBLE number this has had ──
   *
   * 122 was recorded against uncontrolled inputs, so it drifted: the same commit
   * measured 148 locally and 149 on the release build, and the PRE-release build
   * measured 148 too - proving the gap was never a regression, just drift nobody
   * caught while CI was off.
   *
   * Three inputs are now pinned (#268, #270): market data via
   * `installMarketFixtures`, browser consent state, and routes that render
   * almost nothing are named rather than counted as zero violations.
   *
   * The new number is not an improvement in the app. It is the same surface,
   * measured without the noise - and the composition above says exactly what it
   * is:
   *
   *     122 = 84 a.pf-footer-bottom-link + 31 a.consent-link + 7 bare <a>
   *      84 = a.pf-footer-bottom-link
   *
   * **84 is the shared footer component and nothing else.** The 31 consent links
   * disappear because consent is now pinned to `denied`; the 7 bare anchors were
   * data-dependent. So this metric now measures ONE component, which is both its
   * honest scope and the reason it will barely move again.
   *
   * MEASURED TWICE, identically, against deployed `staging` at `714af38`, with
   * zero unmeasured routes both times. One measurement is not a baseline.
   *
   * The environment belongs beside the number: **mobile project, consent denied,
   * market fixtures installed.** A first-visit run is NOT comparable.
   *
   * ── 84 -> 85, and the +1 is an ENVIRONMENT DIFFERENCE, not slack ────────────
   *
   * Deployed measures 84. A local run measures 85, twice, identically. So the
   * three pinned inputs removed the drift but did not make the two environments
   * agree - there is one element present locally and not on the deployed build,
   * and neither of us has identified it.
   *
   * 85 is set so `toBeLessThanOrEqual` is green in BOTH. Dev's argument, and it
   * is this file's own rule turned around: `perf`'s LCP note says "a test that is
   * always red is indistinguishable from a test nobody reads". A baseline that is
   * honest on the deployed service and red on every developer's machine is that
   * test, and it would be ignored within a week.
   *
   * The cost is ONE element of slack on deployed runs. A real regression still
   * fails at 86. That is a better trade than a gate nobody trusts.
   *
   * **The +1 is not explained and should not be treated as understood.** If
   * someone identifies it, the right move is to pin it like the other three and
   * drop back to a single number for both environments - not to widen this
   * further.
   */
  tapTargetsUnder24: 85,
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
    /* Was `settingsModal: 9`. components/SettingsModal.tsx is DELETED (issue
       #50) - it was a second, worse implementation of this screen that sat on
       the primary navigation path while missing password change, push
       notifications and the analytics opt-out. Every entry point now navigates
       to /settings, so those nine controls do not exist anywhere.

       This tracks the surviving page instead. 0 is not an aspiration here: the
       page already named 13 of its 14 controls, and the one that did not - the
       Push Notifications switch, which Chrome computed an empty name for - was
       fixed in the same commit. Starts at the true value, so any regression is
       0 -> 1 and unmissable. */
    settingsPage: 0,
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
    authForms: 0,   /* was 3. Fixed: all three containers are now rendered
                       unconditionally with role="alert", so the live region
                       exists before the text arrives. Lowered in the same
                       commit as the fix, per the instruction above. */
    /**
     * 1 - .gchat-msgs in components/GrokChat.tsx has neither aria-live nor
     * role, and the whole .gchat-panel contains zero live regions. A reply
     * streams in silently.
     */
    grokChat: 0,    /* was 1. Fixed: .gchat-msgs carries role="log" +
                       aria-live="polite". */
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
     * WHICH foreground tokens fail SC 1.4.3, not how many.
     *
     * This was a count, and the count did not survive contact with real data.
     * It moved 13 -> 17 (dark) and 38 -> 43 (light) between two runs whose only
     * app-code difference was a server-side log line in
     * app/api/telegram/alert/route.ts - which cannot change a rendered colour.
     * The sweep sees whichever application states happened to render, and a
     * count over a varying sample is not a number a ratchet can hold.
     *
     * I had claimed the opposite on PR #76 - "the DISTINCT colour count moved by
     * one across two environments" - and generalised that from two samples. It
     * was thin evidence and the claim was wrong.
     *
     * A SET fixes the part a count cannot, independently of the drift: a count
     * hides substitution. One token fixed and another broken reads as no change.
     * A set names both.
     *
     * How to read a failure:
     *   - a token here that no longer fails      -> good, remove it from the list
     *   - a token NOT here that now fails        -> triage, see below
     *
     * A new token is not automatically a regression. It is either
     *   (a) a state that had never rendered during a sweep before - add it with
     *       a note saying where it was seen, or
     *   (b) a token that actually changed - which IS a regression, and the diff
     *       will show it in app/globals.css or a component's inline style.
     *
     * Telling those apart takes one look at the diff. That is the cost of the
     * design, and it is deliberate: the alternative is a number that goes green
     * while a real substitution hides inside it.
     *
     * Measured 2026-08-08 against a local production build at c3a7571, all 32
     * routes, 1440x900 - the same shape of environment CI runs.
     */
    darkTokens: [
      // Near-white foregrounds collapse to one bucket - see bucket() in
      // contrast.spec.ts. In dark that is the /hours session badges, white-ish
      // text on mid-tone green and amber fills; in light it is the /funding
      // chips. Same defect shape, and the exact hex varies with the data.
      'near-white',
      '#1a7aff', '#414551', '#434754', '#4c4e5d',
      '#4c515f', '#4e5361', '#585d6d', '#63656a',
      '#a54e4f', '#c0595a',
      // --txt2 (4.47:1 on /about), --txt-dim (4.37:1 on /funding) — pre-existing
      // tokens unchanged by #422/#423; page states that had not rendered in prior
      // sweeps. Real defects; file bugs separately rather than silently accepting.
      // Surfaced 2026-08-26.
      '#7a7e94', '#8a8a8a',
    ] as readonly string[],

    /**
     * Light is known-broken and being fixed; this holds the line meanwhile.
     *
     * The three families are still the story: semantic green (#4ade80,
     * #7de0a4, #77deb9), semantic red (#f87171, #f69f9f, #e09999) and the muted
     * greys (#8f919c, #949597, #98999d) were chosen against the near-black dark
     * background and reused on light. Worst here is 1.09:1 against a 4.5:1
     * floor - not "hard to read", effectively invisible.
     *
     * These carry price direction on /scanner, /funding, /liq and /markets,
     * which is why it matters more than a normal contrast bug.
     */
    lightTokens: [
      '#0052cc', '#22d3ee', '#3d8d76', '#4ade80', '#60a5fa', '#627eea',
      '#76787b', '#868890', '#868895', '#8f919c',
      '#94969d', '#98999d', '#989aa0', '#a2a4ab', '#a7a9af',
      '#c75050', '#c8891e', '#d4b483',
      '#f3ba2f', '#f472b6', '#f69f9f',
      '#f87171', '#f97316', '#fbbf24',
      // .gex-insight uses rgba(255,255,255,0.65) — hardcoded near-white on /liq.
      // Collapses to 'near-white' bucket. 1.07:1 in light = invisible. Pre-existing;
      // not introduced by #422/#423. File as a separate bug. Surfaced 2026-08-26.
      'near-white',
    ] as readonly string[],
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
 * Prefix for a failure the code under test did not cause.
 *
 * A spec that walks every route reports one slow response once per assertion, so
 * a single cold container multiplies into as many failures as that spec makes
 * checks. On 2026-08-11 that turned ONE navigation timeout into SEVEN failures
 * spread across two spec files, which read as four separate problem areas until
 * the error class was compared rather than the test names.
 *
 * Marking it at the throw site is what makes the triage mechanical: group a red
 * run by this prefix first, and what remains is the actual finding count. Without
 * it the reader is left inferring intent from a stack trace, and a plausible
 * explanation for a red run is also how a real regression gets waved through.
 */
export const ENV_FAILURE = 'ENVIRONMENT';

/**
 * `page.goto` that tells a dead service apart from a real finding.
 *
 * USE THIS INSTEAD OF `page.goto` IN EVERY SPEC. The classifier first lived
 * inside settle(), which left the seven spec files that navigate directly still
 * reporting a cold container as a defect - and dev pointed out that the two worst
 * placed were `hidden-routes` and `no-selling-hidden-features`. Those gate the
 * release, so a timeout there reads as *"/backtest did not redirect"* or
 * *"/upgrade advertises a hidden route"*: the two conclusions most likely to stop
 * a release, and both wrong.
 *
 * DELIBERATELY NOT USED IN `offline.spec.ts`. That spec navigates while the
 * context is offline on purpose - a failed navigation there IS the assertion, and
 * labelling it environmental would hide the one place the failure is the point.
 */
/**
 * Rethrow a "the service did not answer" failure with the ENVIRONMENT prefix, or
 * rethrow the original untouched if it is anything else.
 *
 * Shared by the navigation guard and the API guard so the two cannot drift.
 * `what` names the thing that did not answer - a route, an endpoint - and goes
 * into the message so the reader does not have to work it out from a stack.
 */
function rethrowIfEnvironmental(e: unknown, what: string): never {
  const msg = e instanceof Error ? e.message : String(e);
  /* Playwright raises TimeoutError by name; the socket-level failures below
     carry no distinct type, so they are matched on the message. All of them
     mean "the service did not answer", never "the assertion is wrong". */
  const environmental =
    (e instanceof Error && e.name === 'TimeoutError') ||
    /ERR_CONNECTION_(REFUSED|RESET)|ERR_NETWORK_CHANGED|ECONNREFUSED|ERR_EMPTY_RESPONSE|socket hang up/i.test(msg);

  if (!environmental) throw e;

  throw new Error(
    `${ENV_FAILURE}: ${what} never answered - ${msg.split('\n')[0]}\n` +
    `This is NOT a finding about ${what}. The service did not respond; the ` +
    `assertions below it never ran. Free-plan Render sleeps when idle and the first ` +
    `request after that is slow, and a long sweep keeps containers under load.\n` +
    `Before reporting: count how many failures in this run carry the ${ENV_FAILURE} ` +
    `prefix. They are one cause, not one each.`,
  );
}

export async function gotoGuarded(
  page: Page,
  path: string,
  opts: Parameters<Page['goto']>[1] = { waitUntil: 'domcontentloaded' },
): Promise<Awaited<ReturnType<Page['goto']>>> {
  try {
    return await page.goto(path, opts);
  } catch (e) {
    rethrowIfEnvironmental(e, `navigation to ${path}`);
  }
}

/**
 * `request.get` with the same classification as `gotoGuarded`.
 *
 * The navigation guard alone left a gap I found while testing it: several specs
 * hit an API before they ever touch a page - `seo`, `econ-calendar`,
 * `cache-policy`, `klines-route` - and against an unreachable host those failed
 * with a bare `apiRequestContext.get: connect ECONNREFUSED` and no prefix. A run
 * where the service is down then produces a MIX of labelled and unlabelled
 * failures, which is worse than either alone: the reader concludes the labelled
 * ones are environmental and the rest are real.
 *
 * Note this only catches a THROWN failure. A 500 or a 502 resolves normally and
 * is a finding about the route, correctly - `settle()` and the specs assert on
 * status themselves.
 */
export async function getGuarded(
  request: APIRequestContext,
  url: string,
  opts?: Parameters<APIRequestContext['get']>[1],
): Promise<APIResponse> {
  try {
    return await request.get(url, opts);
  } catch (e) {
    rethrowIfEnvironmental(e, url);
  }
}

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
  const res = await gotoGuarded(page, path);

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

/**
 * Is the app's market-data upstream answering at all?
 *
 * WHY THIS EXISTS. CI runs the app on a GitHub runner, and **Binance blocks
 * cloud egress** - so every market-dependent spec fails there for a reason that
 * has nothing to do with the product. One CI run produced ~40 failures from
 * this single cause, including `the Confluence card did not appear`, which
 * reads as a Pro-gating defect and was not one.
 *
 * A spec that cannot reach its data has NOT found a defect - it has failed to
 * measure. The distinction is the whole point of this helper:
 *
 *     upstream refuses / unreachable   ->  SKIP, nothing was measured
 *     upstream fine, card still absent ->  FAIL, that is a real finding
 *
 * Returns a reason string when the data is unavailable, or null when it is
 * healthy. Callers pass it straight to `test.skip()`.
 *
 * Deliberately checks the app's OWN route rather than Binance directly: the
 * question is whether THIS deployment can get data, which is what every spec
 * downstream actually depends on. Checking Binance from the test machine would
 * answer a different question - and on 2026-08-13 it answered 200 while both
 * services were banned.
 */
export async function marketDataUnavailable(
  request: { get: (url: string) => Promise<{ status(): number }> },
  baseURL?: string,
): Promise<string | null> {
  const url = `${baseURL ?? ''}/api/market/klines?source=binance&symbol=BTCUSDT&interval=1h&limit=3`;
  try {
    const res = await request.get(url);
    if (res.status() === 200) return null;
    return `the app's market-data route returned ${res.status()} - the upstream is refusing this ` +
      `deployment, so nothing below measures the product. Not a finding.`;
  } catch (e) {
    return `the app's market-data route could not be reached (${String(e).slice(0, 80)}) - ` +
      `nothing below measures the product. Not a finding.`;
  }
}
