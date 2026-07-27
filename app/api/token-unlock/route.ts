import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cached } from '@/lib/apiCache';
import { incrementToolUsage, rateLimitMessage } from '@/lib/aiUsage';
import { getUserRole, hasProFeatures } from '@/lib/entitlements';
import { AI_LIMITS } from '@/lib/limits';
import { apiError } from '@/lib/apiError';

const GROK_KEY = process.env.GROK_API_KEY ?? '';
// Vesting schedules don't change hour to hour, and every visitor checking the
// same symbol gets an identical Grok answer - cache per symbol.
const CACHE_TTL = 6 * 60 * 60_000;

class RateLimitError extends Error {
  constructor(public limit: number, reason: 'user' | 'global') {
    super(rateLimitMessage(reason, limit, 'token-unlock checks'));
  }
}

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
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
    'RECOMMENDATION:',
    '[Strategic guidance: should traders be cautious about holding through the next 90 days given the unlock schedule?]',
  ].join('\n');
}

export async function POST(req: NextRequest) {
  const authToken = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!authToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: authData } = await sb(authToken).auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Pro-only. This tool is reachable in-product only from /backtest, which
  // is fully paywalled in the UI - so without a server-side check the paid
  // xAI call was still callable directly with a free account token. Trial
  // users pass (hasProFeatures covers isTrial).
  if (!(await hasProFeatures(authToken, authData.user.id))) {
    return NextResponse.json({ error: 'PRO_REQUIRED', message: 'Token unlock analysis is a Pro feature.' }, { status: 403 });
  }

  if (!GROK_KEY) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });

  const body = await req.json().catch(() => ({})) as { symbol?: string };
  const symbol = (body.symbol ?? '').toUpperCase().replace(/USDT$/i, '').trim();

  // Strict charset (not just length) - a loose check let callers defeat the
  // cache key below by padding with punctuation/whitespace noise, forcing a
  // fresh (unbounded, unrated) xAI call every time. See pendings/PENDING.md.
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) {
    return NextResponse.json({ error: 'Enter a valid token symbol (e.g. ARB, OP, PYTH)' }, { status: 400 });
  }

  try {
    const result = await cached(`token-unlock:${symbol}`, CACHE_TTL, async () => {
      // Only the cache-miss path actually spends on xAI, so only it needs the
      // daily cap - a cache hit for a popular symbol stays free for everyone.
      const role = await getUserRole(authToken, authData.user.id);
      const limit = AI_LIMITS[role].tokenUnlock;
      const usageResult = await incrementToolUsage(authToken, authData.user.id, 'tokenUnlock', limit);
      if (usageResult.blocked) {
        throw new RateLimitError(limit, usageResult.reason);
      }

      const prompt = buildUnlockPrompt(symbol);

      const aiRes = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
        body: JSON.stringify({
          model: 'grok-4.3',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 900,
        }),
      });

      if (!aiRes.ok) {
        const err = await aiRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? 'AI error');
      }

      const aiData = await aiRes.json();
      const analysis: string = aiData.choices?.[0]?.message?.content ?? '';

      return { analysis, symbol };
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return NextResponse.json({ error: e.message, code: 'RATE_LIMIT' }, { status: 429 });
    }
    return apiError('token-unlock', e, 502, 'Request failed');
  }
}
