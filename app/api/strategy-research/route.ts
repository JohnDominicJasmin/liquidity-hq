import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { incrementToolUsage, rateLimitMessage } from '@/lib/aiUsage';
import { getUserRole, hasProFeatures } from '@/lib/entitlements';

const GROK_KEY = process.env.GROK_API_KEY ?? '';

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function buildStrategyPrompt(description: string): string {
  return [
    'You are a quantitative trading strategy analyst specializing in crypto derivatives. A trader has described a strategy they want to research. Provide a thorough, honest analysis.',
    '',
    `STRATEGY DESCRIPTION: "${description}"`,
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
    '4. PARAMETER_SUGGESTIONS - Concrete starting parameters for crypto futures:',
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
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: authData } = await sb(token).auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Pro-only. This tool is reachable in-product only from /backtest, which
  // is fully paywalled in the UI - so without a server-side check the paid
  // xAI call was still callable directly with a free account token. Trial
  // users pass (hasProFeatures covers isTrial).
  if (!(await hasProFeatures(token, authData.user.id))) {
    return NextResponse.json({ error: 'PRO_REQUIRED', message: 'Strategy research is a Pro feature.' }, { status: 403 });
  }

  if (!GROK_KEY) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });

  const role = await getUserRole(token, authData.user.id);
  const usageResult = await incrementToolUsage(authData.user.id, 'strategyResearch', role);
  if (usageResult.blocked) {
    return NextResponse.json(
      { error: rateLimitMessage(usageResult.reason, usageResult.limit, 'strategy research runs'), code: 'RATE_LIMIT' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => ({})) as { description?: string };
  const description = (body.description ?? '').trim();
  if (!description || description.length < 10) {
    return NextResponse.json({ error: 'Describe a strategy to research' }, { status: 400 });
  }

  const prompt = buildStrategyPrompt(description);

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
    body: JSON.stringify({
      model: 'grok-4.3',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1200,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json({ error: (err as { error?: string }).error ?? 'AI error' }, { status: 502 });
  }

  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? '';

  return NextResponse.json({ analysis: text });
}
