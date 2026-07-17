import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cached } from '@/lib/apiCache';
import { getUserRole } from '@/lib/entitlements';

const GROK_KEY = process.env.GROK_API_KEY ?? '';
// On-chain metrics (MVRV/SOPR/NVT/exchange flow) don't move within minutes, and
// this is an expensive Grok web_search+x_search call - cache it across visitors.
const CACHE_TTL = 10 * 60_000;

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
}

interface BlockchainStats {
  n_unique_addresses?: number;
  total_btc_sent?: number;
  n_blocks_today?: number;
  hash_rate?: number;
}

async function fetchBlockchainStats(): Promise<BlockchainStats | null> {
  try {
    const res = await fetch('https://blockchain.info/stats?format=json', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LiquidityHQ/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.json() as BlockchainStats;
  } catch {
    return null;
  }
}

function buildOnChainPrompt(stats: BlockchainStats | null, btcPrice: number): string {
  const addrLine = stats?.n_unique_addresses
    ? `Active addresses (last 24h): ${stats.n_unique_addresses.toLocaleString()}`
    : 'Active addresses: unavailable from blockchain.info';
  const btcSent = stats?.total_btc_sent
    ? `BTC transacted (24h): ${(stats.total_btc_sent / 1e8).toFixed(0)} BTC`
    : 'Transaction volume: unavailable';

  return [
    'You are an on-chain Bitcoin analyst. Use your web_search and x_search tools to find the CURRENT values of key on-chain metrics, then produce a weighted composite score.',
    '',
    '=== REAL-TIME BLOCKCHAIN DATA ===',
    addrLine,
    btcSent,
    btcPrice > 0 ? `BTC Price: $${btcPrice.toLocaleString()}` : '',
    '',
    '=== STEP 1 - SEARCH FOR CURRENT VALUES ===',
    'Search for the latest published values (from Glassnode, CryptoQuant, IntoTheBlock, X/Twitter analytics accounts, or any public source) of:',
    '1. MVRV Ratio - if found, note the exact value and source',
    '2. SOPR (ideally adjusted SOPR) - if found, note value and source',
    '3. NVT Ratio (or NVT Signal) - if found, note value and source',
    '4. Exchange Net Flow direction for BTC - are whales sending coins TO exchanges (bearish) or withdrawing (bullish)?',
    '',
    '=== STEP 2 - SCORE EACH DIMENSION ===',
    '',
    'VALUATION SCORE (uses MVRV + SOPR + NVT, weight 30%):',
    '  MVRV:  <0.8=100, 0.8-1.5=80, 1.5-2.5=55, 2.5-3.5=25, >3.5=5',
    '  SOPR:  <0.97=95, 0.97-1.00=75, 1.00-1.02=55, 1.02-1.06=30, >1.06=10',
    '  NVT:   <50=90, 50-75=70, 75-110=50, 110-150=25, >150=5',
    '  Average the three sub-scores for valuation_score.',
    '  If a metric is unavailable, use 50 as neutral and note it.',
    '',
    'ACTIVITY SCORE (active addresses, weight 25%):',
    '  >1.0M=95, 800k-1M=75, 600-800k=55, 400-600k=35, <400k=15',
    '',
    'CAPITAL FLOW SCORE (exchange net flow, weight 25%):',
    '  Strong outflow (>5k BTC/day leaving exchanges)=90',
    '  Mild outflow=70, Neutral=50, Mild inflow=30, Strong inflow=10',
    '',
    'WHALE SCORE (large-tx behavior, weight 20%):',
    '  Based on whale exchange deposits, large-tx count, or any whale data you find.',
    '  Bullish whale behavior (accumulation, low exchange deposits)=70-95',
    '  Neutral=50, Bearish whale behavior (distribution, high exchange deposits)=5-35',
    '',
    '=== STEP 3 - COMPOSITE ===',
    'composite_score = round(valuation_score*0.30 + activity_score*0.25 + capital_flow_score*0.25 + whale_score*0.20)',
    'verdict: composite>=65 → "BULLISH", composite<=40 → "BEARISH", else → "NEUTRAL"',
    '',
    '=== OUTPUT - respond in EXACTLY this JSON, no markdown, no preamble ===',
    '{',
    '  "mvrv": <number or null>,',
    '  "mvrv_source": "<site/account name>",',
    '  "sopr": <number or null>,',
    '  "sopr_source": "<site/account name>",',
    '  "nvt": <number or null>,',
    '  "nvt_source": "<site/account name>",',
    '  "exchange_flow": "INFLOW" | "OUTFLOW" | "NEUTRAL",',
    '  "exchange_flow_note": "<one sentence>",',
    '  "active_addresses": <number or null>,',
    '  "valuation_score": <0-100>,',
    '  "activity_score": <0-100>,',
    '  "capital_flow_score": <0-100>,',
    '  "whale_score": <0-100>,',
    '  "composite_score": <0-100>,',
    '  "verdict": "BULLISH" | "NEUTRAL" | "BEARISH",',
    '  "verdict_reasoning": "<2-3 sentences explaining the composite picture>"',
    '}',
  ].filter(Boolean).join('\n');
}

export async function GET(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: authData } = await sb(token).auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Pro-only feature - checked server-side so the paid Grok call can't be
  // reached by skipping the client gate.
  const role = await getUserRole(token, authData.user.id);
  if (role !== 'pro') {
    return NextResponse.json({ error: 'PRO_REQUIRED', message: 'On-chain score is a Pro feature.' }, { status: 403 });
  }

  if (!GROK_KEY) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });

  const btcPrice = parseFloat(req.nextUrl.searchParams.get('price') ?? '0') || 0;

  try {
    const result = await cached('onchain', CACHE_TTL, async () => {
      const stats = await fetchBlockchainStats();
      const prompt = buildOnChainPrompt(stats, btcPrice);

      const r = await fetch('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
        body: JSON.stringify({
          model: 'grok-4.3',
          input: [{ role: 'user', content: prompt }],
          tools: [{ type: 'web_search' }, { type: 'x_search' }],
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(e.error ?? 'Grok error');
      }
      const d = await r.json();
      const msg = (d.output as Array<{ type: string; content?: Array<{ text: string }> }>)
        ?.find(o => o.type === 'message');
      const raw = msg?.content?.[0]?.text ?? '';

      let parsed: Record<string, unknown> | null = null;
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]) as Record<string, unknown>; } catch { /* fall through */ } }
      if (!parsed) throw new Error('Could not parse AI response');

      return { ...parsed, blockchain_stats: stats ?? undefined, timestamp: new Date().toISOString() };
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Request failed' }, { status: 502 });
  }
}
