import { NextRequest, NextResponse } from 'next/server';
import { xaiFetch } from '@/lib/xai';
import { recordAiCall } from '@/lib/aiCallLog';
import { T } from '@/lib/tables';
import { getUsageTierStatus } from '@/lib/entitlements';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { AI_LIMITS, type UsageTier } from '@/lib/limits';
import { incrementUsageColumn, rateLimitMessage, refundUsageColumn, todayUtc, blockedResponse } from '@/lib/aiUsage';
import { apiError } from '@/lib/apiError';
import { getUserCompatForBilledCall } from '@/lib/authUser';
import { userClient } from '@/lib/supabase-user';

export const dynamic = 'force-dynamic';

const GROK_KEY = process.env.GROK_API_KEY ?? '';

const SYSTEM = `You are a pre-session market briefing assistant for a crypto futures trader. You describe the market conditions in the data provided. You do not forecast price and you do not tell the reader what to do.

Write exactly 3 short paragraphs:
1. Overall conditions and sentiment right now, from the fear and greed, dominance, dollar, ETF flow and yen readings
2. What stands out in the coin data, stated as readings: extreme funding, RSI, CVD divergence or open interest trend
3. The scheduled events and news in the data for the next hours; if the data says the calendar is unavailable, or lists no events, say that

Rules:
- Plain language; state only what the data shows, and attribute readings to the data
- Do not name a best setup, do not say what to buy, sell or avoid, and do not predict direction or price targets
- The data has no results for data releases that just came out; do not state or guess them
- If a reading is missing (shown as ? or N/A), say it is missing
- A reading shown as - is missing too; never estimate a missing reading
- No bullet points, no headers
- Max 60 words per paragraph`;

function sb(token: string) {
  return userClient(token);
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
    return NextResponse.json({ error: 'AI is not configured' }, { status: 503 });
  }
  if (!(await isFeatureEnabled('grok'))) {
    return NextResponse.json({ error: 'Briefing is temporarily unavailable.', code: 'FEATURE_DISABLED' }, { status: 503 });
  }

  /* ── Auth check ── */
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return NextResponse.json({ error: 'Sign in required', code: 'AUTH_REQUIRED' }, { status: 401 });
  }
  const { data: userData } = await getUserCompatForBilledCall(token);
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

  /* The context is assembled in the browser (components/BriefingTerminal.tsx, buildBriefingContext) and sent
   * whole, so its length is caller-controlled. The daily cap counts CALLS, not tokens.
   *
   * THE DOLLAR CAP CANNOT COVER THIS, and that is the reason this bound has to exist rather than a reason to
   * skip it: lib/aiSpendCap.ts checks BEFORE the call, so an account sitting at $0.00 passes the check and
   * then spends whatever the call costs. The input bound is the only thing limiting the FIRST oversized call.
   * At grok-4.3's input rate roughly half a megabyte of text would pass a Free account's whole daily cap in
   * one call, and lib/aiCost.ts records that its own estimates run about 4x low.
   *
   * 64,000 is not a new number - app/api/grok/route.ts:129 already uses it for exactly this, so it carries
   * its review with it. buildBriefingContext assembles a fixed-shape block over a bounded set of rows and
   * runs far under it; anything larger is not the app talking. */
  if (context.length > 64_000) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  /* ── Rate limit check ── */
  const today = todayUtc();
  const [{ briefingUsed }, plan] = await Promise.all([
    getUsageRow(token, userId, today),
    getUsageTierStatus(token, userId),
  ]);
  /* U7: an UNKNOWN plan is never billed against the Free cap: Pro count cap, dollar cap fails closed (POST /api/grok's rule, #2412). */
  const role: UsageTier = plan.failed ? 'pro' : plan.tier;
  const briefingLimit = AI_LIMITS[role].briefing;

  // Atomic check-and-increment (reserve before spending on xAI) - closes the
  // TOCTOU race the old read-then-upsert pattern had between concurrent requests.
  /* A reserved use is given back when no answer reached the user (xAI refused, the call threw, the answer was unusable), as /api/grok does; not after a billed 2xx with a usable answer. (U4) */
  const reservedOn = todayUtc();
  let billed = false;
  const usageResult = await incrementUsageColumn(userId, role, 'briefing_count', briefingLimit, null, plan.failed);
  if (usageResult.blocked) {
    return blockedResponse(usageResult.reason, rateLimitMessage(usageResult.reason, briefingLimit, 'briefings'), {
      usage: { briefing_used: briefingUsed, briefing_limit: briefingLimit },
    });
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
      /* 45 SECONDS, NOT THE 180 s FLOOR (PM audit 2026-11-17: "Generating…" for up to three minutes). The browser gives up at 50. */
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      await refundUsageColumn(userId, 'briefing_count', reservedOn);
      const txt = await res.text();
      return apiError('briefing', txt, res.status, 'AI service error');
    }

    const data = await res.json();
    billed = true;   // 2xx: the tokens are billed from here
    await recordAiCall({ userId, callType: 'briefing', model: data.model ?? 'grok-4.3', usage: data.usage });
    const briefing = (data.choices?.[0]?.message?.content ?? '').trim();
    /* AN EMPTY REPLY IS A FAILED ANSWER, not a blank card: the quota is handed back as the Arena does. */
    if (!briefing) {
      await refundUsageColumn(userId, 'briefing_count', reservedOn);
      return NextResponse.json({ error: 'The briefing came back empty. Try again in a moment.' }, { status: 502 });
    }

    return NextResponse.json({
      briefing,
      _usage: { briefing_used: usageResult.count, briefing_limit: briefingLimit },
    });
  } catch (e) {
    if (!billed) await refundUsageColumn(userId, 'briefing_count', reservedOn);
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      return NextResponse.json({ error: 'The briefing took too long. Try again in a moment.' }, { status: 504 });
    }
    return apiError('briefing', e, 500, 'Request failed');
  }
}
