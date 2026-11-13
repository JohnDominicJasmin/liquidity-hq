#!/usr/bin/env node
/* THE QUICK-READ BAKE-OFF (#1631, owner decision 2026-11-13): Grok against Claude Haiku 5.5, Sonnet 5.5 and Opus 5.5 on the SAME quick-read prompts.
 *
 *   node --import ./qa/alias-register.mjs scripts/bakeoff/quick/run.mjs        (CI: .github/workflows/quick-bakeoff.yml)
 *
 * ── WHAT IT MEASURES, AND ONLY THIS ──
 *   cost per call (each vendor's OWN usage figures, priced from lib/aiCost.ts), latency (p50 / p95), and PARSE RATE (the production validation:
 *   `parseVerdict` AND `parseCombinedRead` must both accept the answer, which is what the route does before it shows a read).
 * It does NOT score the QUALITY of a read. That needs a human reading answers blind, and answers must not be written to a public log.
 *
 * ── THE LOG OF THIS SCRIPT IS PUBLIC (the repository is public) ──
 * Everything printed goes through `say()`, which accepts engine names (a fixed list), integers, and numbers. No prompt, no answer, no error text
 * and no key is ever printed or written to a file. A failed call is counted by CLASS only (an HTTP status number or the error's constructor
 * name). Nothing is uploaded as an artifact. The keys are read from the environment by the SDK / this script and are never echoed.
 *
 * ── THE SPEND CAP IS ENFORCED IN CODE ──
 * Hard maximum $15.00, whatever BAKEOFF_CAP_USD says (it can only lower it). BEFORE every call this script estimates that call's worst case
 * (the prompt's token count at 1 token per 3 characters, plus the full max_tokens at the engine's OUTPUT rate) and refuses to make the call
 * if `measured spend + that worst case` would pass the cap. After the call it adds the MEASURED cost from the vendor's usage figures; a call
 * with no usable usage (a timeout, a 5xx) is charged its worst case, not zero. Calls go input by input and engine by engine, so a stop leaves
 * every engine with the same inputs done, and the report says how many calls each completed.
 *
 * Grok is skipped with a printed notice when GROK_API_KEY is absent; each Claude engine likewise needs ANTHROPIC_API_KEY. */
import Anthropic from '@anthropic-ai/sdk';
import { AI_GUARDRAIL } from '../../../lib/aiGuardrail.ts';
import { ANTHROPIC_RATES_BY_MODEL, XAI_RATES_BY_MODEL, parseAiUsage } from '../../../lib/aiCost.ts';
import { parseVerdict, parseCombinedRead } from '../../../lib/grok.ts';
import { makePrompts } from './make-inputs.mjs';
import { claudeShape } from '../../../lib/claudeRequest.ts';

const HARD_CAP_USD = 15;
const CEILING_USD = 0.0085;   // the owner's per-answer ceiling for the quick read
const MAX_TOKENS = Math.min(4000, Number(process.env.BAKEOFF_MAX_TOKENS) > 0 ? Number(process.env.BAKEOFF_MAX_TOKENS) : 800);   // what the route asks for (800 today); raisable to test a bigger budget
const SEQUENTIAL = process.env.BAKEOFF_SEQUENTIAL === '1';   // one call at a time, to tell a provider 503 from one the parallel burst caused
const ONLY = (process.env.BAKEOFF_ENGINES ?? '').split(',').map((x) => x.trim()).filter(Boolean);   // restrict to some engines by id

const ENGINES = [
  { id: 'grok-4.3', kind: 'grok', rates: XAI_RATES_BY_MODEL['grok-4.3'] },
  { id: 'claude-haiku-5-5', kind: 'claude', rates: ANTHROPIC_RATES_BY_MODEL['claude-haiku-5-5'] },
  { id: 'claude-sonnet-5-5', kind: 'claude', rates: ANTHROPIC_RATES_BY_MODEL['claude-sonnet-5-5'] },
  { id: 'claude-opus-5-5', kind: 'claude', rates: ANTHROPIC_RATES_BY_MODEL['claude-opus-5-5'] },
];
const NAMES = new Set(ENGINES.map((e) => e.id));

/* TWO SEPARATE CAPS (owner, 2026-11-13: the Anthropic budget is larger, the xAI budget is limited). Claude: at most $15. Grok: at most $0.25, and at most 5 inputs x 1 run, because
   Grok's cost per quick read is already measured on production's own ledger (about $0.0117) and is here only a same-harness reference. Each can only be LOWERED by an input. */
const CAP_CLAUDE = Math.min(HARD_CAP_USD, Number(process.env.BAKEOFF_CAP_USD) > 0 ? Number(process.env.BAKEOFF_CAP_USD) : HARD_CAP_USD);
const GROK_HARD_CAP_USD = 0.25;
const CAP_GROK = Math.min(GROK_HARD_CAP_USD, Number(process.env.BAKEOFF_GROK_CAP_USD) > 0 ? Number(process.env.BAKEOFF_GROK_CAP_USD) : GROK_HARD_CAP_USD);
const GROK_MAX_INPUTS = 5;
const CAP = CAP_CLAUDE;   // the Claude cap, printed as the headline cap
const RUNS = Math.max(1, Math.min(5, Number(process.env.BAKEOFF_RUNS) || 3));
const INPUTS = Math.max(1, Math.min(60, Number(process.env.BAKEOFF_INPUTS) || 30));

