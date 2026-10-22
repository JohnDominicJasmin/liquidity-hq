/* What an /api/econ-calendar answer means for the calendar page and the dashboard widget. PURE - no network, no React.
 *
 * #1637 (R13): both read `d.events ?? []` from any answer, so the route's rate-limit reply - 429 {"error":"Rate limit exceeded"}, no
 * events, no source - and any 500 showed "No upcoming events": an outage presented as an empty calendar, the false statement #1625 set
 * out to remove. Only a successful answer that carries an events array is a calendar; everything else is a failed load. */

/** The calendar in an answer, or null when the answer is not one: a non-ok status, a body that is not an object, `source: 'none'` (the
 *  route saying it could not build a calendar, #1625), or no `events` array. An empty array from a real source is a real empty calendar. */
export function calendarFromResponse<T>(ok: boolean, body: unknown): { events: T[]; source: string } | null {
  if (!ok || typeof body !== 'object' || body === null) return null;
  const d = body as { events?: unknown; source?: unknown };
  if (d.source === 'none' || !Array.isArray(d.events)) return null;
  return { events: d.events as T[], source: typeof d.source === 'string' ? d.source : '' };
}
