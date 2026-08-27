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
 * DEFAULT IS THE CURRENT DESIGN. Turning this on is deliberate and per-browser.
 * It is not an A/B test and it is not sampled - no user sees the redesign by
 * accident, and no screen changes for anyone until the default flips at the end
 * of the migration.
 */

export type DesignMode = 'current' | 'terminal';

export const DESIGN_STORAGE_KEY = 'lhq-design-mode';
export const DESIGN_QUERY_PARAM = 'design';

/**
 * Resolve the mode from a URL and a stored preference.
 *
 * The query param WINS and is sticky - `?design=terminal` turns it on and keeps
 * it on across navigation, `?design=current` turns it off again. Without that
 * second escape hatch the only way out would be devtools or clearing storage,
 * which is a bad trap to leave for whoever reviews this.
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
  return stored === 'terminal' ? 'terminal' : 'current';
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
