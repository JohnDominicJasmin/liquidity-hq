/* Stand-ins for qa/harness/aiIncomplete.test.mts: like aiRouteStubs.mjs, but the paid call's answer is chosen by the test (globalThis.__aiInc.mode), the REFUND is counted, and apiError answers like the real one (a Response with the public message). Nothing leaves the machine. */
const h = () => (globalThis.__aiInc ??= { mode: 'ok', increments: 0, refunds: [], xai: 0 });
export const incrementToolUsage = async () => { h().increments++; return { blocked: false }; };
export const refundToolUsage = async (userId, tool, day) => { h().refunds.push({ userId, tool, day }); };
export const todayUtc = () => '2026-11-18';
export const blockedResponse = () => new Response(JSON.stringify({ error: 'blocked' }), { status: 429 });
export const rateLimitMessage = () => 'limit';
export const getUsageTier = async () => 'pro';
export const hasProFeatures = async () => true;
export const requireProPlan = async () => ({ ok: true, tier: 'pro' });
export const getUserCompatForBilledCall = async () => ({ data: { user: { id: 'u-qa-harness', email: 'qa@example.test' } }, error: null });
export const userClient = () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) });
export const recordAiCall = async () => {};
export const apiError = (_where, _internal, status, publicMessage) => new Response(JSON.stringify({ error: publicMessage ?? 'Something went wrong' }), { status: status ?? 500, headers: { 'content-type': 'application/json' } });
const answer = (text, extra = {}) => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }], output: [{ type: 'message', content: [{ text }] }], usage: {}, model: 'stub', ...extra });
export const xaiFetch = async () => {
  const s = h(); s.xai++;
  if (s.mode === 'throw') throw new Error('network down');
  if (s.mode === 'upstream502') return new Response(JSON.stringify({ error: 'upstream 502 bad gateway' }), { status: 502, headers: { 'content-type': 'application/json' } });
  const body = s.mode === 'ok' ? answer('A complete and usable answer for the user.')
    : s.mode === 'incomplete' ? answer('A half an answ', { status: 'incomplete' })
    : s.mode === 'length' ? { ...answer('A half an answ'), choices: [{ message: { content: 'A half an answ' }, finish_reason: 'length' }] }
    : answer('   ');
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};
