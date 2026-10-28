/* THE LABEL CHANGES AWAITING A PHONE-WIDTH MEASUREMENT, AND THE REASON THIS IS A MODULE RATHER THAN A
 * CONST IN THE SPEC.
 *
 * `docs/OWNER-RULES.md` §7 (owner, 2026-10-28): label copy lives in the database, so a wording change
 * reaches the live site with no build, no tests and no staging. The owner approves the TEXT; the render is
 * ours. He chose an automatic check over eyeballing it, because a standing rule to check `text-transform`
 * before approving a label with units already existed and was not followed.
 *
 * THE RULE AS FIRST WRITTEN STILL RELIED ON REMEMBERING, which is the thing it was closing. It said: add a
 * `TARGETS` entry to the spec and run it. Running the spec alone was never compliance - `TARGETS` was a
 * hardcoded list, so a seventh label was simply not measured and the run went green without it. Whoever
 * followed the rule saw six green cells that did not include their label.
 *
 * SO THE SHAPE CHANGED: there is now ONE list, and a candidate cannot exist in it without the information
 * needed to measure it. `path` and `note` are required fields. An entry that is injected but not measured is
 * no longer possible to write - which is the #1771 defect (six values injected, five measured) made
 * structurally impossible rather than caught by review a second time.
 *
 * `key` is typed `LabelKey`, so a misspelled key is a COMPILE error in the pre-push gate. That matters more
 * than it looks: `installLabelOverride` writes `labels[k] = v` into the real payload, so a typo'd key writes
 * something nothing reads, the page renders the ORIGINAL string, and the cell passes while reporting the new
 * one. A vacuous pass that reads exactly like a real one.
 *
 * The import is `import type`, so it is erased at runtime and this module stays dependency-free - the same
 * split as `lib/econCoverage.ts`. No `@playwright/test` either: a unit test in the gate imports this, and
 * `__tests__/labelCandidates.test.mts` is what enforces the rule on every push.
 *
 * WHEN TO ADD AN ENTRY, from §7: when the new value is LONGER than the old, or lands in a fixed-width
 * container. A change that shortens a string cannot clip. */
import type { LabelKey } from '../lib/labelKeys.ts';

/** How to reveal a label that is not on the page at rest. A NAME, not a function, so this module needs no
 *  browser types; the spec maps it to the opener. A new name here is a compile error there until handled. */
export type OpenerName = 'scannerFlyout';

export interface LabelCandidate {
  /** Typed, so a typo cannot reach a run. */
  key: LabelKey;
  /** The approved new text, as it will be written to `lhq_labels`. */
  now: string;
  /** What it was, so the report says how much longer it got rather than only how wide it is. */
  was: string;
  /** The route that renders it. Required: a candidate with nowhere to look is not measurable. */
  path: string;
  /** How it renders - transform, tracking, container. Required: this is what makes a failure readable. */
  note: string;
  /** Set when the label is behind an interaction. */
  opener?: OpenerName;
  /** §7's SECOND trigger: "longer than the old, OR lands in a fixed-width container".
   *
   *  The enforcement test otherwise requires `now` to be longer, because a shortening change cannot clip and
   *  a swapped pair would silently measure the old string. But that rejects the other half of the rule - a
   *  label of the same length, or shorter, moving into a 40px track still needs measuring. Without this flag
   *  the check would BLOCK such a candidate, and the author's cheapest way out would be to drop the
   *  candidate rather than argue with the test. A guard whose false alarm removes a protection is worse than
   *  no guard, so the second trigger gets an explicit opt-in rather than a silent exception. */
  coversFixedWidth?: boolean;
  /** A candidate EXPECTED not to fit, pinning a constraint that caused a revert. Its cell goes red if
   *  someone widens the track, drops the tracking or shortens the string - all of which would mean the long
   *  form had become viable and the revert could be revisited. */
  expectOverflow?: boolean;
}

