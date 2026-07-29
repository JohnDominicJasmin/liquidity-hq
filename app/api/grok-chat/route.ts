/**
 * Server-side proxy for the free-form Grok Chat component.
 * Requires valid Supabase session token - keeps GROK_API_KEY off the client.
 *
 * POST /api/grok-chat
 *   { mode: 'chat',   model, messages, max_tokens }  → /v1/chat/completions
 *   { mode: 'search', model, input, tools }           → /v1/responses  (live web + X search)
 *
 * Daily limits live in lib/limits.ts (AI_LIMITS[role].chat / .search) - the
 * enforced source of truth. Deliberately not restated here: this docblock
 * used to hardcode them and silently went stale across two separate
 * repricings before anyone noticed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { T } from '@/lib/tables';
import { getUsageTier } from '@/lib/entitlements';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { AI_LIMITS } from '@/lib/limits';
import { incrementUsageColumn, rateLimitMessage, todayUtc } from '@/lib/aiUsage';
import { apiError } from '@/lib/apiError';

const GROK_KEY = process.env.GROK_API_KEY ?? '';

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

async function getUsageRow(token: string, userId: string, today: string) {
  const { data } = await sb(token).from(T.grok_usage)
    .select('chat_count, chat_search_count')
    .eq('user_id', userId)
    .eq('date', today)
    .maybeSingle();
  return { chatUsed: data?.chat_count ?? 0, searchUsed: data?.chat_search_count ?? 0 };
}

export async function GET(req: NextRequest) {
  if (!GROK_KEY) return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  if (!(await isFeatureEnabled('grok'))) return NextResponse.json({ error: 'LiquidityAI is temporarily unavailable.', code: 'FEATURE_DISABLED' }, { status: 503 });
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Auth required' }, { status: 401 });
  const { data: userData } = await sb(token).auth.getUser();
  if (!userData.user) return NextResponse.json({ error: 'Auth required' }, { status: 401 });
  const userId = userData.user.id;
  const today = todayUtc();
  const [{ chatUsed, searchUsed }, role] = await Promise.all([
    getUsageRow(token, userId, today),
    getUsageTier(token, userId),
  ]);
  const chatLimit   = AI_LIMITS[role].chat;
  const searchLimit = AI_LIMITS[role].search;
  return NextResponse.json({ chat_used: chatUsed, chat_limit: chatLimit, search_used: searchUsed, search_limit: searchLimit });
}

export async function POST(req: NextRequest) {
  if (!GROK_KEY) {
    return NextResponse.json({ error: 'Grok API not configured' }, { status: 503 });
  }
  if (!(await isFeatureEnabled('grok'))) {
    return NextResponse.json({ error: 'LiquidityAI is temporarily unavailable.', code: 'FEATURE_DISABLED' }, { status: 503 });
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

  /* ── Parse body ── */
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { mode, ...payload } = body;
  const isSearch = mode === 'search';

  /* ── Rate limit check ── */
  const today = todayUtc();
  const [{ chatUsed, searchUsed }, role] = await Promise.all([
    getUsageRow(token, userId, today),
    getUsageTier(token, userId),
  ]);

  const chatLimit   = AI_LIMITS[role].chat;
  const searchLimit = AI_LIMITS[role].search;

  // Atomic check-and-increment (reserve before spending on xAI) - closes the
  // TOCTOU race the old read-then-upsert pattern had between concurrent requests.
  const column = isSearch ? 'chat_search_count' : 'chat_count';
  const limit  = isSearch ? searchLimit : chatLimit;
  const usageResult = await incrementUsageColumn(userId, column, limit);
  if (usageResult.blocked) {
    const label = isSearch ? 'live search messages' : 'chat messages';
    return NextResponse.json(
      {
        error: rateLimitMessage(usageResult.reason, limit, label),
        code: 'RATE_LIMIT',
        usage: { chat_used: chatUsed, chat_limit: chatLimit, search_used: searchUsed, search_limit: searchLimit },
      },
      { status: 429 }
    );
  }

  /* ── Call xAI ── */
  try {
    let data: unknown;
    let status: number;

    if (isSearch) {
      const r = await fetch('https://api.x.ai/v1/responses', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
        body:    JSON.stringify(payload),
      });
      data   = await r.json();
      status = r.status;
    } else if (mode === 'chat') {
      const r = await fetch('https://api.x.ai/v1/chat/completions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
        body:    JSON.stringify(payload),
      });
      data   = await r.json();
      status = r.status;
    } else {
      return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 });
    }

    if (status >= 200 && status < 300) {
      const newChat   = isSearch ? chatUsed   : usageResult.count;
      const newSearch = isSearch ? usageResult.count : searchUsed;
      return NextResponse.json({
        ...((data as Record<string, unknown>) ?? {}),
        _usage: { chat_used: newChat, chat_limit: chatLimit, search_used: newSearch, search_limit: searchLimit },
      }, { status });
    }

    return NextResponse.json(data, { status });
  } catch (e) {
    return apiError('grok-chat', e, 500, 'AI service error');
  }
}
