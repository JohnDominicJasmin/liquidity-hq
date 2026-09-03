/* Which design the app renders in (#413).
 *
 * The colour tokens and IBM Plex Sans are already scoped to
 * [data-design="terminal"], but nothing sets that attribute - so the redesign
 * has been inert. This is the switch.
 *
 * WHY A SWITCH AND NOT A BRANCH. The shell is global chrome: unlike a screen,
 * it cannot opt in one page at a time, because every page renders inside it.
 * So the choice was a long-lived redesign branch that diverges for weeks, or a
 * runtime flag that lets `dev` stay linear and lets QA review the new chrome on
 * a DEPLOYED build rather than on somebody's localhost. The flag wins: the
 * owner asked to review screens as they land, and a branch nobody can visit is
 * not reviewable.
 *
 * DEFAULT IS THE CURRENT DESIGN, EXCEPT ON `/` (#719, 2026-09-03). The owner
 * stopped the canvas-mirror redesign and decided terminal ships on the landing
 * page only: `/` renders terminal for every visitor, every app screen stays on
 * the current design. That is the first time any of this work becomes visible
 * to someone who did not type the query param themselves.
 *
 * THE "GLOBAL CHROME" NOTE ABOVE IS STILL TRUE AND IS NOT WHAT BLOCKS THIS.
 * The shell cannot opt in per page, and this does not ask it to - the mode is
 * still one value for the whole tree at any moment. What changed is only how
 * the DEFAULT is computed: the route is now an input to it, alongside the query
 * param and the stored preference. The shell reads the same single value it
 * always did.
 */

export type DesignMode = 'current' | 'terminal';

export const DESIGN_STORAGE_KEY = 'lhq-design-mode';
export const DESIGN_QUERY_PARAM = 'design';

/** Routes that default to terminal with no query param and nothing stored.
 *  Exactly one today. A set rather than an `=== '/'` so adding a second is a
 *  data change, and so the bootstrap script in app/layout.tsx has one list to
 *  mirror rather than a condition to re-derive. */
export const TERMINAL_BY_DEFAULT_ROUTES = ['/'] as const;

/** Whether a pathname is terminal-by-default. Trailing slash tolerated because
 *  a visitor can arrive at either form and they are the same page. */
export function isTerminalByDefault(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return (TERMINAL_BY_DEFAULT_ROUTES as readonly string[]).includes(p || '/');
}

/**
 * Resolve the mode from a URL, a stored preference, and the current route.
 *
 * PRECEDENCE, highest first:
 *
 *   1. the query param   - `?design=terminal` / `?design=current`
 *   2. a stored value    - whatever the param last set, on every route
 *   3. the route default - terminal on `/`, current everywhere else
 *
 * The query param WINS and is sticky - `?design=terminal` turns it on and keeps
 * it on across navigation, `?design=current` turns it off again. Without that
 * second escape hatch the only way out would be devtools or clearing storage,
 * which is a bad trap to leave for whoever reviews this.
 *
 * A STORED VALUE OUTRANKS THE ROUTE DEFAULT, IN BOTH DIRECTIONS. `?design=current`
 * on `/` has to keep the visitor on the current landing across a reload, or it
 * is not an escape hatch - it is a button that undoes itself. Likewise stored
 * `terminal` keeps every app screen in terminal for review. #719 says both
 * hatches must survive, and this is the line that makes that true: the route
 * only decides for a visitor who has expressed no preference at all.
 *
 * `pathname` is optional so existing callers keep compiling, but omitting it
 * means "no route default" - not "default to terminal".
 *
 * A KNOWN COST, ACCEPTED DELIBERATELY (QA, on #724). The server knows the route
 * and nothing else - DesignModeProvider's server snapshot is ['', null], since
 * the query param and localStorage are both client-only. So on `/` the SSR pass
 * renders from the route default:
 *
 *     /?design=current            SSR terminal  -> hydrates to current
 *     /dashboard?design=terminal  SSR current   -> hydrates to terminal
 *
 * The second line was already true before #719. The FIRST is new: `/` used to
 * server-render current for everyone, and now someone opting out sees one
 * terminal frame before the client corrects. The palette itself does not flash
 * either way - the inline script in app/layout.tsx sets data-design before
 * paint - it is the component tree that arrives from the route.
 *
 * Not fixed, and the reason is a trade rather than difficulty: reading the
 * param server-side means `searchParams`, which opts `/` out of static
 * rendering. That charges every visitor on the default path to tidy up the rare
 * opt-out path. Recorded here so the next person finds it as a decision rather
 * than as a bug.
 *
 * Pure so it can be tested without a DOM; the provider does the effects.
 */
export function resolveDesignMode(
  search: string | null | undefined,
  stored: string | null | undefined,
  pathname?: string | null,
): DesignMode {
  const fromQuery = new URLSearchParams(search ?? '').get(DESIGN_QUERY_PARAM);
  if (fromQuery === 'terminal') return 'terminal';
  if (fromQuery === 'current')  return 'current';
  if (stored === 'terminal') return 'terminal';
  if (stored === 'current')  return 'current';
  return isTerminalByDefault(pathname) ? 'terminal' : 'current';
}

/**
 * What `data-design` should be, or null when the attribute should be absent.
 *
 * `current` REMOVES the attribute rather than setting `data-design="current"`.
 * There is no `[data-design="current"]` block and there should never be one -
 * the current design is what the stylesheet already does at :root, and adding a
 * second selector for it would mean every token had two homes.
 */
export function designAttribute(mode: DesignMode): string | null {
  return mode === 'terminal' ? 'terminal' : null;
}
