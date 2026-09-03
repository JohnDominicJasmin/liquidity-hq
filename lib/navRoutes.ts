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
