/* THE PER-MODEL REQUEST SHAPE FOR A SHORT, FORMAT-BOUND ANSWER (#1631). Pure, import-free, shared by lib/aiProvider.ts and the bake-off harness so the two cannot differ.
 *
 * WHY THIS EXISTS, MEASURED (bake-off smoke runs 43406343108 and 43406693401, 2026-11-13): with a bare request and max_tokens 800, Haiku 5.5, Sonnet 5.5 and Opus 5.5
 * ALL came back with an EMPTY text answer and 800 output tokens: stop_reason max_tokens, zero characters. These models think before they answer by default, and the
 * thinking is billed and counted against max_tokens, so the whole budget went on thinking and nothing was left for the two-line verdict the quick read must open with.
 * Every one of those answers was rejected by the production parsers, and would have been refused and refunded in production.
 *
 * WHAT EACH MODEL ACCEPTS (the Anthropic API reference, read 2026-11-13):
 *   claude-haiku-5-5   thinking CAN be turned off ({type:'disabled'}) at effort high or below (the default is medium).
 *   claude-sonnet-5-5  `{type:'disabled'}` is a 400; the way to turn thinking off is {type:'between_tools'} (effort high or below, the default is high).
 *   claude-opus-5-5    thinking CANNOT be disabled (a 400 at every effort); the only control is effort, so it is set to 'low' AND the token budget is raised so thinking plus
 *                      the answer fit. Opus is the expensive model; this only keeps its answer from being cut off.
 * A model not listed here gets nothing added, and an unlisted model cannot be selected anyway (lib/aiEngine.ts allowlists by the rate table). */
export interface ClaudeShape {
  /** Extra request fields for this model. */
  params: Record<string, unknown>;
  /** The max_tokens to send: never below what the caller asked for. */
  maxTokens: number;
}

export function claudeShape(model: string, maxTokens: number): ClaudeShape {
  switch (model) {
    case 'claude-haiku-5-5':
      return { params: { thinking: { type: 'disabled' } }, maxTokens };
    case 'claude-sonnet-5-5':
      return { params: { thinking: { type: 'between_tools' } }, maxTokens };
    case 'claude-opus-5-5':
      return { params: { output_config: { effort: 'low' } }, maxTokens: Math.max(maxTokens, 4000) };
    default:
      return { params: {}, maxTokens };
  }
}
