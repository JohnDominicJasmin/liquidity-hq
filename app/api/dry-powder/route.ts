import { NextRequest, NextResponse } from 'next/server';
import { xaiFetch } from '@/lib/xai';
import { recordAiCall } from '@/lib/aiCallLog';
import { apiError } from '@/lib/apiError';
import { cached } from '@/lib/apiCache';
import { getDryPowderNumbers } from '@/lib/dryPowderSeries';
import { incrementToolUsage, refundToolUsage, todayUtc, rateLimitMessage, type UsageBlockReason } from '@/lib/aiUsage';
import { getUsageTier, hasProFeatures } from '@/lib/entitlements';
import { getUserCompatForBilledCall } from '@/lib/authUser';
import { userClient } from '@/lib/supabase-user';

const GROK_KEY = process.env.GROK_API_KEY ?? '';
// The AI text is cached an hour; the numbers it describes are cached a day (lib/dryPowderSeries.ts).
const CACHE_TTL = 60 * 60_000;
/** The AI step's own bound. Past it the card says the analysis is unavailable and keeps showing the numbers. */
const ANALYSIS_TIMEOUT_MS = 25_000;

class RateLimitError extends Error {
  constructor(public limit: number, reason: UsageBlockReason) {
    super(rateLimitMessage(reason, limit, 'dry powder checks'));
  }
}

function sb(token: string) {
  return userClient(token);
}

function buildPrompt(current: number, prev30: number, prev90: number): string {
  const chg30 = ((current - prev30) / prev30 * 100).toFixed(1);
  const chg90 = ((current - prev90) / prev90 * 100).toFixed(1);
  return [
    'You are a crypto market liquidity analyst. Analyze the following stablecoin supply data from DeFi Llama and provide a concise dry powder assessment.',
    '',
    'STABLECOIN SUPPLY DATA:',
    `Current total stablecoin market cap: $${(current / 1e9).toFixed(1)}B`,
    `30 days ago: $${(prev30 / 1e9).toFixed(1)}B (${chg30}% change)`,
    `90 days ago: $${(prev90 / 1e9).toFixed(1)}B (${chg90}% change)`,
    '',
    'Context: Stablecoin supply expansion = fresh liquidity entering crypto (bullish dry powder). Contraction = capital already deployed or exiting.',
    '',
    'Output using EXACTLY these headers:',
    'SIGNAL:',
    '[One of: EXPANDING, CONTRACTING, or NEUTRAL - followed by a colon and a one-sentence reason on the same line]',
    'NARRATIVE:',
    '[2-3 sentences explaining what this trend means for crypto prices over the next 2-4 weeks]',
    'KEY_LEVEL:',
    '[One specific supply level or trend inflection point traders should watch]',
  ].join('\n');
}

export async function GET(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: authData } = await getUserCompatForBilledCall(token);
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Pro-only. /upgrade sells the one-shot AI tools as a Pro feature
  // (UPGRADE_PRO_FEATURE_TOOL_POOL); this route is one of them. Without this
  // check a free account could still spend real xAI budget here, which is
  // what the pricing page says it cannot. Trial users pass - hasProFeatures
  // covers isTrial.
  if (!(await hasProFeatures(token, authData.user.id))) {
    return NextResponse.json({ error: 'PRO_REQUIRED', message: 'Dry Powder analysis is a Pro feature.' }, { status: 403 });
  }

  if (!GROK_KEY) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });

  try {
    /* ?part=numbers: the supply figures alone, no AI and no usage cost, so the card shows data in about a second (and instantly once the day's series is cached). The default part is the AI text. */
    if (req.nextUrl.searchParams.get('part') === 'numbers') {
      return NextResponse.json(await getDryPowderNumbers());
    }
    let reserved: { on: string } | null = null;
    let billed = false;
    try {
      const result = await cached('dry-powder', CACHE_TTL, async () => {
        // Only the cache-miss path actually spends on xAI, so only it needs the
        // daily cap - a cache hit stays free for everyone (same pattern as
        // token-unlock/smc-snapshot).
        const role = await getUsageTier(token, authData.user.id);
        const on = todayUtc();
        const usageResult = await incrementToolUsage(authData.user.id, 'dryPowder', role);
        if (usageResult.blocked) {
          throw new RateLimitError(usageResult.limit, usageResult.reason);
        }
        reserved = { on };

        const { current, prev30, prev90, series } = await getDryPowderNumbers();
        const prompt = buildPrompt(current, prev30, prev90);

        const aiRes = await xaiFetch('https://api.x.ai/v1/chat/completions', {
          signal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
          body: JSON.stringify({
            model: 'grok-4.3',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 350,
          }),
        });

        if (!aiRes.ok) {
          const err = await aiRes.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error ?? 'AI error');
        }
        billed = true; // 2xx: the tokens are billed from here

        const aiData = await aiRes.json();
        await recordAiCall({ userId: authData.user.id, callType: 'dry_powder', model: aiData.model ?? 'grok-4.3', usage: aiData.usage });
        const analysis: string = aiData.choices?.[0]?.message?.content ?? '';

        return { current, prev30, prev90, series, analysis };
      });
      return NextResponse.json(result);
    } catch (e) {
      /* A read that was reserved but never billed (the 25 s bound, a non-2xx, no series) goes back, as in /api/grok. */
      const r = reserved as { on: string } | null;
      if (r && !billed) await refundToolUsage(authData.user.id, 'dryPowder', r.on);
      throw e;
    }
  } catch (e) {
    if (e instanceof RateLimitError) {
      return NextResponse.json({ error: e.message, code: 'RATE_LIMIT' }, { status: 429 });
    }
    return apiError('dry-powder', e, 502, 'Request failed');
  }
}
