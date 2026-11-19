import { readJsonCapped, BODY_CAPS } from '@/lib/requestBody';
import { AI_TOOL_LIMITS } from '@/lib/aiInputLimits';
import { NextRequest, NextResponse } from 'next/server';
import { xaiFetch } from '@/lib/xai';
import { recordAiCall } from '@/lib/aiCallLog';
import { incrementToolUsage, rateLimitMessage, refundToolUsage, todayUtc, blockedResponse } from '@/lib/aiUsage';
import { requireProPlan, hasProFeatures } from '@/lib/entitlements';
import { apiError } from '@/lib/apiError';
import { getUserCompatForBilledCall } from '@/lib/authUser';
import { userClient } from '@/lib/supabase-user';
import { answerWasCutOff } from '@/lib/xaiAnswer';
import { stripCodeFence } from '@/lib/codeFence';
import { bearerToken } from '@/lib/bearerToken';

const GROK_KEY = process.env.GROK_API_KEY ?? '';

function sb(token: string) {
  return userClient(token);
}

function buildPinePrompt(description: string, analysisText: string): string {
  return [
    'You are an expert Pine Script v6 developer and trading strategy programmer. Generate complete, working Pine Script v6 code for a TradingView indicator based on the strategy below.',
    '',
    'STRATEGY DESCRIPTION:',
    description,
    '',
    'STRATEGY ANALYSIS (from AI research):',
    analysisText.slice(0, 2000),
    '',
    '=== PINE SCRIPT REQUIREMENTS ===',
    '',
    '1. Use Pine Script VERSION 6 (// @version=6 at the top)',
    '2. Write it as an INDICATOR (not a strategy) so it works on all charts without backtesting overhead',
    '3. Include:',
    '   - Clear entry signal plotshape() markers (green arrows for long, red for short)',
    '   - The core indicator logic (EMA, RSI, or whatever the strategy requires)',
    '   - alertcondition() calls for TradingView alerts on LONG and SHORT signals',
    '   - A simple but accurate title reflecting the strategy',
    '4. Add inline comments explaining each key logic step',
    '5. Make the inputs (lengths, thresholds) adjustable via input() functions',
    '6. Do NOT use deprecated functions - use ta.ema() not ema(), ta.rsi() not rsi(), etc.',
    '',
    'Output the Pine Script code ONLY - no explanation text before or after. Start directly with //@version=6',
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
  const plan = await requireProPlan(token, authData.user.id, 'Pine script export is a Pro feature.');
  if (!plan.ok) return plan.response;

  if (!GROK_KEY) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });

  /* VALIDATE BEFORE CHARGING (#1413, PM): an input that is refused with a 400 must not cost the user one of their daily uses, so the checks run first and the usage is counted after. */
  const capped = await readJsonCapped(req, BODY_CAPS.aiPine);
  if (capped.tooLarge) return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  const body = (capped.value ?? {}) as {
    description?: string;
    analysisText?: string;
  };

  if ((body.description != null && typeof body.description !== 'string') || (body.analysisText != null && typeof body.analysisText !== 'string')) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: 'description and analysisText must be text.' }, { status: 400 });
  }
  const description  = (body.description ?? '').trim();
  const analysisText = (body.analysisText ?? '').trim();
  if (description.length > AI_TOOL_LIMITS.text || analysisText.length > AI_TOOL_LIMITS.analysis) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: 'The description or analysis is too long.' }, { status: 400 });
  }

  if (description.length < 10) {
    return NextResponse.json({ error: 'No strategy description provided' }, { status: 400 });
  }

  const role = plan.tier;
  /* A reserved use is given back when no answer reached the user (xAI refused, the call threw, the answer was unusable), as /api/grok does; not after a billed 2xx with a usable answer. (U4) */
  const reservedOn = todayUtc();
  const usageResult = await incrementToolUsage(authData.user.id, 'pineScript', role, reservedOn);
  if (usageResult.blocked) {
    return blockedResponse(usageResult.reason, rateLimitMessage(usageResult.reason, usageResult.limit, 'Pine Script generations'));
  }

  const prompt = buildPinePrompt(description, analysisText);

  const res = await xaiFetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
    body: JSON.stringify({
      model: 'grok-4.3',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1200,
    }),
  }).catch(async (e: unknown) => { await refundToolUsage(authData.user.id, 'pineScript', reservedOn); throw e; });

  if (!res.ok) {
    await refundToolUsage(authData.user.id, 'pineScript', reservedOn);
    const err = await res.json().catch(() => ({})) as { error?: string };
    return apiError('pine-script', err.error ?? 'upstream AI error', 502, 'AI service error');
  }

  const data = await res.json();
  await recordAiCall({ userId: authData.user.id, callType: 'pine_script', model: data.model ?? 'grok-4.3', usage: data.usage });
  /* The model may wrap the script in a ``` fence despite "code ONLY", and the Copy button copied the fence too, which does not compile in
     TradingView (#1631). The fence is removed; the script inside is returned unchanged. */
  const code: string = stripCodeFence(data.choices?.[0]?.message?.content ?? '');
  /* AN EMPTY OR CUT-OFF ANSWER IS NOT AN ANSWER (owner sweep 2026-11-18): it used to return 200 with a blank or half text and the use
     was spent. Now the use is given back and the page is told the answer was incomplete. */
  if (!code.trim() || answerWasCutOff(data)) {
    /* "Nothing was charged" only when the refund landed: it allows 3 a day and answers null after that (QA review of #2586, U9). */
    const refunded = (await refundToolUsage(authData.user.id, 'pineScript', reservedOn)) !== null;
    if (!refunded) return NextResponse.json({ error: 'The AI answer was incomplete. Try again.', code: 'AI_INCOMPLETE', refunded }, { status: 502 });
    return NextResponse.json({ error: 'The AI answer was incomplete. Nothing was charged. Try again.', code: 'AI_INCOMPLETE', refunded }, { status: 502 });
  }

  return NextResponse.json({ code });
}
