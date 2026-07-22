/**
 * Server-side proxy for the free-form Grok Chat component.
 * Requires valid Supabase session token - keeps GROK_API_KEY off the client.
 *
 * POST /api/grok-chat
 *   { mode: 'chat',   model, messages, max_tokens }  → /v1/chat/completions
 *   { mode: 'search', model, input, tools }           → /v1/responses  (live web + X search)
 *
 * Daily limits (resets midnight UTC):
 *   Free - 15 chat  + 5  search
 *   Pro  - 100 chat + 25 search
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { T } from '@/lib/tables';
import { getUserRole } from '@/lib/entitlements';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { AI_LIMITS } from '@/lib/limits';

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
  const today = new Date().toISOString().slice(0, 10);
  const [{ chatUsed, searchUsed }, role] = await Promise.all([
    getUsageRow(token, userId, today),
    getUserRole(token, userId),
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
  const today = new Date().toISOString().slice(0, 10);
  const [{ chatUsed, searchUsed }, role] = await Promise.all([
    getUsageRow(token, userId, today),
    getUserRole(token, userId),
  ]);

  const chatLimit   = AI_LIMITS[role].chat;
  const searchLimit = AI_LIMITS[role].search;

  if (isSearch && searchUsed >= searchLimit) {
    return NextResponse.json(
      {
        error: `Daily limit of ${searchLimit} live search messages reached.`,
        code: 'RATE_LIMIT',
        usage: { chat_used: chatUsed, chat_limit: chatLimit, search_used: searchUsed, search_limit: searchLimit },
      },
      { status: 429 }
    );
  }
  if (!isSearch && chatUsed >= chatLimit) {
    return NextResponse.json(
      {
        error: `Daily limit of ${chatLimit} chat messages reached.`,
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

    /* ── Update usage (only on success) ── */
    if (status >= 200 && status < 300) {
      const newChat   = isSearch ? chatUsed   : chatUsed   + 1;
      const newSearch = isSearch ? searchUsed + 1 : searchUsed;
      const { error: upsertErr } = await sb(token).from(T.grok_usage).upsert(
        {
          user_id: userId, date: today,
          chat_count: newChat, chat_search_count: newSearch,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,date' }
      );
      if (upsertErr) console.error('[grok-chat] usage upsert failed:', upsertErr.message);
      return NextResponse.json({
        ...((data as Record<string, unknown>) ?? {}),
        _usage: { chat_used: newChat, chat_limit: chatLimit, search_used: newSearch, search_limit: searchLimit },
      }, { status });
    }

    return NextResponse.json(data, { status });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Grok proxy error' },
      { status: 500 }
    );
  }
}
