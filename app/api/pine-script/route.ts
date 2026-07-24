import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkToolUsage, incrementToolUsage } from '@/lib/aiUsage';

const GROK_KEY = process.env.GROK_API_KEY ?? '';

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
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
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: authData } = await sb(token).auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!GROK_KEY) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });

  const { used, limit } = await checkToolUsage(token, authData.user.id, 'pineScript');
  if (used >= limit) {
    return NextResponse.json(
      { error: `Daily limit of ${limit} Pine Script generations reached.`, code: 'RATE_LIMIT' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => ({})) as {
    description?: string;
    analysisText?: string;
  };

  const description  = (body.description ?? '').trim();
  const analysisText = (body.analysisText ?? '').trim();

  if (!description) {
    return NextResponse.json({ error: 'No strategy description provided' }, { status: 400 });
  }

  const prompt = buildPinePrompt(description, analysisText);

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
    const err = await res.json().catch(() => ({})) as { error?: string };
    return NextResponse.json({ error: err.error ?? 'AI error' }, { status: 502 });
  }

  const data = await res.json();
  const code: string = data.choices?.[0]?.message?.content ?? '';

  await incrementToolUsage(token, authData.user.id, 'pineScript', used);
  return NextResponse.json({ code });
}
