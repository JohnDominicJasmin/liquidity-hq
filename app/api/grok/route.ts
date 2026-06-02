import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseCombinedResponse } from '@/lib/grok';

// Key stays server-side — never exposed to the browser
const GROK_KEY = process.env.GROK_API_KEY ?? '';
const DEEP_LIMIT = 20; // per user per calendar day (UTC)

function sb(token?: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : undefined
  );
}

export async function POST(req: NextRequest) {
  const { prompt, tf, session, type } = await req.json() as {
    prompt: string; tf: string; session: string; type: 'quick' | 'deep';
  };

  const token = req.headers.get('Authorization')?.replace('Bearer ', '') || undefined;

  // ── Auth check ────────────────────────────────────────────────────────────
  let userId: string | null = null;
  if (token) {
    const { data } = await sb(token).auth.getUser();
    userId = data.user?.id ?? null;
  }

  // Deep analysis requires sign-in
  if (type === 'deep' && !userId) {
    return NextResponse.json(
      { error: 'Sign in required for Deep Analysis', code: 'AUTH_REQUIRED' },
      { status: 401 }
    );
  }

  // ── Rate limit check ──────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  let deepUsed  = 0;
  let quickUsed = 0;

  if (userId) {
    const { data: row } = await sb(token).from('grok_usage')
      .select('deep_count, quick_count')
      .eq('user_id', userId)
      .eq('date', today)
      .maybeSingle();
    deepUsed  = row?.deep_count  ?? 0;
    quickUsed = row?.quick_count ?? 0;

    if (type === 'deep' && deepUsed >= DEEP_LIMIT) {
      return NextResponse.json(
        {
          error: `Daily limit of ${DEEP_LIMIT} deep analyses reached. Resets at midnight UTC.`,
          code: 'RATE_LIMIT',
          usage: { deep_used: deepUsed, deep_limit: DEEP_LIMIT, quick_used: quickUsed },
        },
        { status: 429 }
      );
    }
  }

  // ── Call xAI ──────────────────────────────────────────────────────────────
  let text: string;
  try {
    if (type === 'deep') {
      // grok-4.3 Responses API with live web + X search
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
      // chat/completions — no search tools, much cheaper
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
  if (userId) {
    const newDeep  = type === 'deep'  ? deepUsed + 1  : deepUsed;
    const newQuick = type === 'quick' ? quickUsed + 1 : quickUsed;
    await sb(token).from('grok_usage').upsert(
      { user_id: userId, date: today, deep_count: newDeep, quick_count: newQuick, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,date' }
    );
    if (type === 'deep')  deepUsed  = newDeep;
    if (type === 'quick') quickUsed = newQuick;
  }

  return NextResponse.json({
    result,
    usage: userId
      ? { deep_used: deepUsed, deep_limit: DEEP_LIMIT, quick_used: quickUsed }
      : null,
  });
}
