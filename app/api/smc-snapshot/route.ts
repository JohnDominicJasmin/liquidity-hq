import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cached } from '@/lib/apiCache';
import { incrementToolUsage, rateLimitMessage, type UsageBlockReason } from '@/lib/aiUsage';
import { getUsageTier, hasProFeatures } from '@/lib/entitlements';
import { apiError } from '@/lib/apiError';

const GROK_KEY = process.env.GROK_API_KEY ?? '';
// Every visitor requesting the same asset+timeframe within this window gets
// the same candles and the same Grok read - cache per (asset, tf).
const CACHE_TTL = 2 * 60_000;

class RateLimitError extends Error {
  constructor(public limit: number, reason: UsageBlockReason) {
    super(rateLimitMessage(reason, limit, 'SMC snapshots'));
  }
}

const VALID_TFS = new Set([
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h',
  '1d', '3d', '1w', '1M',
]);

const SYMBOL_MAP: Record<string, string> = {
  BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT', XRP: 'XRPUSDT',
  BNB: 'BNBUSDT', ADA: 'ADAUSDT', DOGE: 'DOGEUSDT', MATIC: 'MATICUSDT',
  DOT: 'DOTUSDT', LINK: 'LINKUSDT', AVAX: 'AVAXUSDT', UNI: 'UNIUSDT',
  LTC: 'LTCUSDT', BCH: 'BCHUSDT', ATOM: 'ATOMUSDT', NEAR: 'NEARUSDT',
  OP: 'OPUSDT', ARB: 'ARBUSDT', SUI: 'SUIUSDT', TON: 'TONUSDT',
  PEPE: 'PEPEUSDT', WIF: 'WIFUSDT', BONK: 'BONKUSDT', FTM: 'FTMUSDT',
};

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
}

interface Candle {
  open: number; high: number; low: number; close: number; volume: number;
}

async function fetchCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
  );
  if (!res.ok) throw new Error(`Binance ${res.status} for ${symbol}`);
  const raw = (await res.json()) as [number, string, string, string, string, string][];
  return raw.map(c => ({
    open: parseFloat(c[1]), high: parseFloat(c[2]),
    low:  parseFloat(c[3]), close: parseFloat(c[4]),
    volume: parseFloat(c[5]),
  }));
}

function buildSMCPrompt(asset: string, tf: string, candles: Candle[]): string {
  const last20 = candles.slice(-20);
  const ohlcv  = last20.map(c =>
    `O:${c.open.toFixed(2)} H:${c.high.toFixed(2)} L:${c.low.toFixed(2)} C:${c.close.toFixed(2)} V:${Math.round(c.volume)}`,
  ).join('\n');

  const cur   = candles[candles.length - 1].close;
  const hi50  = Math.max(...candles.map(c => c.high));
  const lo50  = Math.min(...candles.map(c => c.low));

  return [
    `You are a Smart Money Concepts (SMC) analyst. Analyze the ${tf} price data for ${asset}USDT and identify key SMC structures.`,
    '',
    `Current price: $${cur.toFixed(2)}`,
    `50-candle range: $${lo50.toFixed(2)} to $${hi50.toFixed(2)}`,
    '',
    'LAST 20 CANDLES (OHLCV):',
    ohlcv,
    '',
    'Output using EXACTLY these headers (no markdown bold, no extra text before each header):',
    'MARKET_STRUCTURE:',
    '[Bullish or bearish structure. Most recent BoS or ChoCH price level and what it means]',
    'FAIR_VALUE_GAPS:',
    '[1-3 significant FVGs: direction, price range, and whether price is approaching]',
    'ORDER_BLOCKS:',
    '[Most relevant demand and supply OB zones with price ranges and validity]',
    'LIQUIDITY_ZONES:',
    '[Where are equal highs/lows, stop clusters, and session liquidity? Which is price targeting?]',
    'BIAS:',
    '[BULLISH / BEARISH / NEUTRAL - one sentence primary reason based on SMC principles]',
    'KEY_LEVELS:',
    '[2-3 specific price levels most important for the next 1-3 candles]',
  ].join('\n');
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: authData } = await sb(token).auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Pro-only. This tool is reachable in-product only from /backtest, which
  // is fully paywalled in the UI - so without a server-side check the paid
  // xAI call was still callable directly with a free account token. Trial
  // users pass (hasProFeatures covers isTrial).
  if (!(await hasProFeatures(token, authData.user.id))) {
    return NextResponse.json({ error: 'PRO_REQUIRED', message: 'Smart-money snapshot is a Pro feature.' }, { status: 403 });
  }

  if (!GROK_KEY) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });

  const body = await req.json().catch(() => ({})) as { asset?: string; tf?: string };
  const asset  = (body.asset ?? 'BTC').toUpperCase().replace(/USDT$/i, '').trim();
  const tf     = body.tf ?? '1h';

  // Strict charset/allowlist (not just a default) - previously any string was
  // accepted into the cache key below, letting callers defeat it with
  // arbitrary noise and force unlimited fresh xAI calls. See pendings/PENDING.md
  // finding #3 (same class of bug as token-unlock).
  if (!/^[A-Z0-9]{1,10}$/.test(asset)) {
    return NextResponse.json({ error: 'Invalid asset symbol' }, { status: 400 });
  }
  if (!VALID_TFS.has(tf)) {
    return NextResponse.json({ error: 'Invalid timeframe' }, { status: 400 });
  }

  const symbol = SYMBOL_MAP[asset] ?? `${asset}USDT`;

  try {
    const result = await cached(`smc-snapshot:${asset}:${tf}`, CACHE_TTL, async () => {
      // Only the cache-miss path spends on xAI, so only it needs the daily
      // cap - a cache hit within the 2min TTL stays free for everyone.
      const role = await getUsageTier(token, authData.user.id);
      const usageResult = await incrementToolUsage(authData.user.id, 'smcSnapshot', role);
      if (usageResult.blocked) {
        throw new RateLimitError(usageResult.limit, usageResult.reason);
      }

      const candles = await fetchCandles(symbol, tf, 50);
      if (candles.length < 20) throw new Error('Not enough candle data - try a different timeframe');

      const prompt = buildSMCPrompt(asset, tf, candles);

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

      return { analysis, asset, tf };
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return NextResponse.json({ error: e.message, code: 'RATE_LIMIT' }, { status: 429 });
    }
    return apiError('smc-snapshot', e, 502, 'Request failed');
  }
}
