import { readJsonCapped, BODY_CAPS } from '@/lib/requestBody';
import { AI_TOOL_LIMITS } from '@/lib/aiInputLimits';
import { NextRequest, NextResponse } from 'next/server';
import { xaiFetch } from '@/lib/xai';
import { recordAiCall } from '@/lib/aiCallLog';
import { incrementToolUsage, rateLimitMessage, refundToolUsage, todayUtc, blockedResponse } from '@/lib/aiUsage';
import { requireProPlan, hasProFeatures } from '@/lib/entitlements';
import { getUserCompatForBilledCall } from '@/lib/authUser';
import { userClient } from '@/lib/supabase-user';
import { answerWasCutOff } from '@/lib/xaiAnswer';
import { apiError } from '@/lib/apiError';
import { bearerToken } from '@/lib/bearerToken';

const GROK_KEY = process.env.GROK_API_KEY ?? '';

function sb(token: string) {
  return userClient(token);
}

function buildStrategyPrompt(description: string): string {
  return [
    'You are a quantitative trading strategy analyst specializing in crypto derivatives. A trader has described a strategy they want to research. Provide a thorough, honest analysis.',
    '',
    `STRATEGY DESCRIPTION: "${description}"`,
    '',
    /* #1631 (audit 2026-11-16): the parameters and the Strong/Moderate/Weak rating came with no sample behind them and read as measured. */
    'You have NO backtest, price data or trade results for this strategy: the sample size is zero. Do not state a win rate, expectancy, drawdown or any other figure as if it were measured. The parameters are starting points to test, not tested or optimised values. The edge rating is a judgement from general knowledge, not a measurement; say that in HONEST_ASSESSMENT.',
    '',
    '=== ANALYSIS TASKS ===',
    '',
    '1. THEORETICAL_EDGE - Explain WHY this strategy would have positive expected value. What market inefficiency or behavioral pattern does it exploit? Be honest - if the edge is weak or well-known (i.e., alpha has decayed), say so.',
    '',
    '2. OPTIMAL_CONDITIONS - When does this strategy work best? Be specific:',
    '   - Market regime (trending, ranging, high/low volatility)',
    '   - Best timeframes for crypto',
    '   - Best sessions (NY, London, Asia)',
    '   - Which coins it suits (BTC/ETH majors vs. alts)',
    '',
    '3. KEY_RISKS - What will kill this strategy? List failure modes:',
    '   - Market conditions it fails in',
    '   - Common implementation mistakes',
    '   - Crypto-specific risks (funding rate drag, liquidation cascades, low liquidity wicks)',
    '',
    '4. PARAMETER_SUGGESTIONS - Concrete starting parameters for crypto futures, to be tested before use (none of them has been tested here):',
    '   - Recommended timeframe(s)',
    '   - Entry trigger definition',
    '   - Stop loss placement method',
    '   - Take profit / R:R target',
    '   - Position sizing approach',
    '',
    '5. CRYPTO_NOTES - Adjustments needed vs. traditional markets:',
    '   - How 24/7 trading affects this strategy',
    '   - Funding rate impact (if perpetuals)',
    '   - Weekend/Sunday gap behavior',
    '   - How to handle news-driven wicks',
    '',
    '6. HONEST_ASSESSMENT - Bottom line: is this strategy worth pursuing? Rate edge strength as Strong / Moderate / Weak / Unknown. Give your reasoning in 1-2 sentences.',
    '',
    'Output using EXACTLY these headers (no markdown bold, no extra text):',
    'THEORETICAL_EDGE:',
    '[explanation]',
    'OPTIMAL_CONDITIONS:',
    '[bullet list]',
    'KEY_RISKS:',
    '[bullet list]',
    'PARAMETER_SUGGESTIONS:',
    '[structured list]',
    'CRYPTO_NOTES:',
    '[bullet list]',
    'HONEST_ASSESSMENT:',
    '[edge strength rating + 1-2 sentence verdict]',
  ].join('\n');
}

