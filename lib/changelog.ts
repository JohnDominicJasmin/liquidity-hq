// Public release notes for /changelog (#1810 item 1).
//
// ENGLISH DATA, NOT LABEL KEYS - the same choice lib/glossary.ts already makes
// for /learn. Two reasons, and the second is the one that decided it:
//
//   1. ~22 releases x 2-4 lines is ~60 new keys in lib/labelKeys.ts, which is a
//      LANDING HARD GATE file. Page chrome goes through t() like every other
//      page; the entries themselves do not.
//   2. A new key renders English in every locale anyway until somebody seeds a
//      translation row, because LabelsProvider merges the fetched map OVER
//      lib/labelDefaults.en.json. So t() would buy nothing today and cost a
//      translation bill on every future release.
//
// SOURCE: `git tag --sort=-creatordate --format='%(creatordate:short) %(refname:short) %(subject)'`.
// The tag is kept here as provenance and is deliberately NOT rendered.
//
// THREE EDITORIAL RULES, because the tag text will fight you on all of them:
//
//   1. Tag subjects are written for US - issue numbers, Render deploy ids,
//      /api/version hashes, branch names. Those are stripped. Rewriting the
//      rest in plain language is summarising, not inventing.
//   2. Work that is not user-visible, or that shipped deliberately switched
//      off, is DROPPED rather than described. Several tags say so outright
//      ("payments still OFF", "shipped dormant", "dark on production while
//      payments are off", "Backtest hidden"). Listing a dormant or hidden
//      feature breaks the owner's standing rule that copy says only what the
//      product does today, and "Backtest is hidden" names a missing feature
//      outright.
//   3. A release with nothing user-visible left after (1) and (2) does not get
//      an entry. v2026.10.23, v2026.09.11 and v2026.09.07 carry no description
//      at all; they are absent rather than invented. Per PM, bare tags are NOT
//      backfilled.
//
// WHERE THE LIST STARTS. 2026-09-05 is the first tag with a real description;
// everything before it is "Release <date>". FIRST_ENTRY_NOTE on the page says
// so, so a reader is not left wondering whether the product existed before it.
//
// KNOWN GAP, stated rather than hidden: nothing updates this file when a
// release ships. It is a file somebody has to remember to edit - the same shape
// as RELEASE_PR_PAUSED. Making the tag the source at build time would fix it
// and is not in this change.

export interface ChangelogEntry {
  /** ISO date of the tag, used as the heading and the React key. */
  date: string;
  /** The git tag this came from. Provenance for the next editor; never rendered. */
  tag: string;
  /** Plain-language, user-visible lines. Never empty - an entry with no items is omitted instead. */
  items: string[];
}

