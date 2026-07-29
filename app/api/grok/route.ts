import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseCombinedResponse } from '@/lib/grok';
import { T } from '@/lib/tables';
import { getUsageTier } from '@/lib/entitlements';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { AI_LIMITS, type UsageTier } from '@/lib/limits';
import { incrementUsageColumn, rateLimitMessage, todayUtc } from '@/lib/aiUsage';
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
    .select('deep_count, quick_count, chat_count, chat_search_count, briefing_count, tool_pool_count')
    .eq('user_id', userId)
    .eq('date', today)
    .maybeSingle();
  return {
    deepUsed:     data?.deep_count        ?? 0,
    quickUsed:    data?.quick_count       ?? 0,
    chatUsed:     data?.chat_count        ?? 0,
    searchUsed:   data?.chat_search_count ?? 0,
    briefingUsed: data?.briefing_count    ?? 0,
    toolPoolUsed: data?.tool_pool_count   ?? 0,
  };
}

// The shared one-shot-tool budget (lib/limits.ts AI_LIMITS[role].toolPool) is
// Pro-only - free stays on per-tool caps, so there is no single number to show
// a free user. 0 means "no pool", and UsageRings skips the ring entirely
// rather than rendering a meaningless 0/0.
function toolPoolLimitFor(role: UsageTier): number {
  return AI_LIMITS[role].toolPool ?? 0;
}

// ── GET - return today's usage without running an analysis ──────────────────
export async function GET(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') || undefined;
  if (!token) return NextResponse.json({ usage: null });

  const { data } = await sb(token).auth.getUser();
  const userId = data.user?.id ?? null;
  if (!userId) return NextResponse.json({ usage: null });

  const today = todayUtc();
  const [{ deepUsed, quickUsed, chatUsed, searchUsed, briefingUsed, toolPoolUsed }, role] = await Promise.all([
    getUsageRow(token, userId, today),
    getUsageTier(token, userId),
  ]);
  const deepLimit     = AI_LIMITS[role].deep;
  const quickLimit    = AI_LIMITS[role].quick;
  const chatLimit     = AI_LIMITS[role].chat;
  const searchLimit   = AI_LIMITS[role].search;
  const briefingLimit = AI_LIMITS[role].briefing;

  return NextResponse.json({
    usage: {
      deep_used:      deepUsed,     deep_limit:      deepLimit,
      quick_used:     quickUsed,    quick_limit:     quickLimit,
      chat_used:      chatUsed,     chat_limit:      chatLimit,
      search_used:    searchUsed,   search_limit:    searchLimit,
      briefing_used:  briefingUsed, briefing_limit:  briefingLimit,
      tool_pool_used: toolPoolUsed, tool_pool_limit: toolPoolLimitFor(role),
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

  // The prompt is assembled in the browser (lib/grok.ts) and sent whole, so its
  // length is caller-controlled. The daily cap counts CALLS, not tokens, so
  // without a bound here one allowed call can cost an arbitrary amount at xAI.
  // The real assembled prompt runs well under this; anything larger is not the
  // app talking.
  if (typeof prompt !== 'string' || prompt.length > 64_000) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

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
  const today = todayUtc();
  let [{ deepUsed, quickUsed, chatUsed, searchUsed, briefingUsed, toolPoolUsed }, role] = await Promise.all([
    getUsageRow(token!, userId, today),
    getUsageTier(token!, userId),
  ]);
  const deepLimit     = AI_LIMITS[role].deep;
  const quickLimit    = AI_LIMITS[role].quick;
  const chatLimit     = AI_LIMITS[role].chat;
  const searchLimit   = AI_LIMITS[role].search;
  const briefingLimit = AI_LIMITS[role].briefing;

  const allUsage = () => ({
    deep_used:      deepUsed,     deep_limit:      deepLimit,
    quick_used:     quickUsed,    quick_limit:     quickLimit,
    chat_used:      chatUsed,     chat_limit:      chatLimit,
    search_used:    searchUsed,   search_limit:    searchLimit,
    briefing_used:  briefingUsed, briefing_limit:  briefingLimit,
    tool_pool_used: toolPoolUsed, tool_pool_limit: toolPoolLimitFor(role),
  });

  // Atomic check-and-increment (reserve before spending on xAI) - closes the
  // TOCTOU race the old read-then-upsert pattern had between concurrent requests.
  const column = type === 'deep' ? 'deep_count' : 'quick_count';
  const limit  = type === 'deep' ? deepLimit : quickLimit;
  const usageResult = await incrementUsageColumn(userId, column, limit);
  if (usageResult.blocked) {
    const label = type === 'deep' ? 'deep analyses' : 'quick analyses';
    return NextResponse.json(
      { error: rateLimitMessage(usageResult.reason, limit, label), code: 'RATE_LIMIT', usage: allUsage() },
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
          // Deep is the expensive path (frontier model + web and X search) and
          // was the only xAI call in the app with no output bound at all.
          max_output_tokens: 2000,
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

  const newDeep  = type === 'deep'  ? usageResult.count : deepUsed;
  const newQuick = type === 'quick' ? usageResult.count : quickUsed;

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
