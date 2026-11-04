/* THE BYBIT ACCOUNT-RATIO URL AND PARSER, IN ONE PLACE. #1631 item 5, step 2 follow-up.
 *
 * WHY THIS FILE EXISTS: THERE WERE ALREADY TWO COPIES, and a third was about to be added.
 *
 *   lib/marketFeeds.ts              accountRatio1h.fetchLive  -> writes the snapshot rows
 *   app/api/market/account-ratio/route.ts                     -> the live fan-out the page falls back to
 *
 * Both built the same URL and both carried a byte-identical `pick` callback, down to the
 * `parseRatioPair` call and a restatement of the same #1651 reasoning in a comment of its own. They
 * were measured identical before this extraction, not assumed to be:
 *
 *   normalised, comments stripped -> IDENTICAL code? True
 *
 * So the ingest job and the live path agreed by coincidence of maintenance. A fix to one would have
 * left the other serving the old shape, and because one writes the rows the other falls back from,
 * the two are read as interchangeable by every consumer downstream.
 *
 * `lib/arenaContextFields.ts` was written for exactly this hazard one layer up - thirteen formatters
 * shared rather than duplicated, because "a prompt that differs by a space produces a different
 * answer with nothing failing". The same argument applies to the parser that produces the numbers,
 * and it is why #1631 step 2 left `longShortRatio` out: the server could not source it without
 * either picking a different quantity or adding a third copy of this.
 *
 * DELIBERATELY DEPENDENCY-LIGHT. It imports `parseRatioPair` and nothing else. `lib/marketFeeds.ts`
 * is one of its consumers, so anything this file pulled in that reached back to `marketFeeds` would
 * be a cycle. The snapshot-first RESOLUTION lives in `lib/accountRatioData.ts` instead, which may
 * import freely because nothing in the feed registry imports it.
 */
import { parseRatioPair } from './ratioPair.ts';

/** One symbol's reading. `null` means not measured - never a plausible-looking 0.5. */
export interface AccountRatioEntry {
  longRatio: number | null;
  shortRatio: number | null;
  /** Bybit's own measurement time for the bucket, so a consumer can age it. */
  ts: number | null;
}

/**
 * The periods this app asks for. An allowlist rather than a pass-through: each distinct value is a
 * separate cache entry AND a separate fan-out of ~50 upstream calls, so free text here would be
 * both a cache-key leak and an egress amplifier. Moved here with the parser so the route and any
 * other caller cannot disagree about what is allowed.
 */
export const ACCOUNT_RATIO_PERIODS = new Set(['5min', '15min', '30min', '1h', '4h', '1d']);

/** The one period the app actually reads - `components/MarketProvider.tsx:358`. */
export const ACCOUNT_RATIO_DEFAULT_PERIOD = '1h';

export const accountRatioUrl = (symbol: string, period: string): string =>
  `https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${symbol}&period=${period}&limit=1`;

/**
 * Bybit's response for one symbol, as both callers already parsed it.
 *
 * #1651: this was `parseFloat(item.buyRatio || '0.5')`, so a missing side became a plausible 50/50
 * that every consumer downstream then treated as measured. Unknown is `null`, and the pair is
 * rejected together when it does not add up - `parseRatioPair` owns that rule.
 *
 * `ts` is ADDED rather than a reshape (#1404): every existing consumer reads `longRatio`/
 * `shortRatio` by name, so an extra field is invisible to them.
 */
export function pickAccountRatio(body: unknown): AccountRatioEntry | null {
  const item = (body as { result?: { list?: Array<Record<string, string>> } })?.result?.list?.[0];
  if (!item) return null;
  const pair = parseRatioPair(item.buyRatio, item.sellRatio);
  return {
    longRatio:  pair?.longRatio  ?? null,
    shortRatio: pair?.shortRatio ?? null,
    ts: Number(item.timestamp) || null,
  };
}
