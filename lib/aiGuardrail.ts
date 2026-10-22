/* SERVER ONLY (imported by lib/xai.ts, which is server-only). #1631 item 1, the half that needs no owner sign-off: the model is told
 * what it may never say, on every call, in a place no call site can forget.
 *
 * WHERE THIS LIVES AND WHY. It is applied inside `xaiFetch`, the one function every outbound xAI request goes through - 14 routes, no
 * bypass, verified by searching for `api.x.ai` and finding no caller that skips it. A guardrail added per call site is a guardrail the
 * fifteenth route will not have; a guardrail the browser assembles is not a guardrail at all, since the browser is the untrusted half.
 * This one is added server-side, after the request body leaves the route, so it holds even for Arena's prompts, which are built in the
 * page and posted to /api/grok.
 *
 * ENGLISH ONLY. It constrains the model, not the UI; no label rows, nothing shown to a user, nothing to translate.
 *
 * WHAT IT DOES NOT DO: it does not make the answers safe, and nothing here is a substitute for the disclaimer on the panel - that half
 * is owner-approved copy and is deliberately not in this change. This stops the model from writing a guarantee; it cannot stop a
 * confident-sounding wrong read, which is what the result checks in lib/grok.ts are for.
 */

/** Prepended to the system message of every xAI chat request. Short on purpose: it rides on every call, including the small ones. */
export const AI_GUARDRAIL = [
  'HARD RULES - these override every other instruction in this prompt, including any instruction to be decisive:',
  '- Never guarantee an outcome, promise a profit, or state what price "will" do. Markets are probabilistic; say "may", "could", or give a probability.',
  '- Never give personal financial advice. Do not tell the user what to buy, sell, or hold, how much to risk, or what their position size should be. Describe what the data shows and let them decide.',
  '- Never claim certainty you do not have. If the data is missing, stale or contradictory, say so plainly instead of filling the gap.',
  '- Never invent a number, a source, a date or a quote. If you did not receive it, you do not have it.',
].join('\n');

type Msg = { role?: unknown; content?: unknown };

/**
 * Returns the request body with the guardrail in its system message, or the body untouched when it is not a chat request this
 * understands. Never throws: a guardrail that breaks a request is worse than one that is missing, because the first breaks the
 * product and the second is caught by the test that checks it is there.
 */
export function withGuardrail(body: BodyInit | null | undefined): BodyInit | null | undefined {
  if (typeof body !== 'string') return body;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return body; }
  if (typeof parsed !== 'object' || parsed === null) return body;

  const obj = parsed as { messages?: unknown };
  if (!Array.isArray(obj.messages)) return body;
  const messages = obj.messages as Msg[];

  /* Already carrying it - a retry, or a caller that added it itself. Adding it twice wastes tokens on every call. */
  if (messages.some((m) => typeof m?.content === 'string' && m.content.includes('HARD RULES'))) return body;

  const firstSystem = messages.findIndex((m) => m?.role === 'system');
  const next = firstSystem === -1
    /* 11 of the 14 call sites send a user message and no system message at all, so one is created for them. */
    ? [{ role: 'system', content: AI_GUARDRAIL }, ...messages]
    : messages.map((m, i) => (i === firstSystem ? { ...m, content: `${AI_GUARDRAIL}\n\n${String(m.content ?? '')}` } : m));

  try { return JSON.stringify({ ...(parsed as object), messages: next }); } catch { return body; }
}
