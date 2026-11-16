#!/usr/bin/env node
/* THE QUICK-READ BLIND PAIRS (#1631, owner decision 2026-11-15: "Blind test first"): the same N quick-read inputs answered by Grok and by Claude Haiku 5.5, collected so a PERSON can
 * read them with the engine names hidden and pick. Answer QUALITY is the one thing the bake-off could not measure.
 *
 *   node --import ./qa/alias-register.mjs scripts/bakeoff/quick/blind-pairs.mjs      (CI: .github/workflows/quick-blind-pairs.yml)
 *
 * ── NOTHING READABLE LEAVES THIS PROCESS ──
 * The repository and its Actions logs are PUBLIC. So: the log carries counts, engine names and dollar amounts only (the same `say()` rule as run.mjs); and the answers and which engine
 * wrote which are written ONLY as an ENCRYPTED file (`blind-pairs.enc.json`), hybrid-encrypted to a PUBLIC key that the person running the workflow generated on their own machine and
 * passed in. Only the holder of the matching private key can read it, and the private key never reaches GitHub. The shuffling of A and B, and the pick sheet, happen afterwards on that
 * person's machine (scripts/bakeoff/quick/blind-render.mjs), so the key to the sheet is never on GitHub in any readable form either.
 *
 * ── THE CALLS ARE THE PRODUCTION CALLS ──
 * Grok: `grok-4.3`, the prompt as the only user message, 800 output tokens (app/api/grok/route.ts). Claude: `claude-haiku-5-5` through the same request shape the route uses
 * (lib/claudeRequest.ts), the shared guardrail as the system prompt, 1,600 output tokens. Same prompt string to both. Inputs are the bake-off's seeded market contexts (no user data).
 *
 * ── THE SPEND IS CAPPED IN CODE ──
 * Grok at most $0.25 (the owner's xAI limit, as in run.mjs) and Claude at most $0.25; a call is refused if the spend so far plus its worst case would pass its cap. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { AI_GUARDRAIL } from '../../../lib/aiGuardrail.ts';
import { ANTHROPIC_RATES_BY_MODEL, XAI_RATES_BY_MODEL, parseAiUsage } from '../../../lib/aiCost.ts';
import { parseCombinedRead } from '../../../lib/grok.ts';
import { claudeShape } from '../../../lib/claudeRequest.ts';
import { makeInputs } from './make-inputs.mjs';

const N = Math.max(1, Math.min(20, Number(process.env.BLIND_PAIRS) || 10));
const GROK = { id: 'grok-4.3', rates: XAI_RATES_BY_MODEL['grok-4.3'], maxTokens: 800 };
const HAIKU = { id: 'claude-haiku-5-5', rates: ANTHROPIC_RATES_BY_MODEL['claude-haiku-5-5'], maxTokens: 1600 };
const CAP_GROK = Math.min(0.25, Number(process.env.BLIND_CAP_GROK_USD) > 0 ? Number(process.env.BLIND_CAP_GROK_USD) : 0.25);
const CAP_CLAUDE = Math.min(0.25, Number(process.env.BLIND_CAP_CLAUDE_USD) > 0 ? Number(process.env.BLIND_CAP_CLAUDE_USD) : 0.25);

/** THE ONE OUTPUT CHANNEL: fixed words, engine names, numbers. Never a prompt, an answer, an error's text, or a key. */
function say(...parts) {
  const out = parts.map((p) => {
    if (typeof p === 'number') return Number.isFinite(p) ? String(Math.round(p * 1e6) / 1e6) : 'NaN';
    if (typeof p === 'string' && /^[A-Za-z_=0-9.$%: ()/<>-]{1,60}$/.test(p)) return p;
    throw new Error('BAD_OUTPUT');
  });
  console.log(out.join(' '));
}

const pubPem = (process.env.BLIND_PUBKEY_PEM ?? '').trim();
if (!pubPem.includes('BEGIN PUBLIC KEY')) { say('NO_PUBLIC_KEY'); process.exit(1); }
const haveGrok = !!process.env.GROK_API_KEY;
const haveClaude = !!process.env.ANTHROPIC_API_KEY;
if (!haveGrok || !haveClaude) { say('MISSING_KEY grok=', haveGrok ? 1 : 0, 'claude=', haveClaude ? 1 : 0); process.exit(1); }
const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
const anthropic = new Anthropic({ timeout: 60_000, maxRetries: 1, ...(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {}) });