/* The values as MEASURED on production `lhq_labels`, locale en, 2026-10-27 - not invented and not taken from
   the issue text, because an injected value that does not match production would measure a string nobody
   ships.

   ONE OF THEM NO LONGER MATCHES PRODUCTION, AND THAT IS DELIBERATE. `ARENA_SCANNER_COL_24H` was reverted to
   `24h` on production and dev at ~12:00Z on 2026-10-27, because this spec measured the long form CLIPPING
   its 40px track - box 40x33, scrollWidth 42 against clientWidth 40. The long form is kept as the constraint
   under test: `expectOverflow` asserts that `24 HOURS` does NOT fit, which is the finding that caused the
   revert. Every other value is production's current string. */
export const CANDIDATES: LabelCandidate[] = [
  {
    key: 'MARKET_CONDITIONS_WIDGET_RSI_LABEL',
    now: 'BTC RSI (15-minute chart)', was: 'BTC RSI (14, 15m)',
    path: '/dashboard',
    note: 'uppercase inline, .06em tracking, flex space-between with the value on the right',
  },
  {
    key: 'HOURS_SESSION_MAP_TITLE',
    now: '24-hour session map', was: '24h Session Map',
    path: '/hours',
    note: 'uppercase via .lbl, .12em tracking',
  },
  {
    key: 'MARKETS_24H_COL_LABEL',
    now: '24 hours', was: '24h',
    path: '/markets',
    note: 'column header, right-aligned',
  },
  {
    key: 'FUNDING_RANGE_24H',
    now: '24 hours', was: '24h',
    path: '/funding',
    note: 'range selector',
  },
  /* /arena, not /dashboard - AbsorptionDetector renders from app/arena/page.tsx. And the badge is gated on
     `d.mtfConfirmed` (AbsorptionDetector.tsx:342), a live-market condition, so it is absent most of the time
     through no fault of the override. The spec's sentinel tells those two apart, and the opener is here FOR
     THE SENTINEL: opening the flyout puts a known injected string on the page, which lets the sentinel
     confirm the override took and attribute the missing badge correctly. */
  {
    key: 'ABSORPTION_DETECTOR_MTF_BADGE',
    now: '1-hour ✓', was: '1H ✓',
    path: '/arena',
    note: 'badge, flex-shrink: 0, gated on d.mtfConfirmed',
    opener: 'scannerFlyout',
  },
  /* THE SIXTH, ADDED AFTER PM AND DEV CAUGHT IT MISSING - it was in the injected values and absent from the
     measured list. The strongest candidate in the set rather than an also-ran:
       - it renders UPPERCASE (app/arena/page.tsx:2014, textTransform uppercase, letterSpacing .07em,
         fs-micro), so this change has THREE uppercase labels and the spec was measuring two;
       - the flyout grid at <=480px is `1fr 65px 40px 60px 28px` (globals.css:1588) with `vsbtc` hidden, and
         the full column array is name, price, 24h, vsbtc, status, score - so the five VISIBLE headers map
         onto the five tracks and `24h` lands on the 40px one;
       - the string goes `24H` -> `24 HOURS`.
     `24H` fits 40px. `24 HOURS` uppercased and letter-spaced is exactly what this spec exists to catch, and
     if it cannot fit then "leave it uppercase" is not an option the owner can pick for this label at all. */
  {
    key: 'ARENA_SCANNER_COL_24H',
    now: '24 hours', was: '24h',
    path: '/arena',
    note: 'flyout column header, 40px fixed track at <=480px, uppercase + .07em tracking',
    opener: 'scannerFlyout',
    /* The worked example of §7's second trigger, and the reason the flag is not theoretical: this one is
       both longer AND in a fixed track, so it would qualify either way - but it is the case the rule was
       written from, so it is the one that should carry the flag. */
    coversFixedWidth: true,
    expectOverflow: true,
  },
];

/** The payload patch the spec injects into `/api/labels`. Derived, never maintained alongside `CANDIDATES` -
 *  a second list is a second thing to forget, which is the whole failure this module exists to prevent. */
export function candidateValues(): Record<string, string> {
  return Object.fromEntries(CANDIDATES.map((c) => [c.key, c.now]));
}
