/* THE TWO ENGINE ADAPTERS (#1818).
 *
 * **THE ONLY PERMITTED DIFFERENCE BETWEEN THEM IS REQUEST SHAPE.** Both send the identical system
 * and user strings from `prompt.mjs`; neither may touch the instruction or the data. A comparison
 * of two models given two prompts is not a comparison of two models.
 *
 * COST AND LATENCY COME FROM EACH VENDOR'S OWN USAGE FIGURES, never estimated - the spec asks for
 * measured numbers, and a token count we computed ourselves would be our tokeniser's opinion of
 * their billing.
 *
 * TEMPERATURE IS NOT SET on either. Both are nondeterministic and the spec's answer to that is
 * three runs and a reported spread, not a knob that makes one engine look steadier than it is in
 * the configuration the product would actually use.
 */
import { SYSTEM, buildPrompt } from './prompt.mjs';

const TIMEOUT = 180_000;

/* PRICES ARE PER MILLION TOKENS AND ARE THE ONE THING IN HERE THAT GOES STALE.
 *
 * Kept as data with the date they were read, so a cost figure in a report can be recomputed when
 * they change rather than being a number nobody can re-derive. The Grok rate is the one this
 * project already measured at $0.0238 per `deep` call (#1818); the Claude rates are list price.
 *
 * **The Claude figure this harness produces is an UPPER BOUND, not the running cost: prompt
 * caching is OFF on the account.** On a ~15,000-token input that is the single largest lever
 * available, so the number must be reported as a ceiling. Raised by PM from the account dashboard. */
const PRICING = {
  'grok-4.3':       { in: 3.00, out: 15.00, readAt: '2026-10-31', note: 'x.ai list' },
  'claude-opus-5-5':{ in: 5.00, out: 25.00, readAt: '2026-10-31', note: 'Anthropic list; caching OFF on this account, so a ceiling' },
};

function costOf(model, usage) {
  const p = PRICING[model];
  if (!p || !usage) return null;
  const inTok = usage.input_tokens ?? usage.prompt_tokens ?? null;
  const outTok = usage.output_tokens ?? usage.completion_tokens ?? null;
  if (inTok === null || outTok === null) return null;
  return Number(((inTok * p.in + outTok * p.out) / 1_000_000).toFixed(6));
}

/** Grok, through the same chat-completions endpoint the app uses. No search tools attached: this
 *  feature reads candles, not tweets, which is the spec's reason the X advantage does not apply. */
export async function callGrok(candles) {
  const key = process.env.XAI_API_KEY;
  if (!key) return { ok: false, reason: 'XAI_API_KEY not set' };
  const model = 'grok-4.3';
  const started = Date.now();
  let r;
  try {
    r = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: buildPrompt(candles) }],
        max_tokens: 4000,
      }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
  } catch (e) {
    /* The message is sliced: a thrown fetch error here has carried an Authorization header before
       on this project, and this script's output goes into a report. */
    return { ok: false, reason: `transport: ${String(e?.message ?? e).slice(0, 120)}` };
  }
  const latencyMs = Date.now() - started;
  if (!r.ok) return { ok: false, reason: `HTTP ${r.status}`, latencyMs };
  const d = await r.json();
  return {
    ok: true, model, latencyMs,
    text: d.choices?.[0]?.message?.content ?? '',
    usage: d.usage ?? null,
    cost: costOf(model, d.usage),
  };
}

/** Claude, through the Messages API. Blocked until the owner sets the key - his credits, his key,
 *  and neither Dev nor PM handles it (#1818). */
export async function callClaude(candles) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, reason: 'ANTHROPIC_API_KEY not set' };
  const model = 'claude-opus-5-5';
  const started = Date.now();
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        system: SYSTEM,
        messages: [{ role: 'user', content: buildPrompt(candles) }],
      }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
  } catch (e) {
    return { ok: false, reason: `transport: ${String(e?.message ?? e).slice(0, 120)}` };
  }
  const latencyMs = Date.now() - started;
  if (!r.ok) return { ok: false, reason: `HTTP ${r.status}`, latencyMs };
  const d = await r.json();
  return {
    ok: true, model, latencyMs,
    text: (d.content ?? []).filter(b => b.type === 'text').map(b => b.text).join(''),
    usage: d.usage ?? null,
    cost: costOf(model, d.usage),
  };
}

export const ENGINES = [
  { vendor: 'grok', call: callGrok },
  { vendor: 'claude', call: callClaude },
];

export { PRICING };
