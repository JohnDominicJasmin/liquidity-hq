/* Which chat messages silently cost a LIVE SEARCH instead of a chat message.
 *
 * Extracted from GrokChat.tsx for #382. It lived inside a `.tsx` component,
 * which meant the one piece of logic that decides which of a user's two daily
 * quotas gets spent could not be tested without a JSX loader - so it never was.
 *
 * The behaviour is unchanged. What changed is that it is now visible: the chat
 * panel reads this to tell the user, before they send, which quota the message
 * in the box will bill (#384). The route bills the mode it is handed
 * (`app/api/grok-chat/route.ts:117`), so this function and that column have to
 * agree or the meter lies.
 */

// Auto-enable live search when message clearly needs current web data
export const SEARCH_TRIGGERS = [
  // Questions about why / what
  'why', 'what happened', 'happening', 'reason', 'cause', 'catalyst',
  // Time-anchored
  'today', 'right now', 'just now', 'recently', 'yesterday', 'this week', 'latest',
  // News / narrative
  'news', 'narrative', 'breaking', 'announcement',
  // People / institutions
  'trump', 'elon', 'powell', 'jerome', 'blackrock', 'saylor',
  // Macro events
  'fed', 'fomc', 'cpi', 'ppi', 'nfp', 'jobs', 'inflation', 'gdp',
  'rate cut', 'rate hike', 'interest rate', 'tariff', 'sanction',
  // Geo / political
  'war', 'conflict', 'russia', 'ukraine', 'china', 'japan', 'boj', 'yen',
  // Crypto-specific events
  'etf', 'sec', 'regulation', 'hack', 'exploit', 'halving',
  'binance', 'coinbase', 'bybit', 'okx',
  'liquidation', 'liquidated', 'whale',
  'dump', 'dumping', 'pump', 'pumping', 'crash', 'crashing', 'rally',
  'stablecoin', 'usdt', 'usdc',
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* WORD BOUNDARIES, not substrings (#387).
 *
 * This matched with `includes` until 2026-08-13, so `is the trend upward` spent
 * a live search because `upward` contains `war`. Every collision found came
 * from a three-letter entry: why fed cpi ppi nfp gdp war boj yen etf sec okx.
 *
 * The owner's decision on #385 - that auto-escalation stays because those
 * questions genuinely need live data - is about MEANING. `upward` has no
 * meaning relationship to war, so this fixes the mechanism rather than
 * reopening the ruling.
 *
 * The trailing `s?` is load-bearing and the boundary alone is not enough:
 *
 *     \betf\b     does NOT match "ETFs"   - `s` is a word char, no boundary
 *     \betfs?\b   matches "ETF" and "ETFs"
 *     \bcpi\b     ALREADY matches "CPI's" - the apostrophe is a boundary
 *
 * Built once at module load, not per call - this runs on every keystroke now
 * that the chat panel prices the message in the box (#386).
 */
const TRIGGER_RE = new RegExp(
  `\\b(?:${SEARCH_TRIGGERS.map(escapeRe).join('|')})s?\\b`,
  'i',
);

/**
 * True when this message will be sent as a live search, spending
 * `chat_search_count` rather than `chat_count`.
 *
 * Matches whole words only. `__tests__/searchTriggers.test.mts` pins both
 * directions - the questions that must still escalate, and the ones that must
 * not - so a future edit to the list cannot quietly widen either.
 */
export function needsLiveSearch(text: string): boolean {
  return TRIGGER_RE.test(text);
}

/* Plurals are stored, not derived. The first version of this appended "s" to
 * the unit and shipped `10 searchs left` to the one surface a user reads while
 * deciding whether to spend a scarce quota (QA, on #385). English is not
 * regular enough for `+ 's'` and a second unit would have hit the same wall. */
const QUOTA_UNITS = {
  search:  { one: 'search',  many: 'searches' },
  message: { one: 'message', many: 'messages' },
} as const;

/**
 * The quota line beside the Fast/Live control: `40 messages left`,
 * `1 search left`, `No searches left`.
 *
 * Negative remaining is treated as none rather than rendered - the counters are
 * server-side and a clock skew or a limit lowered mid-day can make used exceed
 * limit, and `-2 searches left` is worse than useless.
 */
export function quotaLabel(remaining: number, willSearch: boolean): string {
  const u = willSearch ? QUOTA_UNITS.search : QUOTA_UNITS.message;
  if (remaining <= 0)  return `No ${u.many} left`;
  if (remaining === 1) return `1 ${u.one} left`;
  return `${remaining} ${u.many} left`;
}
