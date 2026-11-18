import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import path from 'node:path';
import { NextRequest } from 'next/server.js';

/* QA's BEHAVIOURAL run of #2559: the REAL thesis-check, strategy-research and pine-script handlers, in-process, with the paid call's answer chosen per case (qa/harness/aiIncompleteStubs.mjs) and the refund COUNTED.
 *   A1  CONTROL: a complete answer is 200, charged once, refunded never (so a refund below means the route decided it, and a dead counter cannot fake a pass)
 *   A2  an answer cut off at the output cap (status "incomplete") -> 502 AI_INCOMPLETE and exactly one refund
 *   A3  a cut-off signalled as finish_reason "length" -> same
 *   A4  an EMPTY answer (blank text) -> same
 *   A5  an upstream 502 -> 502 and exactly one refund
 *   A6  the paid call THROWS -> the route throws and exactly one refund
 *   A7  across A2-A5 no response text names the vendor (grok / xai / x.ai) or carries a raw 4xx/5xx number
 * Source pins are in __tests__/aiRefundRemainingRoutes.test.mts; this file is the behaviour. */
process.env.GROK_API_KEY = 'qa-harness-not-a-key';
const root = path.resolve('.'); const stubs = path.join(root, 'qa/harness/aiIncompleteStubs.mjs');
const jiti = createJiti(import.meta.url, { alias: { '@/lib/aiUsage': stubs, '@/lib/entitlements': stubs, '@/lib/authUser': stubs, '@/lib/supabase-user': stubs, '@/lib/aiCallLog': stubs, '@/lib/apiError': stubs, '@/lib/xai': stubs, '@': root }, interopDefault: true, moduleCache: false });
type H = { mode: string; increments: number; refunds: Array<{ tool: string }>; xai: number };
const hh = () => ((globalThis as unknown as { __aiInc: H }).__aiInc ??= { mode: 'ok', increments: 0, refunds: [], xai: 0 });
const ROUTES = [
  { name: 'thesis-check', tool: 'thesisCheck', path: 'app/api/thesis-check/route.ts', body: { symbol: 'BTC', direction: 'long', thesisText: 'Bitcoin breaks out after the halving cycle turns.', assumptions: ['ETF inflows stay positive'] } },
  { name: 'strategy-research', tool: 'strategyResearch', path: 'app/api/strategy-research/route.ts', body: { description: 'buy dips on btc when RSI is below thirty' } },
  { name: 'pine-script', tool: 'pineScript', path: 'app/api/pine-script/route.ts', body: { description: 'ema cross with an rsi filter', analysisText: 'analysis' } },
] as const;
async function run(r: (typeof ROUTES)[number], mode: string) {
  const mod = await jiti.import(path.join(root, r.path)); const h = hh(); h.mode = mode; h.increments = 0; h.refunds = []; h.xai = 0;
  const req = new NextRequest('http://localhost/api/x', { method: 'POST', body: JSON.stringify(r.body), headers: { 'content-type': 'application/json', Authorization: 'Bearer t' } });
  try {
    const res = await (mod as { POST: (q: NextRequest) => Promise<Response> }).POST(req); const text = await res.text(); let json: Record<string, unknown> = {}; try { json = JSON.parse(text); } catch { /* not json */ }
    return { threw: false, status: res.status, text, json, increments: h.increments, refunds: h.refunds.length, tools: h.refunds.map((x) => x.tool), xai: h.xai };
  } catch (e) { return { threw: true, status: 0, text: String(e), json: {} as Record<string, unknown>, increments: h.increments, refunds: h.refunds.length, tools: h.refunds.map((x) => x.tool), xai: h.xai }; }
}
const VENDOR_OR_STATUS = /grok|xai|x\.ai|\b[45]\d\d\b/i;
for (const r of ROUTES) {
  test(`${r.name}: A1 CONTROL: a complete answer is 200, charged once, never refunded`, async () => {
    const o = await run(r, 'ok'); assert.equal(o.status, 200, `status ${o.status}: ${o.text.slice(0, 120)}`); assert.equal(o.increments, 1); assert.equal(o.refunds, 0); assert.equal(o.xai, 1);
  });
  for (const [id, mode, label] of [['A2', 'incomplete', 'a cut-off answer (status incomplete)'], ['A3', 'length', 'a cut-off answer (finish_reason length)'], ['A4', 'empty', 'an EMPTY answer']] as const) {
    test(`${r.name}: ${id} ${label} is 502 AI_INCOMPLETE and refunded exactly once`, async () => {
      const o = await run(r, mode); assert.equal(o.status, 502, `status ${o.status}: ${o.text.slice(0, 120)}`); assert.equal(o.json.code, 'AI_INCOMPLETE'); assert.equal(o.increments, 1); assert.equal(o.refunds, 1, 'the use was not given back'); assert.deepEqual(o.tools, [r.tool]);
      assert.doesNotMatch(String(o.json.error ?? ''), VENDOR_OR_STATUS, 'A7: the text names the vendor or a raw status');
    });
  }
  test(`${r.name}: A5 an upstream 502 is 502 and refunded exactly once, with no vendor or raw status in the text`, async () => {
    const o = await run(r, 'upstream502'); assert.equal(o.status, 502, `status ${o.status}`); assert.equal(o.increments, 1); assert.equal(o.refunds, 1); assert.doesNotMatch(String(o.json.error ?? ''), VENDOR_OR_STATUS, `A7: ${o.text.slice(0, 160)}`);
  });
  test(`${r.name}: A6 a throw from the paid call is refunded exactly once`, async () => {
    const o = await run(r, 'throw'); assert.equal(o.threw, true, 'the route swallowed the network failure'); assert.equal(o.increments, 1); assert.equal(o.refunds, 1);
  });
}
