/* Which feed timestamps the news ingest believes, and which rejections are worth a log line.
 *
 * In lib/ and DEPENDENCY-FREE on purpose, the same split as lib/fng.ts, lib/labelOverrides.ts and
 * lib/structuredData.ts: the interesting decision should not need a route, a request or credentials to
 * exercise. app/api/news/ingest/route.ts imports these; nothing here imports anything.
 *
 * WHY THESE MOVED, stated precisely because the reason given for the move was not quite the reason.
 * The report was that `node --test` cannot load the route at all, since it imports `next/server`. That
 * is not so: with `--import ./qa/alias-register.mjs` - the loader the suite already uses - the route
 * loads and these symbols import cleanly, and `__tests__/resolveAlertOutcomes.test.mts` has been
 * importing `GET` from a route under app/api all along. Exporting them was sufficient.
 *
 * They moved anyway, for the two reasons that do hold: a test of a pure function should not depend on
 * a loader hook resolving a framework module it has no use for, and `notableOf` could not be exported
 * from inside the handler at all - which left the warn gate uncoverable except by re-implementing it
 * in the test, which only ever asserts the copy. */

/** Older than this and it cannot be "breaking" - it is already past the client's own 6h display
 *  cutoff, so ingesting it would produce a dead row. */
export const MAX_AGE_SEC = 6 * 3600;

/* HOW FAR AHEAD OF OUR OWN CLOCK A FEED'S TIMESTAMP MAY BE AND STILL BE BELIEVED (#1651).
 *
 * Nothing used to test this end. All three ingest loops checked `ts < cutoff` and nothing checked
 * too-new, so a future-stamped item was stored - and because the client sorts on `published_at`
 * descending (components/NewsProvider.tsx:336), it pinned itself to the top of the feed as the newest
 * thing there. Measured on a production article at +24.07h on 2026-10-22.
 *
 * FIFTEEN MINUTES, AND THE NUMBER IS A JUDGEMENT RATHER THAN A STANDARD. Real clock skew between us
 * and a feed is seconds to a minute, so this clears it with room, and publishers do sometimes stamp a
 * piece slightly ahead. It also bounds the damage: a bad stamp inside the tolerance sits at the top
 * for at most a quarter of an hour and then self-clears, and 15 minutes is far below the 6h relevance
 * window, so it cannot meaningfully distort ordering.
 *
 * One threshold rather than an accept-at-5min / reject-at-2h pair: a band leaves the middle undefined,
 * which is a question for the next reader with no answer in the code.
 *
 * Changing this number should be a deliberate edit that updates the paragraph above it. */
export const MAX_FUTURE_SEC = 15 * 60;

export type TsVerdict = 'ok' | 'too_old' | 'too_new' | 'unreadable';

/** The feed's own timestamp, judged against ours. Seconds, both.
 *
 *  Both boundaries are INCLUSIVE - the comparisons are `<` and `>`, so exactly `nowSec - MAX_AGE_SEC`
 *  and exactly `nowSec + MAX_FUTURE_SEC` are both `ok`. Stated because it is the kind of thing a
 *  reader assumes either way, and the `too_old` edge has to stay byte-identical to the cutoff it
 *  replaced or items that used to be ingested quietly stop being. */
export function judgeTs(ts: number, nowSec: number): TsVerdict {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return 'unreadable';
  if (ts < nowSec - MAX_AGE_SEC)    return 'too_old';
  if (ts > nowSec + MAX_FUTURE_SEC) return 'too_new';
  return 'ok';
}

/** The rejections worth a log line: everything except `too_old`.
 *
 *  `too_old` is not a quieter problem, it is NOT A PROBLEM - it is the normal state of a feed. Measured
 *  on the real sources: 123 of 147 items across five of thirteen (CoinDesk 24/25, CoinTelegraph 30/30,
 *  Decrypt 40/40). Counting it made the warn fire on every run, so the `too_new` the line exists to
 *  surface would have arrived looking like the three hundred that did not matter. A log line that
 *  always fires is not a signal.
 *
 *  Keyed on the VERDICT prefix rather than a list of interesting ones, so `unreadable:*` stays notable
 *  without being named - which matters because nobody has seen that case in the wild and it is the one
 *  that means a feed changed shape. */
export function notableOf(rejected: Record<string, number>): Array<[string, number]> {
  return Object.entries(rejected).filter(([key]) => !key.startsWith('too_old:'));
}
