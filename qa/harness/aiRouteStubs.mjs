/* Stand-ins for what the paid AI tool routes lean on, so the REAL route handler runs in-process and the usage counter can be read: every call to incrementToolUsage is counted in globalThis.__aiHarness.increments. Nothing is called out. */
const h = () => (globalThis.__aiHarness ??= { increments: [], xai: 0 });
export const incrementToolUsage = async (userId, tool, tier) => { h().increments.push({ userId, tool, tier }); return { blocked: false }; };
export const rateLimitMessage = () => 'limit';
export const getUsageTier = async () => 'pro';
export const hasProFeatures = async () => true;
export const getUserCompatForBilledCall = async () => ({ data: { user: { id: 'u-qa-harness', email: 'qa@example.test' } }, error: null });
export const userClient = () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) });
export const recordAiCall = async () => {};
export const apiError = () => {};
export const xaiFetch = async () => { h().xai++; return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], output: [{ content: [{ text: 'ok' }] }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } }); };
/* requireProPlan (lib/entitlements.ts) is what the three tool routes call since the plan check moved into one helper: a Pro account, as getUsageTier / hasProFeatures above already say. Missing, every cell failed with `requireProPlan is not a function` (release 2026-11-19 harness run). */
export const requireProPlan = async () => ({ ok: true, tier: 'pro' });
/* the usage reservation the routes now make before the call and give back on a failure (lib/aiUsage.ts): todayUtc names the day reserved on, refundToolUsage is counted (globalThis.__aiHarness.refunds) so a cell can see a refund, blockedResponse is only reached when incrementToolUsage says blocked (the stub never does). */
export const todayUtc = () => new Date().toISOString().slice(0, 10);
export const refundToolUsage = async (userId, tool, day) => { (h().refunds ??= []).push({ userId, tool, day }); };
export const blockedResponse = () => new Response(JSON.stringify({ error: 'blocked' }), { status: 429, headers: { 'content-type': 'application/json' } });
