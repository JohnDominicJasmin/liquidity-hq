/**
 * Server-side proxy for the free-form Grok Chat component.
 * Requires valid Supabase session token — keeps GROK_API_KEY off the client.
 *
 * POST /api/grok-chat
 *   { mode: 'chat',   model, messages, max_tokens }  → /v1/chat/completions
 *   { mode: 'search', model, input, tools }           → /v1/responses  (live web + X search)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const GROK_KEY = process.env.GROK_API_KEY ?? '';

function sbClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

export async function POST(req: NextRequest) {
  if (!GROK_KEY) {
    return NextResponse.json({ error: 'Grok API not configured' }, { status: 503 });
  }

  /* ── Auth check: require valid Supabase session ── */
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return NextResponse.json({ error: 'Sign in required', code: 'AUTH_REQUIRED' }, { status: 401 });
  }
  const { data: userData } = await sbClient(token).auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: 'Sign in required', code: 'AUTH_REQUIRED' }, { status: 401 });
  }

  /* ── Parse body ── */
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { mode, ...payload } = body;

  try {
    /* ── Live search: /v1/responses with web_search + x_search ── */
    if (mode === 'search') {
      const r = await fetch('https://api.x.ai/v1/responses', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
        body:    JSON.stringify(payload),
      });
      const data = await r.json();
      return NextResponse.json(data, { status: r.status });
    }

    /* ── Fast chat: /v1/chat/completions ── */
    if (mode === 'chat') {
      const r = await fetch('https://api.x.ai/v1/chat/completions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
        body:    JSON.stringify(payload),
      });
      const data = await r.json();
      return NextResponse.json(data, { status: r.status });
    }

    return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Grok proxy error' },
      { status: 500 }
    );
  }
}
