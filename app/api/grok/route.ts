import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseCombinedResponse } from '@/lib/grok';
import { T } from '@/lib/tables';
import { getUserRole } from '@/lib/entitlements';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { AI_LIMITS } from '@/lib/limits';
import { incrementUsageColumn } from '@/lib/aiUsage';
import { apiError } from '@/lib/apiError';

// Keys / limits (limits: single source of truth in lib/limits.ts)
const GROK_KEY = process.env.GROK_API_KEY ?? '';

function sb(token?: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : undefined
  );
}

async function getUsageRow(token: string, userId: string, today: string) {
  const { data } = await sb(token).from(T.grok_usage)
    .select('deep_count, quick_count, chat_count, chat_search_count, briefing_count')
    .eq('user_id', userId)
    .eq('date', today)
    .maybeSingle();
  return {
    deepUsed:     data?.deep_count        ?? 0,
    quickUsed:    data?.quick_count       ?? 0,
    chatUsed:     data?.chat_count        ?? 0,
    searchUsed:   data?.chat_search_count ?? 0,
    briefingUsed: data?.briefing_count    ?? 0,
  };
}

// ── GET - return today's usage without running an analysis ──────────────────
export async function GET(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') || undefined;
  if (!token) return NextResponse.json({ usage: null });

  const { data } = await sb(token).auth.getUser();
  const userId = data.user?.id ?? null;
  if (!userId) return NextResponse.json({ usage: null });

  const today = new Date().toISOString().slice(0, 10);
  const [{ deepUsed, quickUsed, chatUsed, searchUsed, briefingUsed }, role] = await Promise.all([
    getUsageRow(token, userId, today),
    getUserRole(token, userId),
  ]);
  const deepLimit     = AI_LIMITS[role].deep;
  const quickLimit    = AI_LIMITS[role].quick;
  const chatLimit     = AI_LIMITS[role].chat;
  const searchLimit   = AI_LIMITS[role].search;
  const briefingLimit = AI_LIMITS[role].briefing;

  return NextResponse.json({
    usage: {
      deep_used:     deepUsed,     deep_limit:     deepLimit,
      quick_used:    quickUsed,    quick_limit:    quickLimit,
      chat_used:     chatUsed,     chat_limit:     chatLimit,
      search_used:   searchUsed,   search_limit:   searchLimit,
      briefing_used: briefingUsed, briefing_limit: briefingLimit,
    },
  });
}

// ── POST - run an analysis ──────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!(await isFeatureEnabled('grok'))) {
    return NextResponse.json({ error: 'AI Arena is temporarily unavailable.', code: 'FEATURE_DISABLED' }, { status: 503 });
  }

  const { prompt, tf, session, type } = await req.json() as {
    prompt: string; tf: string; session: string; type: 'quick' | 'deep';
  };

  const token = req.headers.get('Authorization')?.replace('Bearer ', '') || undefined;

  // Auth required for both Quick and Deep - prevents unauthenticated API burn
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
  let [{ deepUsed, quickUsed, chatUsed, searchUsed, briefingUsed }, role] = await Promise.all([
    getUsageRow(token!, userId, today),
    getUserRole(token!, userId),
  ]);
  const deepLimit     = AI_LIMITS[role].deep;
  const quickLimit    = AI_LIMITS[role].quick;
  const chatLimit     = AI_LIMITS[role].chat;
  const searchLimit   = AI_LIMITS[role].search;
  const briefingLimit = AI_LIMITS[role].briefing;

  const allUsage = () => ({
    deep_used:     deepUsed,     deep_limit:     deepLimit,
    quick_used:    quickUsed,    quick_limit:    quickLimit,
    chat_used:     chatUsed,     chat_limit:     chatLimit,
    search_used:   searchUsed,   search_limit:   searchLimit,
    briefing_used: briefingUsed, briefing_limit: briefingLimit,
  });

  // Atomic check-and-increment (reserve before spending on xAI) - closes the
  // TOCTOU race the old read-then-upsert pattern had between concurrent requests.
  const column = type === 'deep' ? 'deep_count' : 'quick_count';
  const limit  = type === 'deep' ? deepLimit : quickLimit;
  const newCount = await incrementUsageColumn(token!, userId, column, limit);
  if (newCount === null) {
    const label = type === 'deep' ? 'deep analyses' : 'quick analyses';
    return NextResponse.json(
      { error: `Daily limit of ${limit} ${label} reached.`, code: 'RATE_LIMIT', usage: allUsage() },
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
      // chat/completions - no search tools, cheaper
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
    return apiError('grok', e, 500, 'AI service error');
  }

  const result = parseCombinedResponse(text, tf, session);

  const newDeep  = type === 'deep'  ? newCount : deepUsed;
  const newQuick = type === 'quick' ? newCount : quickUsed;

  return NextResponse.json({
    result,
    usage: {
      deep_used:     newDeep,      deep_limit:     deepLimit,
      quick_used:    newQuick,     quick_limit:    quickLimit,
      chat_used:     chatUsed,     chat_limit:     chatLimit,
      search_used:   searchUsed,   search_limit:   searchLimit,
      briefing_used: briefingUsed, briefing_limit: briefingLimit,
    },
  });
}
