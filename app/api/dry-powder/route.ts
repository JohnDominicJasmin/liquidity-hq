import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { createClient } from '@supabase/supabase-js';
import { cached } from '@/lib/apiCache';
import { incrementToolUsage, rateLimitMessage } from '@/lib/aiUsage';
import { getUserRole } from '@/lib/entitlements';
import { AI_LIMITS } from '@/lib/limits';

const GROK_KEY = process.env.GROK_API_KEY ?? '';
// DeFi Llama's stablecoin series only updates once a day - cache generously.
const CACHE_TTL = 60 * 60_000;

class RateLimitError extends Error {
  constructor(public limit: number, reason: 'user' | 'global') {
    super(rateLimitMessage(reason, limit, 'dry powder checks'));
  }
}

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
}

interface LlamaEntry {
  date: string;
  totalCirculatingUSD: Record<string, number>;
}

async function fetchStablecoinSeries(): Promise<number[]> {
  const res = await fetch('https://stablecoins.llama.fi/stablecoincharts/all', {
    headers: { 'User-Agent': 'LiquidityHQ/1.0' },
  });
  if (!res.ok) throw new Error(`DeFi Llama ${res.status}`);
  const data = (await res.json()) as LlamaEntry[];
  return data.slice(-91).map(d => d.totalCirculatingUSD?.peggedUSD ?? 0);
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

  const { data: authData } = await sb(token).auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!GROK_KEY) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });

  try {
    const result = await cached('dry-powder', CACHE_TTL, async () => {
      // Only the cache-miss path actually spends on xAI, so only it needs the
      // daily cap - a cache hit stays free for everyone (same pattern as
      // token-unlock/smc-snapshot).
      const role = await getUserRole(token, authData.user.id);
      const limit = AI_LIMITS[role].dryPowder;
      const usageResult = await incrementToolUsage(token, authData.user.id, 'dryPowder', limit);
      if (usageResult.blocked) {
        throw new RateLimitError(limit, usageResult.reason);
      }

      const series = await fetchStablecoinSeries();
      if (series.length < 32) throw new Error('Insufficient stablecoin data');

      const current = series[series.length - 1];
      const prev30  = series[Math.max(0, series.length - 31)];
      const prev90  = series[0];

      const prompt = buildPrompt(current, prev30, prev90);

      const aiRes = await fetch('https://api.x.ai/v1/chat/completions', {
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

      const aiData = await aiRes.json();
      const analysis: string = aiData.choices?.[0]?.message?.content ?? '';

      return { current, prev30, prev90, series: series.slice(-30), analysis };
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return NextResponse.json({ error: e.message, code: 'RATE_LIMIT' }, { status: 429 });
    }
    return apiError('dry-powder', e, 502, 'Request failed');
  }
}