/** THE ONE OUTPUT CHANNEL: a line made of fixed words, engine names from the list above, and numbers. */
function say(...parts) {
  const out = parts.map((p) => {
    if (typeof p === 'number') return Number.isFinite(p) ? String(Math.round(p * 1e6) / 1e6) : 'NaN';
    if (typeof p === 'string' && (NAMES.has(p) || /^[A-Za-z_=0-9.$%: ()/<>-]{1,60}$/.test(p))) return p;   // fixed words only: callers pass literals, never an error's own text
    throw new Error('BAD_OUTPUT');
  });
  console.log(out.join(' '));
}

const haveClaude = !!process.env.ANTHROPIC_API_KEY;
const haveGrok = !!process.env.GROK_API_KEY;
const active = ENGINES.filter((e) => (e.kind === 'claude' ? haveClaude : haveGrok)).filter((e) => ONLY.length === 0 || ONLY.includes(e.id));
if (!haveClaude) say('NOTICE: no ANTHROPIC_API_KEY - claude engines skipped');
if (!haveGrok) say('NOTICE: no GROK_API_KEY - grok skipped');
if (active.length === 0) { say('NOTHING_TO_RUN'); process.exit(1); }

// The workspace id is sent only when set (a key not scoped to a workspace needs it; a workspace-scoped key does not). It is not a credential.
const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
const anthropic = haveClaude ? new Anthropic({ timeout: 60_000, maxRetries: 1, ...(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {}) }) : null;

