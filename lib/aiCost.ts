// THE ONE RATE TABLE (#1399). Every $ figure the app puts on an xAI call comes
// from here - the per-call record (lib/aiCallLog.ts, via parseAiUsage below)
// and the older /ops estimate (estimateRowCostUsd) alike. Source:
// console.x.ai/models (confirmed live 2026-07-24), cross-validated against this
// account's actual invoice, and re-verified 2026-09-23 against two real
// responses: xAI's own `cost_in_usd_ticks` matched these rates to the tick
// (see parseAiUsage for the arithmetic).
//
// TWO DIFFERENT QUESTIONS ARE ANSWERED FROM THIS ONE TABLE, and they must not be
// confused:
//   - parseAiUsage: "what did THIS call cost". Prefers xAI's own per-call figure
//     and only falls back to these rates when xAI did not send one.
//   - estimateRowCostUsd: "roughly what did this user's DAY cost", from
//     lhq_grok_usage's COUNT columns, which carry no token data - so it has to
//     assume an average call (PLAIN_CALL_TOKENS / SEARCH_CALL_TOKENS). An
//     estimate, and labelled as one everywhere it is shown.
export const XAI_RATES_BY_MODEL: Record<string, { input: number; cachedInput: number; output: number }> = {
  // $ per 1M tokens.
  'grok-4.3': { input: 1.25, cachedInput: 0.20, output: 2.50 },
};

// The model every call site pins today. A new model shipped before this table
// is updated makes parseAiUsage answer 'unknown' for it (never a wrong number),
// and the /ops estimate keeps using this one.
const DEFAULT_MODEL = 'grok-4.3';

/* Which call made the request - the same sixteen names lhq_grok_usage counts
   under (its `<type>_count` columns, see ALL_USAGE_COLUMNS), minus the suffix,
   so the per-call log and the daily counters agree on what to call things. */
export const AI_CALL_TYPES = [
  'quick', 'deep', 'chat', 'chat_search', 'briefing',
  'thesis_check', 'strategy_research', 'shadow_account', 'behavioral_bias',
  'pine_script', 'hypothesis_analyze', 'token_unlock', 'smc_snapshot',
  'dry_powder', 'macro_context', 'onchain',
] as const;
export type AiCallType = typeof AI_CALL_TYPES[number];

/** What one xAI call cost, and how we know.
 *
 *  `source` is the load-bearing field:
 *    'xai'       - xAI reported the cost itself (`usage.cost_in_usd_ticks`).
 *                  Not an estimate. This is the normal case: both endpoints
 *                  returned it on every real call checked.
 *    'estimated' - xAI sent token counts but no cost; priced from the table.
 *    'unknown'   - no usable usage object at all. costUsd is null, NEVER 0:
 *                  a call we could not measure is not a free call. */
