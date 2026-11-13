// SERVER ONLY. The Claude half of the per-feature engine switch (#1631, owner decision 2026-11-13).
//
// WHAT THIS IS. `callClaude` is the one place the app talks to Anthropic, the counterpart of `xaiFetch` for xAI. It is only reached when
// `engineFor(callType)` (lib/aiEngine.ts) names a Claude model for a call type, which needs BOTH a flag row in `app_config` AND the
// `ANTHROPIC_API_KEY` environment variable. With either absent every route stays on Grok, byte for byte.
//
// THE KEY. Read from `process.env.ANTHROPIC_API_KEY` by the SDK's own default and nowhere else. This file never receives, stores, logs or
// returns it; the owner sets it on the Render services himself (and as a GitHub secret for the bake-off).
//
// SAME RULES AS xaiFetch, ON PURPOSE:
//   - the guardrail (lib/aiGuardrail.ts) is in the system prompt of every call, so a model switch cannot drop the hard rules;
//   - a floor timeout, because a request that never settles holds the worker until the platform kills it;
//   - transport health is reported (`anthropic:claude`), so a provider outage is noticed the way the xAI one is.
// WHAT IT RETURNS is shaped for the routes that already exist: the answer text and a `usage` object in the shape `parseAiUsage`
// prices (input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens), under the REQUESTED model id, which is the
// key of ANTHROPIC_RATES_BY_MODEL. (The API echoes a dated model id that is not a key of that table, so pricing by the echoed id would
// make every call cost 'unknown'.)
//
// NOT HERE: tool use, web search, X posts, streaming. Those stay on Grok; a call type that needs them is not in CLAUDE_ELIGIBLE.
import Anthropic from '@anthropic-ai/sdk';
import { AI_GUARDRAIL } from '@/lib/aiGuardrail';
import { reportHealth, healthError } from '@/lib/apiHealth';
import { CLAUDE_MODELS } from '@/lib/aiEngine';
import { claudeShape } from '@/lib/claudeRequest';

const CLAUDE_SOURCE = 'anthropic:claude';
const TIMEOUT_MS = 60_000;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // maxRetries 1: the SDK's own retry covers a 429 or a 5xx once. A request that failed before the API accepted it is not billed.
  /* A KEY THAT IS NOT SCOPED TO A WORKSPACE needs the workspace named on every request (the API answers 400 "this request must include the anthropic-workspace-id header" otherwise;
     measured on the bake-off smoke run, 2026-11-13). A workspace-scoped key needs nothing. So the header is sent only when ANTHROPIC_WORKSPACE_ID is set; the id is not a credential. */
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  if (!client) client = new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1, ...(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {}) });
  return client;
}

/** True when the server holds a key. Existence only: the value is never read here. */
export function claudeConfigured(): boolean {
  return typeof process.env.ANTHROPIC_API_KEY === 'string' && process.env.ANTHROPIC_API_KEY.length > 0;
}

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface ClaudeResult {
  text: string;
  usage: ClaudeUsage;
  /** The model that was REQUESTED (a key of ANTHROPIC_RATES_BY_MODEL), not the dated id the API echoes. */
  model: string;
  stopReason: string | null;
}

/**
 * One user turn to one Claude model, with the shared guardrail as the system prompt. Throws on any transport or API error (the caller
 * decides what a failure means: the quick read falls back to Grok once). An unpriced model is refused before any request is made,
 * for the reason lib/aiEngine.ts gives: a call we cannot price is a call we will not make.
 */
export async function callClaude(opts: {
  model: string;
  user: string;
  maxTokens: number;
  /** Optional extra system text, placed after the guardrail. */
  system?: string;
  signal?: AbortSignal;
}): Promise<ClaudeResult> {
  if (!CLAUDE_MODELS.has(opts.model)) throw new Error('claude model not allowlisted');
  if (!claudeConfigured()) throw new Error('claude not configured');
  try {
    /* The per-model shape (lib/claudeRequest.ts): these models think by default and the thinking is counted against max_tokens, which left a bare request with an empty answer. */
    const shape = claudeShape(opts.model, opts.maxTokens);
    const body = {
      model: opts.model,
      max_tokens: shape.maxTokens,
      system: opts.system ? `${AI_GUARDRAIL}\n\n${opts.system}` : AI_GUARDRAIL,
      messages: [{ role: 'user', content: opts.user }],
      ...shape.params,
    } as unknown as Anthropic.MessageCreateParamsNonStreaming;
    const res = await getClient().messages.create(body, opts.signal ? { signal: opts.signal } : undefined);
    reportHealth(CLAUDE_SOURCE, 'ai', true, 'ok');
    let text = '';
    for (const block of res.content) if (block.type === 'text') text += block.text;
    const u = res.usage as unknown as Partial<ClaudeUsage>;
    return {
      text,
      model: opts.model,
      stopReason: res.stop_reason ?? null,
      usage: {
        input_tokens: u.input_tokens ?? 0,
        output_tokens: u.output_tokens ?? 0,
        cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      },
    };
  } catch (e) {
    reportHealth(CLAUDE_SOURCE, 'ai', false, healthError(e));
    throw e;
  }
}
