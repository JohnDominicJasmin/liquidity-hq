import { test, expect } from '@playwright/test';
import { getGuarded } from './_shared';

/* /api/econ-calendar — the invariants that hold whatever the upstreams do.
 *
 * WHY THIS EXISTS. The owner found the bug, not us, and nothing covered this
 * route's output at all. What they reported was PPI showing on Tuesday when the
 * real release was Thursday (#245).
 *
 * The cause was worse than a wrong date. `computeMacroSchedule` is the LAST of
 * four sources and hardcodes a day of the month - CPI the 12th, PPI the 11th,
 * Retail the 15th - with no weekday logic. Its own header admits it is
 * "accurate within a few days". That approximation was not the defect; shipping
 * it as fact was. Two consequences were live on the deployed service:
 *
 *   RETAIL 2026-08-15 = Saturday      no US agency has ever released on one
 *   CPI    2026-09-12 = Saturday
 *
 * and, the one the owner actually saw, the SAME release on two dates - the real
 * Thursday PPI sitting underneath a computed Tuesday one that carried a genuine
 * `actual` from FRED and therefore looked like the more complete of the two.
 *
 * WHAT THIS FILE ASSERTS is only what must be true regardless of whether
 * Finnhub, ForexFactory or FRED answered. A spec that pinned specific dates
 * would fail every time a real calendar moved, which is how a suite teaches
 * people to ignore it.
 */

const ENDPOINT = '/api/econ-calendar';

interface CalEvent {
  name: string;
  type: string;
  isoDate: string;
  impact: string;
  estimated?: boolean;
  actual?: string;
  previous?: string;
  estimate?: string;
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const describeEvent = (e: CalEvent) =>
  `${e.type} ${e.isoDate.slice(0, 10)} ${DAY[new Date(e.isoDate).getUTCDay()]}` +
  `${e.estimated ? ' ~est' : ''}${e.actual ? ` actual=${e.actual}` : ''}`;

test.describe('/api/econ-calendar', () => {
  // HTTP level - the viewport is irrelevant and running both projects would
  // double the requests to a route that fans out to three third parties.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'HTTP-level, viewport irrelevant');
  });

  let events: CalEvent[] = [];
  let source = '';

  test.beforeAll(async ({ request }) => {
    const res = await getGuarded(request, ENDPOINT, { failOnStatusCode: false });
    expect(res.status(), 'the calendar route did not answer').toBe(200);
    const body = await res.json();
    events = Array.isArray(body.events) ? body.events : [];
    source = String(body.source ?? '(none reported)');
    // eslint-disable-next-line no-console
    console.log(`[econ-calendar] source=${source} events=${events.length} ` +
      `estimated=${events.filter(e => e.estimated).length}`);
  });

  /* ── The control, and it runs first ─────────────────────────────────────────
   *
   * Every assertion below is of the form "no event does X". An empty list
   * satisfies all of them perfectly. That exact shape - a green tick on a dead
   * endpoint - happened to `/api/market/snapshot` in the last CI run before the
   * shutdown, where all three parts were empty and the invariant held anyway.
   *
   * An empty result is not evidence unless something proves the instrument
   * reached the thing it is measuring. */
  test('control: the calendar returned events at all', () => {
    expect(events.length,
      `${ENDPOINT} returned no events, so every assertion in this file is vacuous. ` +
      `This is a FINDING, not a pass - all four sources (Finnhub, ForexFactory, FRED, ` +
      `computed) produced nothing, and the computed one cannot fail. source=${source}`)
      .toBeGreaterThan(0);
  });

  /* ── The impossible date ────────────────────────────────────────────────────
   *
   * A hardcoded day of the month has no idea what a weekend is. This is the
   * cheapest possible proof that a date was generated rather than sourced, and
   * two were live when the owner reported the bug. */
  test('no release falls on a weekend', () => {
    const weekend = events.filter(e => [0, 6].includes(new Date(e.isoDate).getUTCDay()));
    expect(weekend.map(describeEvent),
      'a US macro release is scheduled on a weekend. No federal statistical agency ' +
      'has ever done that, so this date was computed rather than sourced.')
      .toEqual([]);
  });

