/* Times as an AI prompt states them (#1631 A). PURE.
 *
 * A model asked to cite a catalyst with its date can only do that if the input carries one. The news feed and the released events reached
 * the prompt as bare headlines and "16h ago", so check 2's Deep runs presented 16 h and 52 h old events as live. Every dated line now says
 * when, in UTC (the user's local zone means nothing to the model), and how long ago. */

/** "2026-10-21 05:12 UTC" */
export function utcStamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

/** "just now", "45m ago", "3h ago", "2d ago" - from an elapsed time in ms. A time in the future reads "upcoming". */
export function ageText(elapsedMs: number): string {
  if (elapsedMs < 0) return 'upcoming';
  const m = Math.floor(elapsedMs / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
