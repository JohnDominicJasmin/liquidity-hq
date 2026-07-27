import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { createClient } from '@supabase/supabase-js';
import { cached } from '@/lib/apiCache';
import { hasProFeatures, getUserRole } from '@/lib/entitlements';
import { incrementToolUsage, rateLimitMessage, type UsageBlockReason } from '@/lib/aiUsage';

const GROK_KEY = process.env.GROK_API_KEY ?? '';
// DXY/VIX/gold/oil/10Y don't meaningfully shift within a few minutes - cache
// across visitors instead of hitting Yahoo Finance + Grok on every page load.
const CACHE_TTL = 5 * 60_000;

class RateLimitError extends Error {
  constructor(public limit: number, reason: UsageBlockReason) {
    super(rateLimitMessage(reason, limit, 'macro context checks'));
  }
}

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
}

interface YFMeta { regularMarketPrice: number; previousClose: number; shortName?: string }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Was silently swallowing every failure into a bare `null`, with no record
// of WHY - found live on Render (both prod and dev) that DXY always
// succeeds while VIX/Gold/Oil/10Y consistently fail for hours at a time,
// even though every one of these symbols returns 200 fine when hit
// directly (not from Render). All 5 firing as one Promise.all burst is the
// likely cause - Yahoo's undocumented chart endpoint reads that as
// bot-like from a single server IP. One retry after a short random delay
// gives a throttled request a second, staggered chance; logging the real
// status/error means the NEXT occurrence is diagnosable (via Render logs
// and now GlitchTip - see lib/apiError.ts) instead of just "could not fetch".
// `symbol` arrives ALREADY percent-encoded from the call site below
// ('%5EVIX', 'GC%3DF', etc.) - do not encodeURIComponent() it again here.
// That double-encoding (%5E -> %255E) is the actual root cause found live:
// Yahoo correctly 404s "may be delisted" for a symbol name that doesn't
// exist, which %255EVIX isn't. DX-Y.NYB has no special characters, so
// double-encoding was a no-op for it alone - exactly why it was the only
// one of the 5 that ever worked.
async function fetchYFOnce(symbol: string): Promise<{ price: number; prev: number } | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=2d&interval=1d`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`YF ${symbol}: HTTP ${res.status} - ${body.slice(0, 200)}`);
  }
  const data = await res.json() as { chart?: { result?: Array<{ meta?: YFMeta }> } };
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) throw new Error(`YF ${symbol}: no regularMarketPrice in response`);
  return { price: meta.regularMarketPrice, prev: meta.previousClose };
}

async function fetchYF(symbol: string, initialDelayMs = 0): Promise<{ price: number; prev: number } | null> {
  if (initialDelayMs > 0) await sleep(initialDelayMs);
  try {
    return await fetchYFOnce(symbol);
  } catch (e1) {
    console.error(`[macro-context] first attempt failed: ${e1 instanceof Error ? e1.message : String(e1)}`);
    await sleep(400 + Math.random() * 400);
    try {
      return await fetchYFOnce(symbol);
    } catch (e2) {
      console.error(`[macro-context] retry also failed: ${e2 instanceof Error ? e2.message : String(e2)}`);
      return null;
    }
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
  // reached by skipping the client gate. Trial users count as Pro here: the
  // route is cached across all visitors, so granting it during the trial adds
  // ~no marginal cost while showcasing a headline Pro feature.
  if (!(await hasProFeatures(token, authData.user.id))) {
    return NextResponse.json({ error: 'PRO_REQUIRED', message: 'Global macro context is a Pro feature.' }, { status: 403 });
  }

  if (!GROK_KEY) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });

  try {
    const result = await cached('macro-context', CACHE_TTL, async () => {
      // Only the cache-miss path actually spends on xAI, so only it needs the
      // daily cap - a cache hit stays free for everyone (same pattern as
      // token-unlock/smc-snapshot).
      const role = await getUserRole(token, authData.user.id);
      const usageResult = await incrementToolUsage(token, authData.user.id, 'macroContext', role);
      if (usageResult.blocked) {
        throw new RateLimitError(usageResult.limit, usageResult.reason);
      }

      // Staggered, not a single Promise.all burst - see fetchYF's comment.
      const [dxyData, vixData, goldData, oilData, tnxData] = await Promise.all([
        fetchYF('DX-Y.NYB',   0),
        fetchYF('%5EVIX',   120),
        fetchYF('GC%3DF',   240),
        fetchYF('CL%3DF',   360),
        fetchYF('%5ETNX',   480),
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
    if (e instanceof RateLimitError) {
      return NextResponse.json({ error: e.message, code: 'RATE_LIMIT' }, { status: 429 });
    }
    return apiError('macro-context', e, 502, 'Request failed');
  }
}