async function callOne(engine, prompt) {
  const t0 = Date.now();
  if (engine.kind === 'claude') {
    const r = await anthropic.messages.create({
      model: engine.id, max_tokens: claudeShape(engine.id, MAX_TOKENS).maxTokens, system: AI_GUARDRAIL, messages: [{ role: 'user', content: prompt }],
      ...claudeShape(engine.id, MAX_TOKENS).params,   // the per-model shape production uses (lib/claudeRequest.ts)
    });
    let text = '';
    for (const b of r.content) if (b.type === 'text') text += b.text;
    return { text, usage: r.usage, ms: Date.now() - t0, stop: r.stop_reason ?? null };
  }
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(120_000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROK_API_KEY}` },
    body: JSON.stringify({ model: engine.id, messages: [{ role: 'system', content: AI_GUARDRAIL }, { role: 'user', content: prompt }], max_tokens: MAX_TOKENS }),
  });
  if (!res.ok) { const e = new Error('http'); e.status = res.status; throw e; }
  const d = await res.json();
  return { text: d?.choices?.[0]?.message?.content ?? '', usage: d?.usage, ms: Date.now() - t0, stop: d?.choices?.[0]?.finish_reason ?? null };
}

/** Worst case for ONE call: the prompt's tokens at 1 per 3 characters at the input rate, plus the whole max_tokens at the output rate. */
const worstCase = (engine, prompt) =>
  (Math.ceil(prompt.length / 3) * engine.rates.input + (engine.kind === 'claude' ? claudeShape(engine.id, MAX_TOKENS).maxTokens : MAX_TOKENS) * engine.rates.output) / 1e6;

const prompts = makePrompts(INPUTS);
const stats = new Map(active.map((e) => [e.id, { done: 0, parsed: 0, lat: [], cost: [], fail: new Map(), verdictOk: 0, combinedOk: 0, truncated: 0, hasSignalWord: 0, outTok: [], chars: [] }]));
let spent = 0;          // CLAUDE spend
let spentGrok = 0;      // GROK spend, capped separately
let stopped = false;

outer:
for (let r = 0; r < RUNS; r++) {
  for (let i = 0; i < prompts.length; i++) {
    /* THE ENGINES RUN IN PARALLEL for one input (one slow model no longer serialises the rest), so the cap is checked against the SUM of every engine's
       worst case for this input BEFORE any of them is called. */
    /* Grok runs only on the first GROK_MAX_INPUTS inputs of the FIRST run, and only while its own cap holds. Claude's batch must fit the Claude cap. */
    const engines = active.filter((e) => e.kind === 'claude' || (r === 0 && i < GROK_MAX_INPUTS && spentGrok + worstCase(e, prompts[i]) <= CAP_GROK));
    const batch = engines.filter((e) => e.kind === 'claude').reduce((a, e) => a + worstCase(e, prompts[i]), 0);
    if (spent + batch > CAP_CLAUDE) { stopped = true; break outer; }
    const runEng = async (eng) => {
      const wc = worstCase(eng, prompts[i]);
      const st = stats.get(eng.id);
      try {
        const out = await callOne(eng, prompts[i]);
        const cost = parseAiUsage(eng.id, out.usage).costUsd;
        { const add = typeof cost === 'number' && Number.isFinite(cost) ? cost : wc; if (eng.kind === 'grok') spentGrok += add; else spent += add; }   // an unmeasurable call is charged its worst case
        st.done += 1;
        st.lat.push(out.ms);
        if (typeof cost === 'number') st.cost.push(cost);
        /* DIAGNOSTICS, all numbers or booleans (no text): which of the two production parsers rejected the answer, whether it was cut off by the token limit,
           whether the word SIGNAL appears at all, and how long the answer was. Enough to tell a format miss from a truncation without printing an answer. */
        const vOk = !!parseVerdict(out.text);
        const cOk = !!parseCombinedRead(out.text, '15m', 'London');
        if (vOk) st.verdictOk += 1;
        if (cOk) st.combinedOk += 1;
        if (vOk && cOk) st.parsed += 1;
        if (out.stop === 'max_tokens' || out.stop === 'length') st.truncated += 1;
        if (/SIGNAL/i.test(out.text)) st.hasSignalWord += 1;
        st.chars.push(out.text.length);
        const ot = Number(out.usage?.output_tokens ?? out.usage?.completion_tokens);
        if (Number.isFinite(ot)) st.outTok.push(ot);
      } catch (e) {
        const status = typeof e?.status === 'number' ? e.status : null;
        if (!(status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429)) { if (eng.kind === 'grok') spentGrok += wc; else spent += wc; }   // a clean 4xx was not billed
        /* A FIXED CODE, never the error's own text: the message is only INSPECTED here, and what is printed is chosen from this list. */
        const msg = String(e?.error?.error?.message ?? e?.message ?? '');
        const why = /credit|billing|balance/i.test(msg) ? '_CREDIT'
          : /not_found|model/i.test(msg) ? '_MODEL'
          : /api[_ -]?key|authentic|permission/i.test(msg) ? '_AUTH'
          : /max_tokens/i.test(msg) ? '_MAX_TOKENS'
          : /system/i.test(msg) ? '_SYSTEM'
          : /temperature|top_p|thinking/i.test(msg) ? '_SAMPLING'
          : /messages|content|role/i.test(msg) ? '_MESSAGES' : '';
        /* The API's own error TYPE is a closed vocabulary (not free text); it is printed only if it is one of these words. */
        const apiType = String(e?.error?.error?.type ?? e?.error?.type ?? '');
        const typeWord = ['invalid_request_error', 'authentication_error', 'permission_error', 'not_found_error', 'rate_limit_error', 'api_error', 'overloaded_error', 'billing_error'].includes(apiType) ? '_' + apiType.toUpperCase() : '';
        const cls = status !== null ? 'HTTP_' + status + why + typeWord : 'ERROR';
        st.fail.set(cls, (st.fail.get(cls) ?? 0) + 1);
      }
    };
    if (SEQUENTIAL) { for (const e of engines) await runEng(e); } else { await Promise.all(engines.map(runEng)); }
    if ((i + 1) % 10 === 0) say('PROGRESS run=', r + 1, 'input=', i + 1, 'spent_claude_usd=', spent, 'spent_grok_usd=', spentGrok);
  }
}

const pct = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
say('QUICK_READ_BAKEOFF inputs=', INPUTS, 'runs=', RUNS, 'cap_claude_usd=', CAP_CLAUDE, 'cap_grok_usd=', CAP_GROK, 'grok_inputs=', GROK_MAX_INPUTS);
for (const e of active) {
  const s = stats.get(e.id);
  const mean = s.cost.length ? s.cost.reduce((a, b) => a + b, 0) / s.cost.length : NaN;
  say(e.id, 'calls=', s.done, 'parsed=', s.parsed, 'parse_rate=', s.done ? s.parsed / s.done : NaN,
    'p50_ms=', pct(s.lat, 50), 'p95_ms=', pct(s.lat, 95), 'mean_usd=', mean, mean <= CEILING_USD ? 'UNDER_CEILING' : 'OVER_CEILING');
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const nFail = [...s.fail.values()].reduce((a, b) => a + b, 0);
  say(e.id, 'rates fail_rate=', s.done + nFail ? nFail / (s.done + nFail) : NaN, 'truncation_rate=', s.done ? s.truncated / s.done : NaN, 'max_tokens=', MAX_TOKENS, SEQUENTIAL ? 'SEQUENTIAL' : 'PARALLEL');
  say(e.id, 'diag verdict_ok=', s.verdictOk, 'combined_ok=', s.combinedOk, 'truncated=', s.truncated, 'has_signal_word=', s.hasSignalWord, 'mean_out_tokens=', avg(s.outTok), 'mean_chars=', avg(s.chars));
  for (const [cls, n] of s.fail) say(e.id, 'failed', cls, n);
}
say('CEILING_USD=', CEILING_USD);
say('SPENT_CLAUDE_USD=', spent, 'CAP_CLAUDE_USD=', CAP_CLAUDE);
say('SPENT_GROK_USD=', spentGrok, 'CAP_GROK_USD=', CAP_GROK);
say('SPENT_TOTAL_USD=', spent + spentGrok, stopped ? 'STOPPED_AT_CAP' : 'COMPLETED');