  /* ── The owner's bug ────────────────────────────────────────────────────────
   *
   * The real Thursday PPI and a computed Tuesday PPI were both in the payload.
   * The dedup key was `type|YYYY-MM-DD`, so two dates for one release were two
   * different keys and both survived.
   *
   * MONTH, not day - comparing by day is precisely the check that let this
   * through. These releases are monthly, so a type appearing twice in one
   * calendar month is the same release counted twice. */
  test('no release type appears twice in the same calendar month', () => {
    const byTypeMonth = new Map<string, CalEvent[]>();
    for (const e of events) {
      const key = `${e.type}|${e.isoDate.slice(0, 7)}`;
      byTypeMonth.set(key, [...(byTypeMonth.get(key) ?? []), e]);
    }
    const dupes = [...byTypeMonth.entries()]
      .filter(([, v]) => v.length > 1)
      .map(([k, v]) => `${k} -> ${v.map(describeEvent).join(' AND ')}`);

    expect(dupes,
      'the same monthly release appears on two dates. This is what the owner saw: ' +
      'a real entry and a computed one for the same release, and the computed one ' +
      'looked MORE authoritative because it carried a real `actual` figure.')
      .toEqual([]);
  });

  /* ── The sharpest one ───────────────────────────────────────────────────────
   *
   * `actual` means the release HAPPENED and we have the number. `estimated`
   * means we guessed the date. Both at once is a contradiction, and it is
   * exactly the entry that caused this issue: a fabricated Tuesday carrying a
   * genuine -1.3% from FRED.
   *
   * This is the assertion I would keep if I could only keep one. A wrong date is
   * a wrong date; a wrong date wearing a real number is the one people believe. */
  test('no event is both an estimate and already released', () => {
    const contradictory = events.filter(e => e.estimated && e.actual).map(describeEvent);
    expect(contradictory,
      'an event is flagged `estimated` while carrying an `actual` figure. If we have ' +
      'the number the release happened, so the date is not a guess - and a computed ' +
      'date wearing real data is the most convincing wrong answer this route can give.')
      .toEqual([]);
  });

  test('every event has a parseable date and a type', () => {
    const malformed = events
      .filter(e => !e.type || !e.isoDate || isNaN(new Date(e.isoDate).getTime()))
      .map(e => JSON.stringify(e).slice(0, 120));
    expect(malformed, 'an event has no usable date or type').toEqual([]);
  });

  /* ── Recorded, deliberately NOT asserted ────────────────────────────────────
   *
   * Whether the live feeds answered is a property of three third parties on the
   * day, not of our code. Asserting it would produce a red run that nobody can
   * act on, and this suite already carries one lesson about specs that fail for
   * reasons outside the change under test.
   *
   * But it is worth PRINTING, because "everything is computed" is the state that
   * produced this bug - and #245 found `FINNHUB_KEY` unset on the service, which
   * `route.ts:6` turns into a silent empty array. A number in the log is how the
   * next person notices without a spec that cries wolf. */
  test('record which sources answered, so a silent fallback is visible', () => {
    /* THE FLAG'S ABSENCE IS NOT THE SAME AS EVERY EVENT BEING REAL, and the
     * first version of this test got that wrong in the exact way this suite
     * keeps catching elsewhere.
     *
     * Run against a build predating #247 there is no `estimated` property at
     * all, so `events.length - flagged` computed 19 and the line read
     * "19 from live feeds · 0 computed" - a confident, wrong number, on a
     * payload where two dates were fabricated. `qa` and `staging` are still on
     * that build today, so this is a live case rather than a hypothetical.
     *
     * Absent flag and false flag have to be distinguishable. */
    const flagPresent = events.some(e => Object.prototype.hasOwnProperty.call(e, 'estimated'));

    if (!flagPresent) {
      // eslint-disable-next-line no-console
      console.log(`[econ-calendar] source=${source} · ${events.length} events · ` +
        'ESTIMATED FLAG ABSENT - this build predates #247, so which entries are computed ' +
        'cannot be determined from the payload. Reporting unknown rather than assuming real.');
      return;
    }

    const est = events.filter(e => e.estimated).length;
    // eslint-disable-next-line no-console
    console.log(`[econ-calendar] source=${source} · ${events.length - est} from live feeds · ${est} computed`);

    if (est === events.length) {
      // eslint-disable-next-line no-console
      console.log('[econ-calendar] WARNING: every event is computed. Live feeds returned ' +
        'nothing - check FINNHUB_KEY and whether ForexFactory is rate-limiting (it bails ' +
        'on a non-XML body with no log). Not failing the run: upstream availability is ' +
        'not this repo\'s behaviour.');
    }
  });
});
