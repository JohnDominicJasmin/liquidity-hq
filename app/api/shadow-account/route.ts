import { NextRequest, NextResponse } from 'next/server';
import { xaiFetch } from '@/lib/xai';
import { recordAiCall } from '@/lib/aiCallLog';
import { T } from '@/lib/tables';
import { incrementToolUsage, rateLimitMessage, refundToolUsage, todayUtc, blockedResponse } from '@/lib/aiUsage';
import { requireProPlan, hasProFeatures } from '@/lib/entitlements';
import { getUserCompatForBilledCall } from '@/lib/authUser';
import { userClient } from '@/lib/supabase-user';
import { apiError } from '@/lib/apiError';
import { answerWasCutOff } from '@/lib/xaiAnswer';
import { SHADOW_NO_PICK_TEXT } from '@/lib/shadowStrategy';
import { bearerToken } from '@/lib/bearerToken';

const GROK_KEY = process.env.GROK_API_KEY ?? '';

/* The "shadow strategy" keeps only the best trade types of the SAME trades it is scored on: in-sample, picked with hindsight (#1631, audit
   2026-11-16). At the old floor a type of 1-2 trades could be "best" by luck, so a type now needs this many closed trades to be kept, and the
   section says it describes past trades. */
const SHADOW_MIN_TRADES_PER_TYPE = 10;

function sb(token: string) {
  return userClient(token);
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
    'You are a trading coach and quantitative analyst specializing in crypto derivatives. Analyze this trader\'s most recent trades (your last 500 trades at most) and produce a Shadow Account report.',
    '',
    `TRADES (your last 500 at most): ${trades.length} | CLOSED: ${closed.length} | WIN RATE: ${winRate}% | AVG R/TRADE: ${avgR}R | TOTAL P&L: $${totalPnL.toFixed(2)}`,
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
    `3. SHADOW_STRATEGY - Recompute the stats over ONLY the trade types that did best above, keeping a trade type only if it has at least ${SHADOW_MIN_TRADES_PER_TYPE} closed trades. Format: "Shadow Win Rate: X% (actual: Y%) | Shadow Avg R: X (actual: Y) | Trades kept: N of N closed". The trade types were picked from these same trades after the fact, so this describes past trades; it is not a forecast and not a tested strategy. Say that in one plain sentence. If no trade type has ${SHADOW_MIN_TRADES_PER_TYPE} closed trades, write "${SHADOW_NO_PICK_TEXT}" and nothing else.`,
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
  const token = bearerToken(req.headers);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: authData } = await getUserCompatForBilledCall(token);
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Pro-only. /upgrade sells the one-shot AI tools as a Pro feature
  // (UPGRADE_PRO_FEATURE_TOOL_POOL); this route is one of them. Without this
  // check a free account could still spend real xAI budget here, which is
  // what the pricing page says it cannot. Trial users pass - hasProFeatures
  // covers isTrial.
  const plan = await requireProPlan(token, authData.user.id, 'Shadow Account is a Pro feature.');
  if (!plan.ok) return plan.response;

  if (!GROK_KEY) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });

  /* THE NEWEST 500, NOT THE OLDEST (PM audit B7). This read ascending with limit 500, so a trader with more than 500 trades was analysed on their
     FIRST 500 and the prompt called that their history. Newest first, then turned back into chronological order for the prompt. */
  const { data: newestFirst, error } = await sb(token)
    .from(T.trades)
    .select('*')
    .eq('user_id', authData.user.id)
    .order('created_at', { ascending: false })
    .limit(500);
  const trades = newestFirst ? [...newestFirst].reverse() : newestFirst;

  if (error) return NextResponse.json({ error: 'Failed to load trades' }, { status: 500 });
  if (!trades || trades.length === 0) return NextResponse.json({ error: 'NO_TRADES' }, { status: 400 });

  const closed = trades.filter(t => t.result !== 'OPEN');
  if (closed.length < 5) return NextResponse.json({ error: 'NEED_MORE_TRADES', count: closed.length }, { status: 400 });

  /* RESERVE ONLY ONCE THERE IS SOMETHING TO ANALYSE (U2). It used to reserve before the trades were loaded, so a read error, no trades or fewer than 5 closed trades (all answered without an AI call) still cost a use AND a
     slot of the shared tool pool, repeatably up to the cap. A reserved use is given back when nothing reached the user (a failed or unusable xAI answer, a thrown call, an empty answer), exactly as /api/grok does; nothing is given back once xAI answered 2xx (the tokens are billed). */
  const role = plan.tier;
  const reservedOn = todayUtc();
  const usageResult = await incrementToolUsage(authData.user.id, 'shadowAccount', role, reservedOn);
  if (usageResult.blocked) {
    return blockedResponse(usageResult.reason, rateLimitMessage(usageResult.reason, usageResult.limit, 'Shadow Account reports'));
  }

  const prompt = buildShadowPrompt(trades);

  const res = await xaiFetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
    body: JSON.stringify({
      model: 'grok-4.3',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1500,
    }),
    /* A network throw used to escape as a bare 500 with the use kept (#1631). It is given back, and answered like a non-2xx. */
  }).catch((e: unknown) => e instanceof Error ? e : new Error(String(e)));

  if (res instanceof Error) {
    await refundToolUsage(authData.user.id, 'shadowAccount', reservedOn);
    return apiError('shadow-account', res, 502, 'AI service error');
  }
  if (!res.ok) {
    await refundToolUsage(authData.user.id, 'shadowAccount', reservedOn);
    const err = await res.json().catch(() => ({})) as { error?: string };
    /* The provider's own error text is logged, never shown (#1631), as on the other AI tool routes. */
    return apiError('shadow-account', err.error ?? 'upstream AI error', 502, 'AI service error');
  }

  const data = await res.json();
  await recordAiCall({ userId: authData.user.id, callType: 'shadow_account', model: data.model ?? 'grok-4.3', usage: data.usage });
  const text: string = data.choices?.[0]?.message?.content ?? '';
  /* An empty or cut-off answer is not a report (#1631), as on thesis-check, strategy-research and pine-script: the use is given back. */
  if (!text.trim() || answerWasCutOff(data)) {
    /* "Nothing was charged" only when the refund landed (it allows 3 a day, U9). */
    const refunded = (await refundToolUsage(authData.user.id, 'shadowAccount', reservedOn)) !== null;
    return NextResponse.json({ error: refunded ? 'The AI answer was incomplete. Nothing was charged. Try again.' : 'The AI answer was incomplete. Try again.', code: 'AI_INCOMPLETE', refunded }, { status: 502 });
  }

  return NextResponse.json({ analysis: text, tradeCount: closed.length });
}