export interface AiCallCost {
  costUsd: number | null;
  source: 'xai' | 'estimated' | 'unknown';
  promptTokens: number | null;
  completionTokens: number | null;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * Read xAI's `usage` object. Handles both response shapes the app sees:
 *
 *   /v1/chat/completions   prompt_tokens / completion_tokens / total_tokens,
 *                          prompt_tokens_details.cached_tokens,
 *                          completion_tokens_details.reasoning_tokens
 *   /v1/responses          input_tokens / output_tokens / total_tokens,
 *                          input_tokens_details.cached_tokens
 *
 * Both carry `cost_in_usd_ticks`, 1 tick = $1e-10 ("100 million ticks per
 * cent" in xAI's reference). Verified 2026-09-23 against live responses:
 *
 *   chat/completions  prompt 199 (192 cached), completion 1, reasoning 381,
 *                     total 581 -> 10,021,500 ticks = $0.00100215, which is
 *                     exactly (7*1.25 + 192*0.20 + 382*2.50) / 1e6.
 *   responses         input 199 (192 cached), output 117 (116 reasoning),
 *                     total 316 -> 3,396,500 ticks = $0.00033965, exactly
 *                     (7*1.25 + 192*0.20 + 117*2.50) / 1e6.
 *
 * Two things those numbers teach, and the fallback below relies on both:
 *   - reasoning tokens are BILLED AS OUTPUT. On /v1/responses they are already
 *     inside output_tokens; on /v1/chat/completions `completion_tokens` (1)
 *     EXCLUDES them and only total_tokens (581) includes them. So the billed
 *     output count is `total - prompt` whenever that is larger than the
 *     reported completion count - pricing `completion_tokens` alone would have
 *     billed that first call at $0.0000 output instead of $0.00096.
 *   - cached prompt tokens are billed at the cached rate, not the input rate.
 *
 * `cost_in_nano_usd` is in xAI's schema too but was absent from both real
 * responses; accepted as a second choice in case a future response carries
 * only that.
 */
export function parseAiUsage(model: string, usage: unknown): AiCallCost {
  if (!usage || typeof usage !== 'object') {
    return { costUsd: null, source: 'unknown', promptTokens: null, completionTokens: null };
  }
  const u = usage as Record<string, unknown>;
  const promptTokens = num(u.prompt_tokens) ?? num(u.input_tokens);
  const reportedCompletion = num(u.completion_tokens) ?? num(u.output_tokens);
  const totalTokens = num(u.total_tokens);
  const billedOutput = promptTokens != null && totalTokens != null ? totalTokens - promptTokens : null;
  const completionTokens = billedOutput != null && billedOutput > (reportedCompletion ?? 0)
    ? billedOutput
    : reportedCompletion;

  const ticks = num(u.cost_in_usd_ticks);
  if (ticks != null) return { costUsd: ticks / 1e10, source: 'xai', promptTokens, completionTokens };
  const nano = num(u.cost_in_nano_usd);
  if (nano != null) return { costUsd: nano / 1e9, source: 'xai', promptTokens, completionTokens };

  const rate = XAI_RATES_BY_MODEL[model];
  if (rate && promptTokens != null && completionTokens != null) {
    const details = (u.prompt_tokens_details ?? u.input_tokens_details) as Record<string, unknown> | undefined;
    const cached = Math.min(promptTokens, num(details?.cached_tokens) ?? 0);
    const costUsd = ((promptTokens - cached) * rate.input + cached * rate.cachedInput + completionTokens * rate.output) / 1e6;
    return { costUsd, source: 'estimated', promptTokens, completionTokens };
  }
  return { costUsd: null, source: 'unknown', promptTokens, completionTokens };
}

/* ── The older, count-based estimate for /ops ─────────────────────────────────
 *
 * lhq_grok_usage stores how MANY calls of each kind a user made per day, not
 * what they cost, so the /ops view has to assume an average call. Two shapes:
 * a plain call and a search-enabled one (deep, chat_search, onchain: xAI's
 * web/X search results arrive as extra input tokens - there is no separate
 * flat search fee on the real invoice). The token assumptions are the same
 * ones this file has always carried; the RATES they are multiplied by now come
 * from XAI_RATES_BY_MODEL rather than being a second, hand-copied number.
 * (The old hard-coded 0.0041 / 0.0091 were these same products, rounded.) */
const PLAIN_CALL_TOKENS  = { input: 1500, cachedInput: 0, output: 900 };
const SEARCH_CALL_TOKENS = { input: 4500, cachedInput: 0, output: 1400 };

function priceTokens(t: { input: number; cachedInput: number; output: number }): number {
  const rate = XAI_RATES_BY_MODEL[DEFAULT_MODEL];
  return (t.input * rate.input + t.cachedInput * rate.cachedInput + t.output * rate.output) / 1e6;
}

export const PLAIN_CALL_COST_USD  = priceTokens(PLAIN_CALL_TOKENS);
export const SEARCH_CALL_COST_USD = priceTokens(SEARCH_CALL_TOKENS);

// Current Pro price - used only for the /ops margin column (cost vs revenue).
// Keep in sync with app/upgrade/page.tsx + lib/i18n/dictionaries.ts if this
// ever changes again; there's no single shared constant for it yet.
export const PRO_PRICE_USD_PER_MONTH = 25;

// lhq_grok_usage columns that enable xAI's web/X search tools, billed at the
// higher SEARCH_CALL_COST_USD rate. Every other count column is a "plain" call.
// onchain uses /v1/responses with web_search+x_search (see app/api/onchain/
// route.ts) - same search tier as deep/chat_search.
export const SEARCH_USAGE_COLUMNS = new Set(['deep_count', 'chat_search_count', 'onchain_count']);

export const ALL_USAGE_COLUMNS = [
  'quick_count', 'deep_count', 'chat_count', 'chat_search_count', 'briefing_count',
  'thesis_check_count', 'strategy_research_count', 'shadow_account_count',
  'behavioral_bias_count', 'pine_script_count', 'hypothesis_analyze_count',
  'token_unlock_count', 'smc_snapshot_count',
  'dry_powder_count', 'macro_context_count', 'onchain_count',
] as const;

// Estimated $ cost of one lhq_grok_usage row (one user, one day).
export function estimateRowCostUsd(row: Record<string, number | null | undefined>): number {
  let cost = 0;
  for (const col of ALL_USAGE_COLUMNS) {
    const n = Number(row[col] ?? 0);
    if (!n) continue;
    cost += n * (SEARCH_USAGE_COLUMNS.has(col) ? SEARCH_CALL_COST_USD : PLAIN_CALL_COST_USD);
  }
  return cost;
}

export function fmtUsd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '-';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