export async function POST(req: NextRequest) {
  const token = bearerToken(req.headers);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: authData } = await getUserCompatForBilledCall(token);
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Pro-only. This tool is reachable in-product only from /backtest, which
  // is fully paywalled in the UI - so without a server-side check the paid
  // xAI call was still callable directly with a free account token. Trial
  // users pass (hasProFeatures covers isTrial).
  const plan = await requireProPlan(token, authData.user.id, 'Strategy research is a Pro feature.');
  if (!plan.ok) return plan.response;

  if (!GROK_KEY) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });

  /* VALIDATE BEFORE CHARGING (#1413, PM): an input that is refused with a 400 must not cost the user one of their daily uses, so the checks run first and the usage is counted after. */
  const capped = await readJsonCapped(req, BODY_CAPS.aiShort);
  if (capped.tooLarge) return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  const body = (capped.value ?? {}) as { description?: string };
  if (body.description != null && typeof body.description !== 'string') return NextResponse.json({ error: 'INVALID_INPUT', message: 'description must be text.' }, { status: 400 });
  const description = (body.description ?? '').trim();
  if (description.length > AI_TOOL_LIMITS.text) return NextResponse.json({ error: 'INVALID_INPUT', message: `Keep the description under ${AI_TOOL_LIMITS.text} characters.` }, { status: 400 });
  if (!description || description.length < 10) {
    return NextResponse.json({ error: 'Describe a strategy to research' }, { status: 400 });
  }

  const role = plan.tier;
  /* A reserved use is given back when no answer reached the user (xAI refused, the call threw, the answer was unusable), as /api/grok does; not after a billed 2xx with a usable answer. (U4) */
  const reservedOn = todayUtc();
  const usageResult = await incrementToolUsage(authData.user.id, 'strategyResearch', role, reservedOn);
  if (usageResult.blocked) {
    return blockedResponse(usageResult.reason, rateLimitMessage(usageResult.reason, usageResult.limit, 'strategy research runs'));
  }

  const prompt = buildStrategyPrompt(description);

  const res = await xaiFetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
    body: JSON.stringify({
      model: 'grok-4.3',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1200,
    }),
  }).catch(async (e: unknown) => { await refundToolUsage(authData.user.id, 'strategyResearch', reservedOn); throw e; });

  if (!res.ok) {
    await refundToolUsage(authData.user.id, 'strategyResearch', reservedOn);
    const err = await res.json().catch(() => ({})) as { error?: string };
    /* The provider's own error text is logged, never shown (QA behavioural run of #2559): same as thesis-check and pine-script. */
    return apiError('strategy-research', err.error ?? 'upstream AI error', 502, 'AI service error');
  }

  const data = await res.json();
  await recordAiCall({ userId: authData.user.id, callType: 'strategy_research', model: data.model ?? 'grok-4.3', usage: data.usage });
  const text: string = data.choices?.[0]?.message?.content ?? '';
  /* AN EMPTY OR CUT-OFF ANSWER IS NOT AN ANSWER (owner sweep 2026-11-18): it used to return 200 with a blank or half text and the use
     was spent. Now the use is given back and the page is told the answer was incomplete. */
  if (!text.trim() || answerWasCutOff(data)) {
    /* "Nothing was charged" only when the refund landed: it allows 3 a day and answers null after that (QA review of #2586, U9). */
    const refunded = (await refundToolUsage(authData.user.id, 'strategyResearch', reservedOn)) !== null;
    if (!refunded) return NextResponse.json({ error: 'The AI answer was incomplete. Try again.', code: 'AI_INCOMPLETE', refunded }, { status: 502 });
    return NextResponse.json({ error: 'The AI answer was incomplete. Nothing was charged. Try again.', code: 'AI_INCOMPLETE', refunded }, { status: 502 });
  }

  return NextResponse.json({ analysis: text });
}
