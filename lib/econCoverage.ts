/* How many economic-calendar events actually carry a value, per field (#1651).
 *
 * In lib/ and DEPENDENCY-FREE on purpose, the same split as lib/newsTs.ts, lib/fng.ts and
 * lib/structuredData.ts: the interesting decision should not need a route, a request or credentials to
 * exercise. app/api/econ-calendar/ingest/route.ts imports these; nothing here imports anything.
 *
 * WHY IT MOVED OUT OF THE HANDLER, and the reason is narrower than "for testability".
 *
 * The bug this file exists to prevent is UNREACHABLE FROM OUTSIDE. All three fields are absent from every
 * event today, so a test driven through the route - or through /api/econ-calendar's real payload - gives
 * the same answer on the correct version and on the broken one. The only test that distinguishes them is
 * one that PLANTS a value, and planting one means calling the function directly. As a closure inside the
 * handler it could not be called at all.
 *
 * So this is not a general tidy-up. It is that a test over today's payload passes on the buggy version,
 * which makes it worse than no test: it closes the checkbox. QA asked for the lift on exactly that
 * argument and the boundary is theirs, not dev's - a dev quietly restructuring for testability is how a
 * test boundary drifts without anyone agreeing to it.
 *
 * ── WHAT THE NUMBERS MEAN, SO A ZERO IS NOT READ AS A FAILURE ───────────────────────────────────────
 *
 * Traced on production 001d0c1, 2026-10-26, rather than inferred from the empty table:
 *
 *   actual    produced by enrichWithFRED, and ONLY for events already past (30-day window). Every event
 *             in a forward-looking calendar is in the future, so 0/n is CORRECT here and fills in as
 *             releases happen.
 *   previous  NO PRODUCER. Declared on CalEvent, assigned by nothing in the codebase.
 *   estimate  NO PRODUCER, same.
 *
 * `previous 0/20` therefore reads zero FOREVER until something produces those values. That is the
 * intended output, not a symptom. Finnhub is not involved at any point: /api/econ-calendar never calls
 * it - the dates come from the agencies' own published schedules and the values from FRED. */

/** The three value columns the calendar draws and the only ones with a `-`/value distinction worth
 *  counting. `delta` is excluded because the page DERIVES it from `actual` and `estimate`; counting a
 *  computed column would report the same gap twice and make one of them look independent. */
export const VALUE_FIELDS = ['actual', 'previous', 'estimate'] as const;
export type ValueField = (typeof VALUE_FIELDS)[number];

/** Is this field PRESENT and usable - not merely truthy?
 *
 *  THE FIRST VERSION WAS `filter((e) => e[key])`, and truthiness gets the one interesting case wrong:
 *
 *    0        a 0.0% CPI print is a real release, correctly ingested, and falsy. The counter exists to
 *             confirm that reading arrived and it would have reported it as missing.
 *    '   '    whitespace from an upstream is a missing value wearing a string, and truthy.
 *    NaN      a malformed figure parsed to NaN is not undefined, not null and not a string, so it
 *             passes an existence test while being unusable. "Is it there" and "is it usable" are
 *             different questions, and a coverage counter answers the second whether it means to or
 *             not - a feed that returns NaN for every print would report full coverage.
 *    Infinity the same case one value along, and the first fix MISSED IT. `Number('1e999')` is
 *             Infinity, so it arrives by exactly the route NaN does: an upstream figure that does not
 *             parse to a real number. Excluding NaN while admitting Infinity splits a class the rest
 *             of this repo already treats as one - __tests__/numberFormatProperties.test.mts F7 reads
 *             "an unknown number (NaN, Infinity) is never printed as one".
 *
 *  SO THE TEST IS `Number.isFinite`, NOT `!Number.isNaN`. Naming the two bad values one at a time is
 *  how the second was missed: the rule is "a usable figure", and every non-finite number fails it
 *  including ones nobody has thought of. Enumerating exceptions invites a third.
 *
 *  None of the three is reachable today, because the fields are absent entirely. That is the argument
 *  for fixing them now rather than later: the moment a producer exists is the same moment someone
 *  starts trusting the number, and after that a wrong counter reads exactly like a working one.
 *  `previous 19/20` on a day one print was 0.0 looks like a feed with one gap.
 *
 *  Same family as lib/fng.ts, where `parseInt('0x1f', 10)` is 0 and 0 is extreme fear, so a malformed
 *  read fired a real alert. A falsy-but-valid zero is a recurring shape here, not a one-off. */
export function hasValue(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (typeof v === 'number') return Number.isFinite(v);
  return true;
}

/** How many of `events` carry a usable value for `field`. */
export function coverageOf(events: readonly unknown[] | null | undefined, field: ValueField): number {
  return (events ?? []).filter(e =>
    hasValue(e == null ? undefined : (e as Record<string, unknown>)[field])
  ).length;
}

/** `actual 0/20, previous 0/20, estimate 0/20` - the line that goes in the console and in the
 *  api_health detail, so the next reader gets a number instead of inferring one from a table of
 *  dashes. An empty calendar gives `0/0` for all three rather than throwing. */
export function formatFieldCoverage(events: readonly unknown[] | null | undefined): string {
  const total = events?.length ?? 0;
  return VALUE_FIELDS.map(f => `${f} ${coverageOf(events, f)}/${total}`).join(', ');
}
