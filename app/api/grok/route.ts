import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseCombinedResponse } from '@/lib/grok';
import { T } from '@/lib/tables';

// Keys / limits
const GROK_KEY         = process.env.GROK_API_KEY ?? '';
const DEEP_LIMIT_FREE  = 5;
const QUICK_LIMIT_FREE = 7;
const DEEP_LIMIT_PRO   = 25;
const QUICK_LIMIT_PRO  = 50;

function sb(token?: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : undefined
  );
}

async function getUsageRow(token: string, userId: string, today: string) {
  const { data } = await sb(token).from(T.grok_usage)
    .select('deep_count, quick_count')
    .eq('user_id', userId)
    .eq('date', today)
    .maybeSingle();
  return { deepUsed: data?.deep_count ?? 0, quickUsed: data?.quick_count ?? 0 };
}

async function getUserRole(token: string, userId: string): Promise<'free' | 'pro'> {
  const { data } = await sb(token).from(T.user_subscriptions)
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.role === 'pro' ? 'pro' : 'free';
}

// ── GET — return today's usage without running an analysis ──────────────────
export async function GET(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') || undefined;
  if (!token) return NextResponse.json({ usage: null });

  const { data } = await sb(token).auth.getUser();
  const userId = data.user?.id ?? null;
  if (!userId) return NextResponse.json({ usage: null });

  const today = new Date().toISOString().slice(0, 10);
  const [{ deepUsed, quickUsed }, role] = await Promise.all([
    getUsageRow(token, userId, today),
    getUserRole(token, userId),
  ]);
  const deepLimit  = role === 'pro' ? DEEP_LIMIT_PRO  : DEEP_LIMIT_FREE;
  const quickLimit = role === 'pro' ? QUICK_LIMIT_PRO : QUICK_LIMIT_FREE;

  return NextResponse.json({
    usage: { deep_used: deepUsed, deep_limit: deepLimit, quick_used: quickUsed, quick_limit: quickLimit },
  });
}

// ── POST — run an analysis ──────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { prompt, tf, session, type } = await req.json() as {
    prompt: string; tf: string; session: string; type: 'quick' | 'deep';
  };

  const token = req.headers.get('Authorization')?.replace('Bearer ', '') || undefined;

  // Auth required for both Quick and Deep — prevents unauthenticated API burn
  let userId: string | null = null;
  if (token) {
    const { data } = await sb(token).auth.getUser();
    userId = data.user?.id ?? null;
  }

  if (!userId) {
    return NextResponse.json(
      { error: 'Sign in required to use AI Arena', code: 'AUTH_REQUIRED' },
      { status: 401 }
    );
  }

  // ── Rate limit check ──────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  let [{ deepUsed, quickUsed }, role] = await Promise.all([
    getUsageRow(token!, userId, today),
    getUserRole(token!, userId),
  ]);
  const deepLimit  = role === 'pro' ? DEEP_LIMIT_PRO  : DEEP_LIMIT_FREE;
  const quickLimit = role === 'pro' ? QUICK_LIMIT_PRO : QUICK_LIMIT_FREE;

  if (type === 'deep' && deepUsed >= deepLimit) {
    return NextResponse.json(
      {
        error: `Daily limit of ${deepLimit} deep analyses reached. Resets at midnight UTC.`,
        code: 'RATE_LIMIT',
        usage: { deep_used: deepUsed, deep_limit: deepLimit, quick_used: quickUsed, quick_limit: quickLimit },
      },
      { status: 429 }
    );
  }
  if (type === 'quick' && quickUsed >= quickLimit) {
    return NextResponse.json(
      {
        error: `Daily limit of ${quickLimit} quick analyses reached. Resets at midnight UTC.`,
        code: 'RATE_LIMIT',
        usage: { deep_used: deepUsed, deep_limit: deepLimit, quick_used: quickUsed, quick_limit: quickLimit },
      },
      { status: 429 }
    );
  }

  // ── Call xAI ──────────────────────────────────────────────────────────────
  let text: string;
  try {
    if (type === 'deep') {
      // Responses API with live web + X search
      const r = await fetch('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
        body: JSON.stringify({
          model: 'grok-4.3',
          input: [{ role: 'user', content: prompt }],
          tools: [{ type: 'web_search' }, { type: 'x_search' }],
        }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(`xAI ${r.status}: ${e.error ?? r.statusText}`);
      }
      const d = await r.json();
      const msg = d.output?.find((o: { type: string }) => o.type === 'message');
      text = msg?.content?.[0]?.text ?? '';
    } else {
      // chat/completions — no search tools, cheaper
      const r = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
        body: JSON.stringify({
          model: 'grok-4.3',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 800,
        }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(`xAI ${r.status}: ${e.error ?? r.statusText}`);
      }
      const d = await r.json();
      text = d.choices?.[0]?.message?.content ?? '';
    }
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'xAI error' },
      { status: 500 }
    );
  }

  const result = parseCombinedResponse(text, tf, session);

  // ── Update usage ──────────────────────────────────────────────────────────
  const newDeep  = type === 'deep'  ? deepUsed  + 1 : deepUsed;
  const newQuick = type === 'quick' ? quickUsed + 1 : quickUsed;
  await sb(token!).from(T.grok_usage).upsert(
    { user_id: userId, date: today, deep_count: newDeep, quick_count: newQuick, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,date' }
  );

  return NextResponse.json({
    result,
    usage: { deep_used: newDeep, deep_limit: deepLimit, quick_used: newQuick, quick_limit: quickLimit },
  });
}
