import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const GROK_KEY = process.env.GROK_API_KEY ?? '';

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
}

function buildUnlockPrompt(symbol: string): string {
  return [
    `You are a crypto tokenomics analyst specializing in vesting schedules and token unlock events. Analyze "${symbol}" for upcoming unlock-driven sell pressure.`,
    '',
    'Use your training data on vesting schedules, tokenomics documents, and historical unlock events. If you lack specific data for this token, state that clearly and analyze what is known about the token category.',
    '',
    'Output using EXACTLY these headers (no markdown bold, no extra text before each header):',
    'CURRENT_SUPPLY:',
    '[Approximate circulating supply vs max supply, and the circulating %]',
    'UNLOCK_SCHEDULE:',
    '[Known unlock events in the next 90 days: who is unlocking, approximate amount as % of circulating supply, timing, cliff vs linear. If no data available, say so.]',
    'SELL_PRESSURE_30D:',
    '[Rate as: CRITICAL (>10% circulating unlocking), HIGH (5-10%), MODERATE (2-5%), LOW (<2%), or MINIMAL. Explain why in 1-2 sentences.]',
    'SELL_PRESSURE_90D:',
    '[Same rating for 30-90 day window. Note any major cliff events.]',
    'HISTORICAL_PATTERN:',
    '[How has this token historically reacted to unlock events? Has the market absorbed unlocks well or seen sustained sell pressure?]',
    'RECOMMENDATION:',
    '[Strategic guidance: should traders be cautious about holding through the next 90 days given the unlock schedule?]',
  ].join('\n');
}

export async function POST(req: NextRequest) {
  const authToken = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!authToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: authData } = await sb(authToken).auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!GROK_KEY) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });

  const body = await req.json().catch(() => ({})) as { symbol?: string };
  const symbol = (body.symbol ?? '').toUpperCase().replace(/USDT$/i, '').trim();

  if (!symbol || symbol.length < 2 || symbol.length > 10) {
    return NextResponse.json({ error: 'Enter a valid token symbol (e.g. ARB, OP, PYTH)' }, { status: 400 });
  }

  const prompt = buildUnlockPrompt(symbol);

  const aiRes = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
    body: JSON.stringify({
      model: 'grok-4.3',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 900,
    }),
  });

  if (!aiRes.ok) {
    const err = await aiRes.json().catch(() => ({})) as { error?: string };
    return NextResponse.json({ error: err.error ?? 'AI error' }, { status: 502 });
  }

  const aiData = await aiRes.json();
  const analysis: string = aiData.choices?.[0]?.message?.content ?? '';

  return NextResponse.json({ analysis, symbol });
}
