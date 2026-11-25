/* HOW LONG THE PAGE HAS ACTUALLY BEEN WATCHING LIQUIDATIONS (#1651). "None in the last 4 hours" is only true of a page that watched
 * them: one opened a minute ago, or with the feed down, has seen nothing because it was not looking. */

export const CASCADE_LOOKBACK_MS = 4 * 60 * 60_000;

/** What the AI is told when no cascade is held. `since` is when the feed last started receiving without a break; null while it is not. */
export function noCascadeLine(since: number | null, now: number): string {
  if (since == null) return 'Not watching liquidations right now - do not assume there were none';
  const watched = Math.max(0, now - since);
  if (watched >= CASCADE_LOOKBACK_MS) return 'None in last 4h';
  return `None seen in the ${Math.floor(watched / 60_000)} min this page has watched - earlier hours are unknown`;
}
