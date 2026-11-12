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
import { XAI_RATES_BY_MODEL } from '../../lib/aiCost.ts';

const TIMEOUT = 180_000;

/* PRICES ARE PER MILLION TOKENS AND ARE THE ONE THING IN HERE THAT GOES STALE.
 *
 * ── GROK RATE HAS ONE SOURCE: lib/aiCost.ts (#1631) ──────────────────────────────────────────
 *
 * This file used to hard-code `grok-4.3: { in: 3.00, out: 15.00 }` ("x.ai list"), while the app
 * bills every real Grok call from `XAI_RATES_BY_MODEL` in lib/aiCost.ts at { input: 1.25, output:
 * 2.50 } - that table is cross-validated against this account's actual invoice (see its comment).
 * Two rate tables 2.4x/6x apart meant the bake-off would price Grok several times too high and hand
 * Claude a cost win that does not exist. So the Grok rate is now IMPORTED from aiCost.ts, not
 * retyped: the harness and the ledger cannot disagree, and the day the invoice rate changes, one
 * edit moves both. (The deeper fix - pricing Grok from its own `cost_in_usd_ticks` per response
 * rather than from any rate table - is the recommendation on #1631; this change just removes the
 * second, wrong table.)
 *
 * ── CLAUDE RATE: the model actually called, priced from the docs ─────────────────────────────
 *
 * `callClaude` below uses `claude-opus-5-5`. The old row carried $5 / $25 - those are Claude Opus
 * 5's prices under Opus 5.5's id. Corrected to Opus 5.5's own list, cited from
 * platform.claude.com/docs/en/about-claude/pricing (read 2026-11-12): $4 input / $20 output per
 * MTok, cache read $0.20 (0.05x). STILL AN UPPER BOUND, not the running cost: prompt caching is OFF
 * on the account, and on a ~15,000-token input that is the single largest lever, so the number is
 * reported as a ceiling. */
const GROK = XAI_RATES_BY_MODEL['grok-4.3'];
const PRICING = {
  'grok-4.3':       { in: GROK.input, out: GROK.output, readAt: 'from lib/aiCost.ts', note: 'single source: XAI_RATES_BY_MODEL (invoice-validated)' },
  'claude-opus-5-5':{ in: 4.00, out: 20.00, readAt: '2026-11-12', note: 'Anthropic docs pricing page, Opus 5.5 list; caching OFF on this account, so a ceiling' },
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
  /* GROK_API_KEY, not XAI_API_KEY. This file read the wrong name and would have produced the
     exact 0/0 null rate the runner's own control exists to catch - the control would have worked
     and it would have cost a run to find out. The app uses GROK_API_KEY in 14 places and
     XAI_API_KEY in none; `.env.example:41` says so too. Caught by the owner. */
  const key = process.env.GROK_API_KEY;
  if (!key) return { ok: false, reason: 'GROK_API_KEY not set' };
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
  if (!r.ok) {
    /* THE BODY, NOT JUST THE STATUS. A bare `HTTP 400` is indistinguishable between a bad model
       id, a malformed body and a rejected parameter, and diagnosing it by guessing costs a paid
       call per guess. Sliced, because this text reaches a report and an error body has carried
       request headers on this project before. */
    const detail = await r.text().catch(() => '');
    return { ok: false, reason: `HTTP ${r.status}: ${detail.slice(0, 300)}`, latencyMs };
  }
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
  if (!r.ok) {
    /* THE BODY, NOT JUST THE STATUS. A bare `HTTP 400` is indistinguishable between a bad model
       id, a malformed body and a rejected parameter, and diagnosing it by guessing costs a paid
       call per guess. Sliced, because this text reaches a report and an error body has carried
       request headers on this project before. */
    const detail = await r.text().catch(() => '');
    return { ok: false, reason: `HTTP ${r.status}: ${detail.slice(0, 300)}`, latencyMs };
  }
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
