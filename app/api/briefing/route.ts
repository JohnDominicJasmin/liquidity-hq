import { NextRequest, NextResponse } from 'next/server';
import { xaiFetch } from '@/lib/xai';
import { createClient } from '@supabase/supabase-js';
import { T } from '@/lib/tables';
import { getUsageTier } from '@/lib/entitlements';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { AI_LIMITS } from '@/lib/limits';
import { incrementUsageColumn, rateLimitMessage, todayUtc } from '@/lib/aiUsage';
import { apiError } from '@/lib/apiError';

export const dynamic = 'force-dynamic';

const GROK_KEY = process.env.GROK_API_KEY ?? '';

/* Structured since #620. The canvas (Briefing.dc.html) draws a 32px headline,
   a meta row and three head+body sections - none of which the previous prompt
   could produce, because it said "no headers" outright. Rather than synthesise
   a headline from paragraph one on the client (an editorial claim about the
   market, invented rather than read), the model is now asked for the structure
   the screen actually renders.

   The three sections keep the old prompt's three subjects in the same order,
   so the briefing's content and voice are unchanged - only its shape is. */
const SYSTEM = `You are a concise pre-session market briefing assistant for a solo retail crypto futures trader.

Reply with ONLY a JSON object, no markdown fence, in exactly this shape:

{
  "headline": "...",
  "meta": [
    { "label": "...", "value": "..." },
    { "label": "...", "value": "..." },
    { "label": "...", "value": "..." },
    { "label": "...", "value": "..." }
  ],
  "sections": [
    { "head": "...", "body": "..." },
    { "head": "...", "body": "..." },
    { "head": "...", "body": "..." }
  ]
}

headline: the single most important thing about this session, as a statement.
  Max 9 words. No trailing period. This is the reader's one-line takeaway - it
  must be supported by the data you were given, never a generic market phrase.

meta: exactly 4 label/value pairs framing the session - a regime, a dominant
  flow, a level in play, an event risk, or similar. label is 1-2 words naming
  the thing; value is 1-4 words stating it. No sentences in either.

sections: exactly 3, in this order and covering these subjects:
  1. Overall market conditions and sentiment right now
  2. The single best setup or biggest risk to watch this session
  3. One concrete action: what to do, what to avoid, what price level matters
  head: 1-3 words labelling that section. body: max 60 words.

Rules:
- Plain language, direct and opinionated, no hedging
- If nothing stands out, say so plainly - in the headline too
- Every claim comes from the data provided; do not invent levels or events`;

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

export async function POST(req: NextRequest) {
  if (!GROK_KEY) {
    return NextResponse.json({ error: 'Grok API key not configured' }, { status: 503 });
  }
  if (!(await isFeatureEnabled('grok'))) {
    return NextResponse.json({ error: 'Briefing is temporarily unavailable.', code: 'FEATURE_DISABLED' }, { status: 503 });
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
  const today = todayUtc();
  const [{ briefingUsed }, role] = await Promise.all([
    getUsageRow(token, userId, today),
    getUsageTier(token, userId),
  ]);
  const briefingLimit = AI_LIMITS[role].briefing;

  // Atomic check-and-increment (reserve before spending on xAI) - closes the
  // TOCTOU race the old read-then-upsert pattern had between concurrent requests.
  const usageResult = await incrementUsageColumn(userId, 'briefing_count', briefingLimit);
  if (usageResult.blocked) {
    return NextResponse.json(
      {
        error: rateLimitMessage(usageResult.reason, briefingLimit, 'briefings'),
        code: 'RATE_LIMIT',
        usage: { briefing_used: briefingUsed, briefing_limit: briefingLimit },
      },
      { status: 429 }
    );
  }

  try {
    const res = await xaiFetch('https://api.x.ai/v1/chat/completions', {
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
      return apiError('briefing', txt, res.status, 'AI service error');
    }

    const data = await res.json();
    const raw = (data.choices?.[0]?.message?.content ?? '').trim();

    /* The model is asked for bare JSON, but a fenced block is the common
       failure and cheap to survive. Anything past that is NOT repaired: a
       malformed briefing returns its own text with no structure rather than
       a half-parsed one, because the alternative is presenting invented or
       mismatched heads as if the model had written them. `briefing` is kept
       as the raw string either way so an unparseable reply is still readable
       and so nothing that consumed the old contract breaks silently. */
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonText = (fenced ? fenced[1] : raw).trim();

    let structured: {
      headline?: string;
      meta?: { label: string; value: string }[];
      sections?: { head: string; body: string }[];
    } | null = null;

    try {
      const parsed = JSON.parse(jsonText);
      if (
        parsed && typeof parsed.headline === 'string' &&
        Array.isArray(parsed.sections) &&
        parsed.sections.every((s: unknown) =>
          !!s && typeof (s as { head?: unknown }).head === 'string'
             && typeof (s as { body?: unknown }).body === 'string')
      ) {
        structured = {
          headline: parsed.headline.trim(),
          meta: Array.isArray(parsed.meta)
            ? parsed.meta.filter(
                (m: unknown): m is { label: string; value: string } =>
                  !!m && typeof m === 'object' &&
                  typeof (m as { label?: unknown }).label === 'string' &&
                  typeof (m as { value?: unknown }).value === 'string',
              )
            : [],
          sections: parsed.sections.map((s: { head: string; body: string }) => ({
            head: s.head.trim(), body: s.body.trim(),
          })),
        };
      }
    } catch { /* leave structured null - handled by the consumer */ }

    return NextResponse.json({
      briefing: raw,
      headline: structured?.headline ?? null,
      meta:     structured?.meta ?? [],
      sections: structured?.sections ?? [],
      _usage: { briefing_used: usageResult.count, briefing_limit: briefingLimit },
    });
  } catch (e) {
    return apiError('briefing', e, 500, 'Request failed');
  }
}
