import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { T } from '@/lib/tables';

export const dynamic = 'force-dynamic';

const GROK_KEY = process.env.GROK_API_KEY ?? '';

const BRIEFING_LIMIT_FREE = 3;
const BRIEFING_LIMIT_PRO  = 10;

const SYSTEM = `You are a concise pre-session market briefing assistant for a solo retail crypto futures trader.

Write exactly 3 short paragraphs:
1. Overall market conditions and sentiment right now
2. The single best setup or biggest risk to watch this session
3. One concrete action: what to do, what to avoid, what price level matters

Rules:
- Plain language, direct and opinionated
- No bullet points, no headers, no hedging
- Max 60 words per paragraph
- If nothing stands out, say so plainly`;

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

async function getUsageRow(token: string, userId: string, today: string) {
  const { data } = await sb(token).from(T.grok_usage)
    .select('briefing_count')
    .eq('user_id', userId)
    .eq('date', today)
    .maybeSingle();
  return { briefingUsed: data?.briefing_count ?? 0 };
}

async function getUserRole(token: string, userId: string): Promise<'free' | 'pro'> {
  const { data } = await sb(token).from(T.user_subscriptions)
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.role === 'pro' ? 'pro' : 'free';
}

export async function POST(req: NextRequest) {
  if (!GROK_KEY) {
    return NextResponse.json({ error: 'Grok API key not configured' }, { status: 503 });
  }

  /* ── Auth check ── */
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return NextResponse.json({ error: 'Sign in required', code: 'AUTH_REQUIRED' }, { status: 401 });
  }
  const { data: userData } = await sb(token).auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: 'Sign in required', code: 'AUTH_REQUIRED' }, { status: 401 });
  }
  const userId = userData.user.id;

  let context: string;
  try {
    ({ context } = await req.json() as { context: string });
    if (!context?.trim()) throw new Error('empty');
  } catch {
    return NextResponse.json({ error: 'context required' }, { status: 400 });
  }

  /* ── Rate limit check ── */
  const today = new Date().toISOString().slice(0, 10);
  const [{ briefingUsed }, role] = await Promise.all([
    getUsageRow(token, userId, today),
    getUserRole(token, userId),
  ]);
  const briefingLimit = role === 'pro' ? BRIEFING_LIMIT_PRO : BRIEFING_LIMIT_FREE;

  if (briefingUsed >= briefingLimit) {
    return NextResponse.json(
      {
        error: `Daily limit of ${briefingLimit} briefings reached.`,
        code: 'RATE_LIMIT',
        usage: { briefing_used: briefingUsed, briefing_limit: briefingLimit },
      },
      { status: 429 }
    );
  }

  try {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROK_KEY}`,
      },
      body: JSON.stringify({
        model: 'grok-4.3',
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user',   content: context },
        ],
        max_tokens: 350,
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      return NextResponse.json({ error: txt }, { status: res.status });
    }

    const data = await res.json();
    const briefing = (data.choices?.[0]?.message?.content ?? '').trim();

    /* ── Increment briefing_count ── */
    const newBriefing = briefingUsed + 1;
    const { error: upsertErr } = await sb(token).from(T.grok_usage).upsert(
      { user_id: userId, date: today, briefing_count: newBriefing, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,date' }
    );
    if (upsertErr) console.error('[briefing] usage upsert failed:', upsertErr.message);

    return NextResponse.json({
      briefing,
      _usage: { briefing_used: newBriefing, briefing_limit: briefingLimit },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
