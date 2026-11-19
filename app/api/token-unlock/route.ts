import { NextRequest, NextResponse } from 'next/server';
import { xaiFetch } from '@/lib/xai';
import { recordAiCall } from '@/lib/aiCallLog';
import { cachedOwn } from '@/lib/apiCache';
import { incrementToolUsage, rateLimitMessage, refundToolUsage, todayUtc, type UsageBlockReason, blockedResponse } from '@/lib/aiUsage';
import { requireProPlan, hasProFeatures } from '@/lib/entitlements';
import { apiError } from '@/lib/apiError';
import { getUserCompatForBilledCall } from '@/lib/authUser';
import { userClient } from '@/lib/supabase-user';
import { bearerToken } from '@/lib/bearerToken';

const GROK_KEY = process.env.GROK_API_KEY ?? '';
// Vesting schedules don't change hour to hour, and every visitor checking the
// same symbol gets an identical Grok answer - cache per symbol.
const CACHE_TTL = 6 * 60 * 60_000;

class RateLimitError extends Error {
  constructor(public limit: number, public reason: UsageBlockReason, public blockedUserId?: string) {
    super(rateLimitMessage(reason, limit, 'token-unlock checks'));
  }
}

/** Flip to true only when the prompt is fed real unlock-schedule data. */
const UNLOCK_SOURCE_WIRED: boolean = false;

function sb(token: string) {
  return userClient(token);
}

function buildUnlockPrompt(symbol: string): string {
  return [
    `You are a crypto tokenomics analyst specializing in vesting schedules and token unlock events. Analyze "${symbol}" for upcoming unlock-driven sell pressure.`,
    '',
    'Use your training data on vesting schedules, tokenomics documents, and historical unlock events. If you lack specific data for this token, state that clearly and analyze what is known about the token category.',
    '',
    'Output using EXACTLY these headers (no markdown bold, no extra text before each header):',
    'CURRENT_SUPPLY:',
    '[Approximate circulating supply vs max supply, and the circulating %]',
    'UNLOCK_SCHEDULE:',
    '[Known unlock events in the next 90 days: who is unlocking, approximate amount as % of circulating supply, timing, cliff vs linear. If no data available, say so.]',
    'SELL_PRESSURE_30D:',
    '[Rate as: CRITICAL (>10% circulating unlocking), HIGH (5-10%), MODERATE (2-5%), LOW (<2%), or MINIMAL. Explain why in 1-2 sentences.]',
    'SELL_PRESSURE_90D:',
    '[Same rating for 30-90 day window. Note any major cliff events.]',
    'HISTORICAL_PATTERN:',
    '[How has this token historically reacted to unlock events? Has the market absorbed unlocks well or seen sustained sell pressure?]',
  ].join('\n');
}

export async function POST(req: NextRequest) {
  const authToken = bearerToken(req.headers);
  if (!authToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: authData } = await getUserCompatForBilledCall(authToken);
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Pro-only. This tool is reachable in-product only from /backtest, which
  // is fully paywalled in the UI - so without a server-side check the paid
  // xAI call was still callable directly with a free account token. Trial
  // users pass (hasProFeatures covers isTrial).
  const plan = await requireProPlan(authToken, authData.user.id, 'Token unlock analysis is a Pro feature.');
  if (!plan.ok) return plan.response;

  if (!GROK_KEY) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });

  const body = await req.json().catch(() => ({})) as { symbol?: string };
  const symbol = (body.symbol ?? '').toUpperCase().replace(/USDT$/i, '').trim();

  // Strict charset (not just length) - a loose check let callers defeat the
  // cache key below by padding with punctuation/whitespace noise, forcing a
  // fresh (unbounded, unrated) xAI call every time. See pendings/PENDING.md.
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) {
    return NextResponse.json({ error: 'Enter a valid token symbol (e.g. ARB, OP, PYTH)' }, { status: 400 });
  }

  /* NO UNLOCK DATA SOURCE, SO NO ANSWER (owner sweep 2026-11-18). This read had no vesting data behind it: the model answered from memory
     and ended with trading advice. Until a real unlock-schedule source is wired in, the route says the data is unavailable BEFORE any
     paid call (nothing is charged), and the advice section is gone from the prompt. */
  if (!UNLOCK_SOURCE_WIRED) {
    return NextResponse.json({ error: 'Token unlock data is not available yet.', code: 'UNAVAILABLE' }, { status: 503 });
  }

  try {
    const result = await cachedOwn(authData.user.id, `token-unlock:${symbol}`, CACHE_TTL, async () => {
      // Only the cache-miss path actually spends on xAI, so only it needs the
      // daily cap - a cache hit for a popular symbol stays free for everyone.
      const role = plan.tier;
      /* A reserved use is given back when no answer reached the user (xAI refused, the call threw, the answer was unusable), as /api/grok does; not after a billed 2xx with a usable answer. (U4) */
      const reservedOn = todayUtc();
      const giveBack = () => refundToolUsage(authData.user.id, 'tokenUnlock', reservedOn);
      const usageResult = await incrementToolUsage(authData.user.id, 'tokenUnlock', role, reservedOn);
      if (usageResult.blocked) {
        throw new RateLimitError(usageResult.limit, usageResult.reason, authData.user.id);
      }

      const prompt = buildUnlockPrompt(symbol);

      const aiRes = await xaiFetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
        body: JSON.stringify({
          model: 'grok-4.3',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 900,
        }),
      }).catch(async (e: unknown) => { await giveBack(); throw e; });

      if (!aiRes.ok) {
        await giveBack();
        const err = await aiRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? 'AI error');
      }

      const aiData = await aiRes.json();
      await recordAiCall({ userId: authData.user.id, callType: 'token_unlock', model: aiData.model ?? 'grok-4.3', usage: aiData.usage });
      const analysis: string = aiData.choices?.[0]?.message?.content ?? '';

      return { analysis, symbol };
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return blockedResponse(e.reason, e.message);
    }
    return apiError('token-unlock', e, 502, 'Request failed');
  }
}
