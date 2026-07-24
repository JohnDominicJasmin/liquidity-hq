import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { T } from '@/lib/tables';
import { incrementToolUsage } from '@/lib/aiUsage';
import { getUserRole } from '@/lib/entitlements';
import { AI_LIMITS } from '@/lib/limits';

const GROK_KEY = process.env.GROK_API_KEY ?? '';

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
}

function buildBiasPrompt(trades: Record<string, unknown>[]): string {
  const closed = trades.filter(t => t.result !== 'OPEN');

  const wins   = closed.filter(t => t.result === 'WIN');
  const losses = closed.filter(t => t.result === 'LOSS');

  const avgWinUsd  = wins.length
    ? wins.reduce((s, t) => s + ((t.pnl_usd as number) ?? 0), 0) / wins.length
    : 0;
  const avgLossUsd = losses.length
    ? Math.abs(losses.reduce((s, t) => s + ((t.pnl_usd as number) ?? 0), 0) / losses.length)
    : 0;
  const avgWinR    = wins.filter(t => t.pnl_r != null).length
    ? wins.reduce((s, t) => s + ((t.pnl_r as number) ?? 0), 0) / wins.filter(t => t.pnl_r != null).length
    : 0;
  const avgLossR   = losses.filter(t => t.pnl_r != null).length
    ? Math.abs(losses.reduce((s, t) => s + ((t.pnl_r as number) ?? 0), 0) / losses.filter(t => t.pnl_r != null).length)
    : 0;

  // Round-number stop detection
  const roundStops = closed.filter(t => {
    const sl = parseFloat(String(t.stop_loss ?? ''));
    return !isNaN(sl) && sl % 100 === 0;
  }).length;

  // Consecutive trades (same-day, potential revenge trading)
  const sortedByDate = [...closed].sort((a, b) =>
    new Date(a.created_at as string).getTime() - new Date(b.created_at as string).getTime(),
  );
  const revengeCount = sortedByDate.filter((t, i) => {
    if (i === 0) return false;
    const prev = sortedByDate[i - 1];
    const sameDay = (t.created_at as string)?.slice(0, 10) === (prev.created_at as string)?.slice(0, 10);
    const prevWasLoss = prev.result === 'LOSS';
    return sameDay && prevWasLoss;
  }).length;

  const tradeLines = closed.map(t => [
    `Date: ${(t.created_at as string)?.slice(0, 10) ?? '-'}`,
    `Coin: ${(t.coin as string)?.toUpperCase()}`,
    `Direction: ${t.direction}`,
    `Setup: ${t.setup_type}`,
    `Entry: $${t.entry_price}`,
    `SL: $${t.stop_loss}`,
    `Exit: ${t.exit_price != null ? '$' + t.exit_price : '-'}`,
    `Leverage: ${t.leverage ?? 1}x`,
    `Result: ${t.result}`,
    `P&L USD: ${t.pnl_usd != null ? '$' + (t.pnl_usd as number).toFixed(2) : '-'}`,
    `R: ${t.pnl_r != null ? (t.pnl_r as number).toFixed(2) + 'R' : '-'}`,
    t.notes ? `Notes: ${t.notes}` : '',
  ].filter(Boolean).join(' | ')).join('\n');

  return [
    'You are a trading psychology specialist. Analyze this crypto trader\'s history specifically for cognitive and behavioral biases. Be brutal and specific - use actual trade dates and coins as evidence.',
    '',
    `SUMMARY STATS: ${closed.length} closed trades | ${wins.length} wins | ${losses.length} losses`,
    `Avg win: $${avgWinUsd.toFixed(2)} (${avgWinR.toFixed(2)}R) | Avg loss: $${avgLossUsd.toFixed(2)} (${avgLossR.toFixed(2)}R)`,
    `Round-number stop losses: ${roundStops} trades | Same-day trades after a loss: ${revengeCount}`,
    '',
    '=== TRADE LOG ===',
    tradeLines,
    '',
    '=== BIAS ANALYSIS TASKS ===',
    '',
    '1. DISPOSITION_EFFECT - Does this trader hold losers too long and cut winners too early?',
    '   - Compare average win R vs average loss R. If avg loss R > avg win R, this is classic disposition.',
    '   - Cite 2-3 specific trades where the loss was outsized vs typical win size.',
    '   - Estimate total P&L lost to this bias (rough $USD impact).',
    '',
    '2. OVERTRADING - Does the trader overtrade, especially after losses?',
    `   - There are ${revengeCount} trades placed on the same day as a previous losing trade.`,
    '   - Name specific dates with multiple trades and show whether they were worse than average.',
    '   - Identify if there are concentrated losing streaks from rapid re-entry.',
    '',
    '3. MOMENTUM_CHASING - Does the trader chase moves after they\'ve already happened?',
    '   - Look at setup_type: are there late Breakout entries or longs after existing bullish setups?',
    '   - Look at notes for any "FOMO", "already moving", or similar language.',
    '   - Identify any pattern of entering after a gap or very fast move.',
    '',
    '4. ANCHORING_BIAS - Is the trader anchored to round numbers or entry price for risk management?',
    `   - ${roundStops} stop losses are at round $100 numbers. Flag specific ones.`,
    '   - Are take-profits or targets placed at psychologically round numbers?',
    '   - Does the trader\'s stop loss placement appear based on $ amounts rather than price structure?',
    '',
    '5. PNL_IMPACT - For each bias found, estimate the dollar P&L drag. Which bias is costing the most?',
    '   Format: "Estimated bias drag: [Disposition Effect: -$X] [Overtrading: -$Y] [Momentum Chasing: -$Z] [Anchoring: -$W]"',
    '',
    '6. PRIORITY_FIX - The one behavioral fix that would most improve results. Specific and actionable.',
    '',
    'Output using EXACTLY these headers (no markdown bold, no extra text before each header):',
    'DISPOSITION_EFFECT:',
    '[analysis + specific examples]',
    'OVERTRADING:',
    '[analysis + specific examples]',
    'MOMENTUM_CHASING:',
    '[analysis + specific examples]',
    'ANCHORING_BIAS:',
    '[analysis + specific examples]',
    'PNL_IMPACT:',
    '[estimated drag per bias + total]',
    'PRIORITY_FIX:',
    '[the single highest-impact behavioral change with specific instructions]',
  ].join('\n');
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: authData } = await sb(token).auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!GROK_KEY) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });

  const role = await getUserRole(token, authData.user.id);
  const limit = AI_LIMITS[role].behavioralBias;
  const newCount = await incrementToolUsage(token, authData.user.id, 'behavioralBias', limit);
  if (newCount === null) {
    return NextResponse.json(
      { error: `Daily limit of ${limit} bias reports reached.`, code: 'RATE_LIMIT' },
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

  const closed = trades.filter((t: Record<string, unknown>) => t.result !== 'OPEN');
  if (closed.length < 5) return NextResponse.json({ error: 'NEED_MORE_TRADES', count: closed.length }, { status: 400 });

  const prompt = buildBiasPrompt(trades as Record<string, unknown>[]);

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
    body: JSON.stringify({
      model: 'grok-4.3',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1400,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    return NextResponse.json({ error: err.error ?? 'AI error' }, { status: 502 });
  }

  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? '';

  return NextResponse.json({ analysis: text, tradeCount: closed.length });
}
