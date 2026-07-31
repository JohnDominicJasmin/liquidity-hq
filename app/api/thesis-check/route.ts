import { NextRequest, NextResponse } from 'next/server';
import { xaiFetch } from '@/lib/xai';
import { createClient } from '@supabase/supabase-js';
import { incrementToolUsage, rateLimitMessage } from '@/lib/aiUsage';
import { getUsageTier, hasProFeatures } from '@/lib/entitlements';
import { apiError } from '@/lib/apiError';

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

  // Pro-only. /upgrade sells the one-shot AI tools as a Pro feature
  // (UPGRADE_PRO_FEATURE_TOOL_POOL); this route is one of them. Without this
  // check a free account could still spend real xAI budget here, which is
  // what the pricing page says it cannot. Trial users pass - hasProFeatures
  // covers isTrial.
  if (!(await hasProFeatures(token, authData.user.id))) {
    return NextResponse.json({ error: 'PRO_REQUIRED', message: 'Thesis Check is a Pro feature.' }, { status: 403 });
  }

  if (!GROK_KEY) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });

  const role = await getUsageTier(token, authData.user.id);
  const usageResult = await incrementToolUsage(authData.user.id, 'thesisCheck', role);
  if (usageResult.blocked) {
    return NextResponse.json(
      { error: rateLimitMessage(usageResult.reason, usageResult.limit, 'thesis checks'), code: 'RATE_LIMIT' },
      { status: 429 },
    );
  }

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

  const res = await xaiFetch('https://api.x.ai/v1/chat/completions', {
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
    return apiError('thesis-check', err.error ?? 'upstream AI error', 502, 'AI service error');
  }

  const data = await res.json();
  const analysis: string = data.choices?.[0]?.message?.content ?? '';

  return NextResponse.json({ analysis });
}
