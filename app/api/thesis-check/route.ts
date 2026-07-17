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

function buildThesisPrompt(
  symbol: string,
  direction: string,
  entryDate: string,
  thesisText: string,
  assumptions: string[],
): string {
  const today = new Date().toISOString().slice(0, 10);
  const assumptionList = assumptions
    .map((a, i) => `Assumption ${i + 1}: ${a}`)
    .join('\n');

  return [
    `You are a crypto trading analyst and thesis validator. A trader has an open ${direction} position on ${symbol} entered on ${entryDate}. Today is ${today}.`,
    '',
    'TRADE THESIS:',
    thesisText,
    '',
    'MEASURABLE ASSUMPTIONS:',
    assumptionList,
    '',
    '=== THESIS HEALTH CHECK ===',
    '',
    'Using your current knowledge of crypto markets and the specific coin, evaluate each assumption and the overall thesis.',
    '',
    'Output using EXACTLY these headers (no markdown bold, no extra text):',
    'ASSUMPTION_CHECK:',
    '[For each assumption: state "HOLDS", "WEAKENED", or "INVALIDATED" followed by a colon and one sentence explaining the current status. One assumption per line.]',
    'THESIS_HEALTH:',
    '[Overall 1-10 score. Format: "Score: X/10 - [one sentence justification]". 8-10 = thesis intact, 5-7 = concerns emerging, 1-4 = thesis breaking down]',
    'KEY_RISK:',
    '[The single biggest threat to this thesis right now in one sentence]',
    'RECOMMENDATION:',
    '[Should the trader hold, reduce exposure, or exit? One specific actionable sentence based on thesis health]',
  ].join('\n');
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: authData } = await sb(token).auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!GROK_KEY) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });

  const body = await req.json().catch(() => ({})) as {
    symbol?: string; direction?: string; entryDate?: string;
    thesisText?: string; assumptions?: string[];
  };

  const { symbol, direction, entryDate, thesisText, assumptions } = body;

  if (!symbol || !direction || !thesisText || !assumptions?.length) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const prompt = buildThesisPrompt(
    symbol.toUpperCase(),
    direction,
    entryDate ?? new Date().toISOString().slice(0, 10),
    thesisText,
    assumptions.filter(Boolean),
  );

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
    body: JSON.stringify({
      model: 'grok-4.3',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 700,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    return NextResponse.json({ error: err.error ?? 'AI error' }, { status: 502 });
  }

  const data = await res.json();
  const analysis: string = data.choices?.[0]?.message?.content ?? '';

  return NextResponse.json({ analysis });
}
