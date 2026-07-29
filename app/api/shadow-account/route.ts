import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { T } from '@/lib/tables';
import { incrementToolUsage, rateLimitMessage } from '@/lib/aiUsage';
import { getUserRole } from '@/lib/entitlements';

const GROK_KEY = process.env.GROK_API_KEY ?? '';

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function buildShadowPrompt(trades: Record<string, unknown>[]): string {
  const closed = trades.filter(t => t.result !== 'OPEN');
  const wins = closed.filter(t => t.result === 'WIN').length;
  const winRate = closed.length ? ((wins / closed.length) * 100).toFixed(1) : '0';
  const totalPnL = closed.reduce((s, t) => s + ((t.pnl_usd as number) ?? 0), 0);
  const rTrades = closed.filter(t => t.pnl_r != null);
  const avgR = rTrades.length
    ? (rTrades.reduce((s, t) => s + ((t.pnl_r as number) ?? 0), 0) / rTrades.length).toFixed(2)
    : '0';

  const tradeLines = closed.map(t => [
    `Date: ${(t.created_at as string)?.slice(0, 10) ?? '-'}`,
    `Coin: ${(t.coin as string)?.toUpperCase()}`,
    `Direction: ${t.direction}`,
    `Setup: ${t.setup_type}`,
    `Entry: $${t.entry_price}`,
    `Exit: ${t.exit_price != null ? '$' + t.exit_price : '-'}`,
    `SL: $${t.stop_loss}`,
    `Leverage: ${t.leverage ?? 1}x`,
    `Result: ${t.result}`,
    `P&L: ${t.pnl_usd != null ? '$' + (t.pnl_usd as number).toFixed(2) : '-'}`,
    `R: ${t.pnl_r != null ? (t.pnl_r as number).toFixed(2) + 'R' : '-'}`,
    `Session: ${t.session ?? '-'}`,
    t.notes ? `Notes: ${t.notes}` : '',
  ].filter(Boolean).join(' | ')).join('\n');

  return [
    'You are a trading coach and quantitative analyst specializing in crypto derivatives. Analyze this trader\'s complete trade history and produce a Shadow Account report.',
    '',
    `TOTAL TRADES: ${trades.length} | CLOSED: ${closed.length} | WIN RATE: ${winRate}% | AVG R/TRADE: ${avgR}R | TOTAL P&L: $${totalPnL.toFixed(2)}`,
    '',
    '=== TRADE HISTORY (closed trades only) ===',
    tradeLines,
    '',
    '=== ANALYSIS TASKS ===',
    '',
    '1. IMPLICIT_RULES - Extract the actual entry/exit rules this trader appears to follow from their data. Look at: which coins they trade most, direction bias, preferred setups, typical leverage, how often they hit TP vs SL. Be specific ("Only longs BTC and ETH, avoids altcoins" not "trades crypto").',
    '',
    '2. BEHAVIORAL_PATTERNS - Identify performance patterns with specific numbers:',
    '   - Best and worst coin/direction combos (include win rate and trade count)',
    '   - Best and worst setup types (include win rate)',
    '   - Session performance if data shows it',
    '   - Leverage vs outcome correlation',
    '   - Any patterns visible in the notes field',
    '',
    '3. SHADOW_STRATEGY - If this trader had ONLY taken their statistically best-performing trade types (as identified above), estimate their shadow stats. Format: "Shadow Win Rate: X% (actual: Y%) | Shadow Avg R: X (actual: Y) | Trades kept: N of N closed".',
    '',
    '4. RULE_VIOLATIONS - Name 3-5 specific trades (by date + coin) that broke the trader\'s own implied best rules. Explain what rule was broken.',
    '',
    '5. RECOMMENDATIONS - Give exactly 5 specific, data-backed improvements. Each must cite actual numbers from the trade history. Bad example: "Improve risk management." Good example: "Stop taking SHORT trades on SOL - 0 wins from 4 attempts (0% WR, -3.2R total). Your SOL LONG win rate is 67%. Direction flip alone would have saved 3.2R."',
    '',
    '6. KEY_INSIGHT - One sentence: the single most important finding from this data that would most improve this trader\'s results.',
    '',
    'Output using EXACTLY these headers (no markdown bold, no extra text before or after):',
    'IMPLICIT_RULES:',
    '[bullet list, one per line starting with -]',
    'BEHAVIORAL_PATTERNS:',
    '[bullet list with specific stats]',
    'SHADOW_STRATEGY:',
    '[shadow stats comparison]',
    'RULE_VIOLATIONS:',
    '[specific examples]',
    'RECOMMENDATIONS:',
    '[numbered 1-5, data-backed]',
    'KEY_INSIGHT:',
    '[one sentence]',
  ].join('\n');
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: authData } = await sb(token).auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!GROK_KEY) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });

  const role = await getUserRole(token, authData.user.id);
  const usageResult = await incrementToolUsage(authData.user.id, 'shadowAccount', role);
  if (usageResult.blocked) {
    return NextResponse.json(
      { error: rateLimitMessage(usageResult.reason, usageResult.limit, 'Shadow Account reports'), code: 'RATE_LIMIT' },
      { status: 429 },
    );
  }

  const { data: trades, error } = await sb(token)
    .from(T.trades)
    .select('*')
    .eq('user_id', authData.user.id)
    .order('created_at', { ascending: true })
    .limit(500);

  if (error) return NextResponse.json({ error: 'Failed to load trades' }, { status: 500 });
  if (!trades || trades.length === 0) return NextResponse.json({ error: 'NO_TRADES' }, { status: 400 });

  const closed = trades.filter(t => t.result !== 'OPEN');
  if (closed.length < 5) return NextResponse.json({ error: 'NEED_MORE_TRADES', count: closed.length }, { status: 400 });

  const prompt = buildShadowPrompt(trades);

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
    body: JSON.stringify({
      model: 'grok-4.3',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1500,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json({ error: (err as { error?: string }).error ?? 'AI error' }, { status: 502 });
  }

  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? '';

  return NextResponse.json({ analysis: text, tradeCount: closed.length });
}