const worstCase = (e, prompt) => (Math.ceil(prompt.length / 3) * e.rates.input + (e === HAIKU ? claudeShape(e.id, e.maxTokens).maxTokens : e.maxTokens) * e.rates.output) / 1e6;

async function callGrok(prompt) {
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(120_000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROK_API_KEY}` },
    body: JSON.stringify({ model: GROK.id, messages: [{ role: 'user', content: prompt }], max_tokens: GROK.maxTokens }),
  });
  if (!res.ok) { const e = new Error('http'); e.status = res.status; throw e; }
  const d = await res.json();
  return { text: d?.choices?.[0]?.message?.content ?? '', usage: d?.usage };
}
async function callHaiku(prompt) {
  const shape = claudeShape(HAIKU.id, HAIKU.maxTokens);
  const r = await anthropic.messages.create({ model: HAIKU.id, max_tokens: shape.maxTokens, system: AI_GUARDRAIL, messages: [{ role: 'user', content: prompt }], ...shape.params });
  let text = '';
  for (const b of r.content) if (b.type === 'text') text += b.text;
  return { text, usage: r.usage };
}

const inputs = makeInputs(N);
let spentGrok = 0, spentClaude = 0;
const items = [];
const failed = new Map();
const note = (k) => failed.set(k, (failed.get(k) ?? 0) + 1);

for (let i = 0; i < inputs.length; i++) {
  const { ctx, prompt } = inputs[i];
  // one call at a time (the first bake-off's 44% 503 rate came from firing four engines at once); each engine at most twice (a transient failure is retried once)
  const got = {};
  for (const [key, eng, fn] of [['grok', GROK, callGrok], ['haiku', HAIKU, callHaiku]]) {
    for (let attempt = 0; attempt < 2 && !got[key]; attempt++) {
      const wc = worstCase(eng, prompt);
      const spent = key === 'grok' ? spentGrok : spentClaude;
      if (spent + wc > (key === 'grok' ? CAP_GROK : CAP_CLAUDE)) { note(`${key}_CAP`); break; }
      try {
        const out = await fn(prompt);
        const cost = parseAiUsage(eng.id, out.usage).costUsd;
        const add = typeof cost === 'number' && Number.isFinite(cost) ? cost : wc;
        if (key === 'grok') spentGrok += add; else spentClaude += add;
        const parsed = parseCombinedRead(out.text, '15m', 'London');
        if (!parsed) { note(`${key}_UNPARSED`); continue; }
        got[key] = { text: out.text, parsed, costUsd: typeof cost === 'number' ? cost : null };
      } catch (e) {
        const status = typeof e?.status === 'number' ? e.status : null;
        if (!(status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429)) { if (key === 'grok') spentGrok += wc; else spentClaude += wc; }
        note(status !== null ? `${key}_HTTP_${status}` : `${key}_ERROR`);
      }
    }
  }
  if (got.grok && got.haiku) items.push({ i: i + 1, ctx, prompt, grok: got.grok, haiku: got.haiku });
}

say('BLIND_PAIRS requested=', N, 'complete=', items.length, 'spent_grok_usd=', spentGrok, 'spent_claude_usd=', spentClaude, 'caps_usd=', CAP_GROK, CAP_CLAUDE);
for (const [k, n] of failed) say('failed', k, n);
if (items.length === 0) { say('NOTHING_TO_WRITE'); process.exit(1); }

// HYBRID ENCRYPTION: a fresh AES-256-GCM key encrypts the bundle; RSA-OAEP (SHA-256) wraps that key with the public key. Only the private-key holder can open it.
const aesKey = crypto.randomBytes(32), iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
const ct = Buffer.concat([cipher.update(JSON.stringify({ made: new Date().toISOString(), engines: { a: GROK.id, b: HAIKU.id }, items }), 'utf8'), cipher.final()]);
const tag = cipher.getAuthTag();
const wrapped = crypto.publicEncrypt({ key: pubPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, aesKey);
fs.writeFileSync('blind-pairs.enc.json', JSON.stringify({ v: 1, k: wrapped.toString('base64'), iv: iv.toString('base64'), tag: tag.toString('base64'), ct: ct.toString('base64') }));
say('WROTE blind-pairs.enc.json bytes=', fs.statSync('blind-pairs.enc.json').size);
