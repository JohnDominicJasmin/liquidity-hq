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
 * TERMINAL IS THE DEFAULT, EVERYWHERE (#748, 2026-09-04). Owner: "remove
 * ?design terminal make terminal design default".
 *
 * This reverses #719, which had shipped terminal on `/` alone, and it retires
 * the route list that made that possible - there is no longer a route whose
 * default differs, so `TERMINAL_BY_DEFAULT_ROUTES` and `isTerminalByDefault`
 * are gone rather than left holding every route in the app. `pathname` is no
 * longer an input to the resolver at all.
 *
 * THE QUERY PARAM STAYS, and `?design=terminal` is now a no-op that names the
 * default. `?design=current` is the reason to keep the mechanism: it is the
 * only way back to the previous design without a deploy, it is how the two get
 * compared, and it is what QA's sweeps use to measure the design a user is NOT
 * getting. Removing the param entirely would read the owner's instruction as
 * "delete the escape hatch", which is not what it says and would make a
 * rollback a code change.
 *
 * WHAT THIS COSTS ON THE FIRST FRAME. The trade recorded below under
 * `resolveDesignMode` now applies to every route rather than to `/`: a visitor
 * who has opted OUT gets one terminal-rendered frame from the server before
 * the client corrects. The palette does not flash - the inline script in
 * app/layout.tsx sets data-design before paint - it is the component tree that
 * arrives from the default. Wider than it was, and the same decision.
 */

export type DesignMode = 'current' | 'terminal';

export const DESIGN_STORAGE_KEY = 'lhq-design-mode';
export const DESIGN_QUERY_PARAM = 'design';

/**
 * Resolve the mode from a URL and a stored preference.
 *
 * PRECEDENCE, highest first:
 *
 *   1. the query param - `?design=current` / `?design=terminal`
 *   2. a stored value  - whatever the param last set
 *   3. terminal        - the default, on every route (#748)
 *
 * The query param WINS and is sticky, so `?design=current` turns the previous
 * design back on and KEEPS it on across navigation. Without that the only way
 * out would be devtools or clearing storage, which is a bad trap to leave for
 * whoever reviews this - and after #748 it is also the only rollback that does
 * not need a deploy.
 *
 * A STORED VALUE OUTRANKS THE DEFAULT. That single line is what makes the
 * escape hatch real: without it, every load would re-assert terminal and a
 * stored 'current' would be inert - a button that undoes itself.
 *
 * A KNOWN COST, ACCEPTED DELIBERATELY (QA, on #724; widened by #748). The
 * server knows nothing - DesignModeProvider's server snapshot is ['', null],
 * since the query param and localStorage are both client-only. So the SSR pass
 * always renders the default:
 *
 *     /?design=current            SSR terminal -> hydrates to current
 *     /dashboard?design=current   SSR terminal -> hydrates to current
 *
 * Before #748 this affected `/` alone; now it is every route. It is still the
 * OPT-OUT path that pays, which is the right way round - the common case is
 * server-rendered correctly. The palette does not flash either way, because the
 * inline script in app/layout.tsx sets data-design before paint; it is the
 * component tree that arrives from the default.
 *
 * Not fixed, and the reason is a trade rather than difficulty: reading the
 * param server-side means `searchParams`, which opts every page out of static
 * rendering. That charges every visitor on the default path to tidy up the rare
 * opt-out path. Recorded here so the next person finds it as a decision rather
 * than as a bug.
 *
 * Pure so it can be tested without a DOM; the provider does the effects.
 */
export function resolveDesignMode(
  search: string | null | undefined,
  stored: string | null | undefined,
): DesignMode {
  const fromQuery = new URLSearchParams(search ?? '').get(DESIGN_QUERY_PARAM);
  if (fromQuery === 'terminal') return 'terminal';
  if (fromQuery === 'current')  return 'current';
  if (stored === 'terminal') return 'terminal';
  if (stored === 'current')  return 'current';
  return 'terminal';
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
