/* The nav's route groups, shared by both designs (#714).
 *
 * These lived in components/NavDrawer.tsx and were rendered only by the current
 * design's app bar. The terminal nav had its own five hardcoded tabs and
 * reached nothing else, which is the gap the owner reported twice: *"the top
 * navigation bar. It got down. I need you to put it back."*
 *
 * MOVED HERE RATHER THAN IMPORTED ACROSS. NavDrawer already imports
 * TerminalNav, so having TerminalNav import back from NavDrawer makes a cycle -
 * ES modules tolerate it, but the constants would be read at module-init time
 * in one direction and the failure mode is an empty dropdown rather than an
 * error. A third module both sides import has no such edge.
 *
 * ONE LIST, NOT TWO THAT MUST AGREE. The bar that "got down" got that way by
 * being maintained separately from the one it replaced; two copies of an IA
 * with nothing binding them is how that returns. A route added here appears in
 * both navs or neither.
 *
 * The labelKeys are the existing NAV_* set - no new keys, so both designs draw
 * the same words for the same destination and neither can drift into renaming
 * a page the other calls something else.
 */

export const PRIMARY = [
  { path: '/dashboard', labelKey: 'NAV_DASHBOARD' as const },
  { path: '/arena',     labelKey: 'NAV_ARENA'     as const },
  { path: '/briefing',  labelKey: 'NAV_BRIEFING'  as const },
];

export const SCANNERS = [
  { path: '/markets',       labelKey: 'NAV_MARKETS'        as const },
  { path: '/scanner',       labelKey: 'NAV_SETUP_SCANNER'  as const },
  { path: '/liq',           labelKey: 'NAV_LIQUIDATION_MAP' as const },
  { path: '/funding',       labelKey: 'NAV_FR_HISTORY'     as const },
  { path: '/correlation',   labelKey: 'NAV_CORRELATION'    as const },
];

export const TOOLS = [
  { path: '/journal',       labelKey: 'NAV_JOURNAL'       as const },
  { path: '/research',      labelKey: 'NAV_RESEARCH'      as const },
  { path: '/calc',          labelKey: 'NAV_CALCULATORS'   as const },
  { path: '/econ-calendar', labelKey: 'NAV_ECON_CALENDAR' as const },
  { path: '/alerts',        labelKey: 'NAV_ALERTS'        as const },
  { path: '/hours',         labelKey: 'NAV_BEST_HOURS'    as const },
  { path: '/playbook',      labelKey: 'NAV_PLAYBOOK'      as const },
];

export const TAIL = [
  { path: '/news', labelKey: 'NAV_NEWS' as const },
];

/* ── MARKETING SURFACES: the routes that render their OWN nav (#845) ────────
 *
 * #714 removed the app nav from `/` and wrote the gate as `pathname === '/'`.
 * That was one route where it should have been a family, and #845 is the bill:
 * `/learn` renders the same `.lp-root` + `.lp-nav` + `.lp-logo` shell from
 * LearnContent, and once #748 made terminal the default design, `.tnav` painted
 * over its logo and BOTH hero buttons - including the primary CTA - for every
 * visitor. Measured at 1440x900, hit-testing each control at its own centre:
 *
 *     a.lp-logo        covered by a.tnav-item
 *     a.lp-btn-ghost   covered by header.tnav
 *     a.lp-btn-primary covered by header.tnav
 *
 * The membership test is "does this route render its own marketing chrome",
 * which the codebase already answers in exactly one place: the three components
 * that add `body.landing` - LandingContent, LandingTerminal and LearnContent.
 * LandingContent is also what `app/[locale]/page.tsx` renders, so a locale
 * landing is `/` in another language and `pathname === '/'` misses it.
 *
 * WHAT IS MEASURED HERE, so the next person does not over-trust it.
 * On a local production build, hit-testing at 1440x900:
 *
 *     BEFORE  /learn  terminal  9 controls  3 covered
 *     AFTER   /learn  terminal  8 controls  0 covered
 *
 * and structurally, `header.tnav` count in the served HTML:
 *
 *     /learn  1 -> 0      /ko  1 -> 0      (marketing, fixed)
 *     /faq  1, /terms  1, /dashboard  1    (unchanged, correct - see below)
 *
 * `/ko` is checked at DOMContentLoaded AND after hydration, both 0, because a
 * gate that only takes effect on the client is the flash #714 rejected rather
 * than a fix.
 *
 * NOT a `body.landing` read, for the reason #714 recorded: that class is added
 * by an effect, so it is unavailable on the first render and the nav flashes.
 * This is a pathname test because the pathname is known synchronously on server
 * and client alike.
 *
 * THE PUBLIC INFO PAGES ARE DELIBERATELY NOT IN THIS FAMILY. `/faq`, `/terms`,
 * `/refund`, `/disclaimer`, `/privacy` and `/about` render inside the app shell
 * and are reached from within the app as often as from search, so the nav is
 * the right thing to show. Hit-tested at 1440x900: zero covered controls on any
 * of them, in both designs. They are asserted in the test file so widening this
 * family has to be a decision rather than an accident.
 *
 * ADD A ROUTE HERE when it renders its own nav. Do not re-add a `=== '/x'`
 * test at a call site - that is what produced #845. */
export const OWN_NAV_ROUTES = ['/', '/learn'] as const;

/* The locales that actually HAVE a landing page - `ko` and `zh`, not the ten in
   lib/locales.ts.
 *
 * MEASURED, because I had this wrong first. lib/locales.ts is the app-wide
 * language list; `app/[locale]/page.tsx` generates its routes from a DIFFERENT
 * and much smaller list in lib/i18n/dictionaries.ts, and with
 * `dynamicParams = false` everything outside it 404s. On the running build:
 * `/ko` answers 200 and `/es` answers 404. Gating on the ten-item list would
 * have been describing a family that is eight-twelfths imaginary.
 *
 * COPIED RATHER THAN IMPORTED, and bound by a test rather than by trust.
 * dictionaries.ts is 386 lines of translation payload reached from server code;
 * importing it here to read two strings would risk carrying the rest into the
 * client bundle that renders this nav. `__tests__/navOwnNavRoutes.test.mts`
 * asserts this array still equals that module's SUPPORTED_LOCALES, so adding a
 * locale landing without updating this fails the suite rather than silently
 * shipping a marketing page with the app nav on it. */
export const LANDING_LOCALES = ['ko', 'zh'] as const;

export function rendersOwnNav(pathname: string): boolean {
  /* Trailing slash normalised rather than assumed away: Next's default
     `trailingSlash: false` makes `/learn/` a redirect, but this predicate is
     also called during that render and `'/learn/' === '/learn'` is false. */
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if ((OWN_NAV_ROUTES as readonly string[]).includes(p)) return true;
  const seg = p.split('/');
  return seg.length === 2 && (LANDING_LOCALES as readonly string[]).includes(seg[1]);
}
