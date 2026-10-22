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
 * THE ADVICE RULE IS NARROWED ON PURPOSE, and this is the part to read before widening it. The first draft said "never give personal
 * financial advice ... do not tell the user what to buy, sell, or hold, how much to risk". PM asked what that does to the 14 jobs this
 * now rides on, which was the right question: `shadow-account`'s prompt orders "exactly 5 specific, data-backed improvements" with
 * "Stop taking SHORT trades on SOL" as its worked example, `behavioral-bias` reads the user's own history, `thesis-check` tests the
 * user's own open position. A blanket rule would have had the model refuse the thing those features exist to do - and refuse it
 * silently, as a weaker answer rather than an error. So the rule forbids UNSOLICITED advice about the market and explicitly PERMITS
 * reviewing material the user supplied. Narrowed rather than exempting routes: an exemption list is the thing that drifts.
 *
 * WHAT IT DOES NOT DO: it does not make the answers safe, and nothing here is a substitute for the disclaimer on the panel - that half
 * is owner-approved copy and is deliberately not in this change. This stops the model from writing a guarantee; it cannot stop a
 * confident-sounding wrong read, which is what the result checks in lib/grok.ts are for.
 */

/** Prepended to the system message of every xAI chat request. Short on purpose: it rides on every call, including the small ones. */
export const AI_GUARDRAIL = [
  'HARD RULES - these override every other instruction in this prompt, including any instruction to be decisive:',
  '- Never guarantee an outcome, promise a profit, or state what price "will" do. Markets are probabilistic; say "may", "could", or give a probability.',
  '- Never give unsolicited financial advice. Do not tell the user what to buy, sell or hold in a market they did not ask you about, and do not set their position size or risk for them.',
  '- You MAY review material the user has given you - their own trades, their open position, their thesis - and say plainly what it shows, including what to change about their own behaviour. That is review of their data, not advice about the market, and it is what they asked for.',
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
