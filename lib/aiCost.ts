// Real xAI grok-4.3 per-token rates and per-call cost estimates, used to turn
// raw lhq_grok_usage counts into an approximate $ figure for the /ops cost
// view. Source: console.x.ai/models (confirmed live 2026-07-24), cross-
// validated against this account's actual invoice. The full derivation lived
// in pendings/PRICING_ANALYSIS.md, which was removed 2026-07-25 once nothing
// in it was still pending - see git history for it. These are estimates
// (fixed avg-tokens-per-call assumptions), not a byte-for-byte replica of
// xAI's bill - good enough for "who's costing us the most" and margin,
// not for accounting.
export const XAI_RATE_PER_1M = {
  input: 1.25,
  cachedInput: 0.20,
  output: 2.50,
} as const;

// Plain call: ~1,500 input + 900 output tokens.
export const PLAIN_CALL_COST_USD = 0.0041;
// Search-enabled call (deep analysis, chat's live-search mode): ~4,500 input
// + 1,400 output tokens - xAI's web/X search results get injected as extra
// input tokens, there's no separate flat search fee on the real invoice.
export const SEARCH_CALL_COST_USD = 0.0091;

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
