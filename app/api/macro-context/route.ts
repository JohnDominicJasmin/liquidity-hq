import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cached } from '@/lib/apiCache';
import { getUserRole } from '@/lib/entitlements';

const GROK_KEY = process.env.GROK_API_KEY ?? '';
// DXY/VIX/gold/oil/10Y don't meaningfully shift within a few minutes - cache
// across visitors instead of hitting Yahoo Finance + Grok on every page load.
const CACHE_TTL = 5 * 60_000;

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
}

interface YFMeta { regularMarketPrice: number; previousClose: number; shortName?: string }

async function fetchYF(symbol: string): Promise<{ price: number; prev: number } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2d&interval=1d`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) return null;
    const data = await res.json() as { chart?: { result?: Array<{ meta?: YFMeta }> } };
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;
    return { price: meta.regularMarketPrice, prev: meta.previousClose };
  } catch {
    return null;
  }
}

function pctChange(price: number, prev: number) {
  return ((price - prev) / prev) * 100;
}

function buildMacroPrompt(d: {
  dxy: number; dxyChg: number;
  vix: number; vixChg: number;
  gold: number; goldChg: number;
  oil: number; oilChg: number;
  tnx: number; tnxChg: number;
  goldOilRatio: number;
}): string {
  const fmt = (n: number, dec = 2) => n.toFixed(dec);
  const chgStr = (c: number) => (c >= 0 ? '+' : '') + c.toFixed(2) + '%';

  return [
    'You are a macro strategist specializing in crypto market correlations. Analyze the following macro indicators and classify the current macro backdrop for crypto traders.',
    '',
    '=== CURRENT MACRO DATA (live) ===',
    `DXY (US Dollar Index): ${fmt(d.dxy)} (${chgStr(d.dxyChg)} today)`,
    `VIX (Fear Index):       ${fmt(d.vix)} (${chgStr(d.vixChg)} today)`,
    `Gold (XAU/USD):         $${fmt(d.gold, 0)} (${chgStr(d.goldChg)} today)`,
    `WTI Oil:                $${fmt(d.oil, 1)} (${chgStr(d.oilChg)} today)`,
    `10Y Treasury Yield:     ${fmt(d.tnx, 2)}% (${chgStr(d.tnxChg)} today)`,
    `Gold/Oil Ratio:         ${fmt(d.goldOilRatio, 1)}x`,
    '',
    '=== CLASSIFICATION TASKS ===',
    '',
    '1. MACRO_SIGNAL - Classify the CURRENT macro backdrop as exactly one of: RISK_ON, RISK_OFF, or NEUTRAL.',
    '   Base this on the composite picture: DXY direction, VIX level, gold vs oil behavior.',
    '   Format: "RISK_ON" or "RISK_OFF" or "NEUTRAL" - nothing else on this line.',
    '',
    '2. MACRO_ANALYSIS - In 3-4 sentences, explain WHY you classified it that way. What is each indicator telling you?',
    '   Which indicators are conflicting? What is the dominant narrative?',
    '',
    '3. CRYPTO_IMPLICATIONS - What does this macro backdrop mean specifically for BTC and crypto?',
    '   - Expected BTC behavior in this macro regime',
    '   - Key correlation to watch (DXY strength, VIX spike, etc.)',
    '   - Position sizing implication (increase, hold, reduce exposure?)',
    '',
    '4. WATCH_LEVEL - One specific macro level or threshold that would CHANGE the regime classification if crossed.',
    '',
    'Output using EXACTLY these headers:',
    'MACRO_SIGNAL:',
    '[RISK_ON or RISK_OFF or NEUTRAL]',
    'MACRO_ANALYSIS:',
    '[3-4 sentences]',
    'CRYPTO_IMPLICATIONS:',
    '[bullet points]',
    'WATCH_LEVEL:',
    '[one specific level/threshold]',
  ].join('\n');
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
    return NextResponse.json({ error: 'PRO_REQUIRED', message: 'Global macro context is a Pro feature.' }, { status: 403 });
  }

  if (!GROK_KEY) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });

  try {
    const result = await cached('macro-context', CACHE_TTL, async () => {
      const [dxyData, vixData, goldData, oilData, tnxData] = await Promise.all([
        fetchYF('DX-Y.NYB'),
        fetchYF('%5EVIX'),
        fetchYF('GC%3DF'),
        fetchYF('CL%3DF'),
        fetchYF('%5ETNX'),
      ]);

      const missing = [
        !dxyData && 'DXY',
        !vixData && 'VIX',
        !goldData && 'Gold',
        !oilData && 'Oil',
        !tnxData && '10Y Treasury',
      ].filter(Boolean);

      if (missing.length >= 3) {
        throw new Error(`Could not fetch macro data (${missing.join(', ')})`);
      }

      const dxy  = dxyData  ?? { price: 103.5, prev: 103.5 };
      const vix  = vixData  ?? { price: 18,    prev: 18    };
      const gold = goldData ?? { price: 2350,  prev: 2350  };
      const oil  = oilData  ?? { price: 78,    prev: 78    };
      const tnx  = tnxData  ?? { price: 4.3,   prev: 4.3   };

      const payload = {
        dxy:  dxy.price,  dxyChg:  pctChange(dxy.price,  dxy.prev),
        vix:  vix.price,  vixChg:  pctChange(vix.price,  vix.prev),
        gold: gold.price, goldChg: pctChange(gold.price, gold.prev),
        oil:  oil.price,  oilChg:  pctChange(oil.price,  oil.prev),
        tnx:  tnx.price,  tnxChg:  pctChange(tnx.price,  tnx.prev),
        goldOilRatio: gold.price / oil.price,
      };

      const prompt = buildMacroPrompt(payload);

      const aiRes = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
        body: JSON.stringify({
          model: 'grok-4.3',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 600,
        }),
      });

      if (!aiRes.ok) {
        const err = await aiRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? 'AI error');
      }

      const aiData = await aiRes.json();
      const analysis: string = aiData.choices?.[0]?.message?.content ?? '';

      return { ...payload, analysis, missingData: missing };
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Request failed' }, { status: 502 });
  }
}
