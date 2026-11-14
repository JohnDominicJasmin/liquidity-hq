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