/** Newest first, which is the order the page renders. */
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-10-29',
    tag: 'v2026.10.29b',
    items: [
      'Applied a security patch to the web framework the site runs on.',
    ],
  },
  {
    date: '2026-10-29',
    tag: 'v2026.10.29',
    items: [
      'Published a refund and cancellation policy.',
      'Subscribers can see and cancel their own subscription.',
    ],
  },
  {
    date: '2026-10-28',
    tag: 'v2026.10.28',
    items: [
      'AI Arena falls back to another exchange when its usual one is unavailable.',
      'Fixed the economic calendar table layout.',
      'The About page now lists where each piece of market data comes from.',
    ],
  },
  {
    date: '2026-10-27',
    tag: 'v2026.10.27',
    items: [
      'The economic calendar shows how much of the period it actually has data for.',
      'The position-size calculator can be found by search engines.',
    ],
  },
  {
    date: '2026-10-26',
    tag: 'v2026.10.26',
    items: [
      'Search-engine fixes: canonical page addresses, and language tags for English, Korean and Chinese.',
      'The Playbook page gained a proper heading.',
    ],
  },
  {
    date: '2026-10-24',
    tag: 'v2026.10.24',
    items: [
      'The site became visible to search engines.',
    ],
  },
  {
    date: '2026-10-22',
    tag: 'v2026.10.22',
    items: [
      'AI answers check their own figures before showing them.',
      'Price alerts are held until they have been delivered, instead of being dropped.',
      'Added a public health endpoint, which is what the Status page reads.',
      'Hardened sign-in and the calls the platform makes to exchanges.',
    ],
  },
  {
    date: '2026-10-21',
    tag: 'v2026.10.21',
    items: [
      'Fixed an out-of-memory crash caused by how sign-in tokens were checked.',
      'Charts and RSI now use closed candles, so a value stops changing underneath you mid-candle.',
      'Polled market data is no longer served from the browser cache.',
    ],
  },
  {
    date: '2026-10-17',
    tag: 'v2026.10.17',
    items: [
      'Fixed an AI Arena chart freeze, and a bug that drew the wrong timeframe.',
      'Added a loading state where the Arena previously showed nothing.',
    ],
  },
  {
    date: '2026-10-08',
    tag: 'v2026.10.08',
    items: [
      'Indicator chips now match what the chart is drawing.',
      'Fixed the header for signed-out visitors.',
      'Added a support contact address to the site.',
    ],
  },
  {
    date: '2026-10-06',
    tag: 'v2026.10.06.2',
    items: [
      'Reworked the plan-selection layout on the pricing page so the billing choices line up.',
    ],
  },
  {
    date: '2026-10-06',
    tag: 'v2026.10.06',
    items: [
      'Settings no longer overflows a phone screen.',
    ],
  },
  {
    date: '2026-10-01',
    tag: 'v2026.10.01.4',
    items: [
      'Alert processing no longer stops after 1,000 records.',
      'The save confirmation moved to where it can be seen.',
      'Faster timeframes are enforced on the server rather than in the browser.',
    ],
  },
  {
    date: '2026-10-01',
    tag: 'v2026.10.01.3',
    items: [
      'Market Read waits for all of its inputs before showing a result.',
      'AI Arena says what state it is in instead of showing a blank panel.',
      'Price alerts are paged, so a long list loads.',
      'More translated copy, and a third batch of accessibility fixes.',
    ],
  },
  {
    date: '2026-10-01',
    tag: 'v2026.10.01.2',
    items: [
      'Fixed the dashboard grid.',
    ],
  },
  {
    date: '2026-10-01',
    tag: 'v2026.10.01',
    items: [
      'An address that does not exist now answers with a proper 404 page.',
      'Pages are served from cache again.',
      'Added loading and error states, and hints, across the app.',
    ],
  },
  {
    date: '2026-09-27',
    tag: 'v2026.09.27',
    items: [
      'Fixed product analytics so personal data is not captured.',
    ],
  },
  {
    date: '2026-09-26',
    tag: 'v2026.09.26',
    items: [
      'Market data is saved, so a panel can show the last known values when a feed is briefly unavailable.',
    ],
  },
  {
    date: '2026-09-19',
    tag: 'v2026.09.19',
    items: [
      'The Pro badge survives a sign-in event instead of disappearing.',
      'The About page gained a contact card.',
      'Completed an audit pass over AI Arena.',
    ],
  },
  {
    date: '2026-09-18',
    tag: 'v2026.09.18',
    items: [
      'Visual updates to AI Arena, and an audit of the indicators it calculates as you watch.',
    ],
  },
  {
    date: '2026-09-17',
    tag: 'v2026.09.17b',
    items: [
      'Keyboard focus indicators across the app.',
      'The macro panel no longer fills a gap with an invented value.',
      'Fixed the direction handling in the calculators.',
      'Wording corrections across all five languages.',
    ],
  },
  {
    date: '2026-09-17',
    tag: 'v2026.09.17',
    items: [
      'Market data and alerts fail over to Bybit when Binance is unavailable.',
      'Fixed navigation on tablet widths.',
      'Fixed a Strategy Panel save that could overwrite itself.',
      'Dialogs keep keyboard focus inside them while open.',
    ],
  },
  {
    date: '2026-09-12',
    tag: 'v2026.09.12b',
    items: [
      'Settings stay consistent across devices.',
      'Fixed a false CVD alert on HYPE.',
      'Fixed a group of failures that were happening silently.',
    ],
  },
  {
    date: '2026-09-12',
    tag: 'v2026.09.12',
    items: [
      'Settings are no longer lost when a save fails.',
      'A clear message when your plan status cannot be read, instead of a guess.',
      'Strategy Panel choices persist.',
      'Liquidation labels on the chart.',
    ],
  },
  {
    date: '2026-09-10',
    tag: 'v2026.09.10',
    items: [
      'AI Arena restored to the approved layout.',
      'Live market data streams over a WebSocket, with Bybit as the primary source.',
    ],
  },
  {
    date: '2026-09-06',
    tag: 'v2026.09.06b',
    items: [
      'The coin health grade has an accessible name, so a screen reader announces it.',
    ],
  },
  {
    date: '2026-09-06',
    tag: 'v2026.09.06',
    items: [
      'The setup-quality tooltip can be reached from the keyboard.',
    ],
  },
  {
    date: '2026-09-05',
    tag: 'v2026.09.05',
    items: [
      'The terminal design became the default on every page.',
    ],
  },
];
