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

/* Type-only, and a relative `.ts` path: node:test imports this module directly
   and resolves neither the `@/` alias nor an extensionless path. */
import type { LabelKey } from './labelKeys.ts';

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

/* ── The terminal bar's tabs and screen names (#1121, #1434) ──────────────────
 *
 * Moved here from components/TerminalNav.tsx unchanged, so the rule that decides
 * a screen name can be tested against the real data (QA, #1474). */

export interface TerminalTab {
  key: string;
  href: string;
  /** Desktop bar label. 'desk' is the one key whose two labels differ - the
   *  frames draw OVERVIEW in the bar and DESK in the tab bar. */
  labelKey: LabelKey;
  /** Bottom tab label. */
  tabLabelKey: LabelKey;
}

export const TERMINAL_TABS: TerminalTab[] = [
  { key: 'desk',  href: '/dashboard', labelKey: 'TNAV_DESK_LABEL',  tabLabelKey: 'TNAV_DESK_TAB_LABEL' },
  { key: 'arena', href: '/arena',     labelKey: 'TNAV_ARENA_LABEL', tabLabelKey: 'TNAV_ARENA_LABEL' },
  { key: 'scan',  href: '/scanner',   labelKey: 'TNAV_SCAN_LABEL',  tabLabelKey: 'TNAV_SCAN_LABEL' },
  { key: 'flow',  href: '/funding',   labelKey: 'TNAV_FLOW_LABEL',  tabLabelKey: 'TNAV_FLOW_LABEL' },
  { key: 'book',  href: '/journal',   labelKey: 'TNAV_BOOK_LABEL',  tabLabelKey: 'TNAV_BOOK_LABEL' },
];

/** "Desk", "Arena", … for one of the five; otherwise the route's own last
 *  path segment. Derived from the URL rather than a hand-kept table, so a
 *  route with no nav entry still names itself instead of showing a generic
 *  placeholder or, worse, the wrong screen's name. */
/* #1121: every route beyond ITEMS' five fell back to the raw URL segment,
 * lowercased with hyphens turned to spaces - so /econ-calendar rendered as
 * literal "econ calendar" in the mobile header. The design's mockups show
 * curated names in that slot (CALENDAR, ALERTS, SETTINGS) and only ITEMS'
 * five were ever wired up.
 *
 * A dedicated key per route, not a reuse of the (often longer) NAV_* label
 * the drawer shows for the same route - Economic Calendar there, Calendar
 * here, Liquidation Map there, Liq Map here. Short on purpose: #1120 makes
 * this element truncate with an ellipsis when the header runs out of room,
 * so a name that always truncates is a badly chosen name, same reasoning
 * ITEMS' own five short labels already follow.
 *
 * Legal/marketing pages (about, faq, terms, privacy, refund, disclaimer)
 * included even though they're rarely the active tab on mobile - they still
 * render inside the app shell (see lib/navRoutes.ts's OWN_NAV_ROUTES
 * comment on which pages do and don't), so they still hit this header. */
export const SCREEN_NAMES: Record<string, LabelKey> = {
  '/briefing':      'TNAV_BRIEFING_LABEL',
  '/markets':       'TNAV_MARKETS_LABEL',
  '/liq':           'TNAV_LIQ_LABEL',
  '/correlation':   'TNAV_CORRELATION_LABEL',
  '/research':      'TNAV_RESEARCH_LABEL',
  '/calc':          'TNAV_CALC_LABEL',
  '/econ-calendar': 'TNAV_CALENDAR_LABEL',
  '/alerts':        'TNAV_ALERTS_LABEL',
  '/hours':         'TNAV_HOURS_LABEL',
  '/playbook':      'TNAV_PLAYBOOK_LABEL',
  '/news':          'TNAV_NEWS_LABEL',
  '/settings':      'TNAV_SETTINGS_LABEL',
  '/upgrade':       'TNAV_UPGRADE_LABEL',
  '/about':         'TNAV_ABOUT_LABEL',
  '/faq':           'TNAV_FAQ_LABEL',
  '/terms':         'TNAV_TERMS_LABEL',
  '/privacy':       'TNAV_PRIVACY_LABEL',
  '/refund':        'TNAV_REFUND_LABEL',
  '/disclaimer':    'TNAV_DISCLAIMER_LABEL',
};

// Title-cases each word of a raw route segment - "econ calendar" becomes
// "Econ Calendar" rather than staying lowercase. This is deliberately still
// only a fallback: a future route added without a SCREEN_NAMES entry reads
// as a reasonable placeholder instead of the URL slug verbatim, but the
// right fix for THAT route is still adding it above, not relying on this.
function titleCase(s: string): string {
  return s.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
}

/* The real routes that show this bar and have no entry above. These, and only
 * these, still get their name from the URL (#1434).
 *
 * EVERY MATCH HERE IS EXACT, and that is the fix, not a tidy-up. The not-found
 * page is prerendered once, under Next's internal path `/_not-found`, and then
 * served at whatever unknown URL was asked for. So on a 404 the server renders
 * this bar for `/_not-found` and the browser renders it again for the real
 * address. Anything this file derives from the path has to come out the SAME
 * for both, or React throws a hydration error (#418) on every 404 view.
 *
 * Two ways it did not:
 *   - an unmatched path was title-cased from the URL: the server's HTML said
 *     "_not Found", the browser said "Zz Not A Page";
 *   - a named path matched by PREFIX: for /arena/old-link the server found
 *     nothing and the browser found "Arena" (QA, on #1474).
 * Exact matching loses nothing: no page route sits below any named path. A
 * path that is none of our routes has no name and no active tab, on both sides.
 * The cost is deliberate: a new route added without an entry shows an empty
 * header, not a guessed one. (/learn, /, /ko, /zh, the sign-in pages and /ops
 * never show this bar at all, so they need no entry.) */
export const URL_NAMED_ROUTES = new Set(['/admin', '/offline']);

export function screenNameFor(pathname: string, t: (k: LabelKey) => string): string {
  const item = TERMINAL_TABS.find(i => pathname === i.href);
  if (item) return t(item.tabLabelKey);
  if (pathname in SCREEN_NAMES) return t(SCREEN_NAMES[pathname]);
  if (!URL_NAMED_ROUTES.has(pathname)) return '';
  const seg = pathname.split('/').filter(Boolean).pop();
  return seg ? titleCase(seg.replace(/-/g, ' ')) : '';
}

/* Exact, for the same reason as screenNameFor above: on a 404 the server and
   the browser see different paths, and a prefix match would mark a tab active
   in one and not the other. */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href;
}
