/**
 * Server-side proxy for the free-form Grok Chat component.
 * Requires valid Supabase session token - keeps GROK_API_KEY off the client.
 *
 * POST /api/grok-chat
 *   { mode: 'chat',   context, messages, minimal?, max_tokens? }  → /v1/chat/completions (no tools)
 *   { mode: 'search', context, messages, minimal? }               → /v1/responses        (live web + X search)
 *   → { text, followUps, citations, _usage }   (#1631 E: the answer only, never xAI's raw JSON)
 *
 * `context` is market DATA for one tracked coin and `messages` the user/assistant turns; the system prompt is built here from them
 * (lib/chatPrompt.ts). Model, tools and the token ceiling are pinned server-side.
 *
 * Daily limits live in lib/limits.ts (AI_LIMITS[role].chat / .search) - the
 * enforced source of truth. Deliberately not restated here: this docblock
 * used to hardcode them and silently went stale across two separate
 * repricings before anyone noticed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { xaiFetch } from '@/lib/xai';
import { recordAiCall } from '@/lib/aiCallLog';
import { T } from '@/lib/tables';
import { getUsageTier } from '@/lib/entitlements';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { AI_LIMITS } from '@/lib/limits';
import { incrementUsageColumn, rateLimitMessage, todayUtc } from '@/lib/aiUsage';
import { apiError } from '@/lib/apiError';
import { clampMaxTokens } from '@/lib/grokTokenClamp';
import { getUserCompat, getUserCompatForBilledCall } from '@/lib/authUser';
import { userClient } from '@/lib/supabase-user';
import { buildChatSystemPrompt, parseChatContext, parseChatHistory, splitFollowUps } from '@/lib/chatPrompt';
import { answerText, searchCitations, searchTools, searchWindow } from '@/lib/xaiAnswer';

const GROK_KEY = process.env.GROK_API_KEY ?? '';

// Pinned server-side, never taken from the client. `...payload` used to go
// straight into the xAI request body, so an authenticated caller within their
// own daily call COUNT could still pick an arbitrary model or max_tokens - the
// cap here counts requests, not tokens or dollars, so one allowed call had no
// real ceiling on what it could cost. The real client (components/GrokChat.tsx)
// only ever sends this exact model and max_tokens of 100 or 600, so nothing
// legitimate changes.
const MODEL = 'grok-4.3';
// The only tools the product's search mode ever offers - pinned rather than
// forwarded, so a caller cannot substitute a pricier or unintended tool.
// #1651 item 1: X is searched over the last 7 days, today included. Wider than
// Deep's 2 because a chat question can be about the week ("why did ETH dump
// on Monday?"); still bounded, so a months-old post cannot pass as news.
const CHAT_X_DAYS = 7;

function sb(token: string) {
  return userClient(token);
}

async function getUsageRow(token: string, userId: string, today: string) {
  const { data } = await sb(token).from(T.grok_usage)
    .select('chat_count, chat_search_count')
    .eq('user_id', userId)
    .eq('date', today)
    .maybeSingle();
  return { chatUsed: data?.chat_count ?? 0, searchUsed: data?.chat_search_count ?? 0 };
}

export async function GET(req: NextRequest) {
  if (!GROK_KEY) return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  if (!(await isFeatureEnabled('grok'))) return NextResponse.json({ error: 'LiquidityAI is temporarily unavailable.', code: 'FEATURE_DISABLED' }, { status: 503 });
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Auth required' }, { status: 401 });
  const { data: userData } = await getUserCompat(token);
  if (!userData.user) return NextResponse.json({ error: 'Auth required' }, { status: 401 });
  const userId = userData.user.id;
  const today = todayUtc();
  const [{ chatUsed, searchUsed }, role] = await Promise.all([
    getUsageRow(token, userId, today),
    getUsageTier(token, userId),
  ]);
  const chatLimit   = AI_LIMITS[role].chat;
  const searchLimit = AI_LIMITS[role].search;
  return NextResponse.json({ chat_used: chatUsed, chat_limit: chatLimit, search_used: searchUsed, search_limit: searchLimit });
}

export async function POST(req: NextRequest) {
  if (!GROK_KEY) {
    return NextResponse.json({ error: 'Grok API not configured' }, { status: 503 });
  }
  if (!(await isFeatureEnabled('grok'))) {
    return NextResponse.json({ error: 'LiquidityAI is temporarily unavailable.', code: 'FEATURE_DISABLED' }, { status: 503 });
  }

  /* ── Auth check ── */
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return NextResponse.json({ error: 'Sign in required', code: 'AUTH_REQUIRED' }, { status: 401 });
  }
  const { data: userData } = await getUserCompatForBilledCall(token);
  if (!userData.user) {
    return NextResponse.json({ error: 'Sign in required', code: 'AUTH_REQUIRED' }, { status: 401 });
  }
  const userId = userData.user.id;

  /* ── Parse body ── */
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  /* #1631 E: the browser sends DATA (context) and the conversation; the system prompt is written HERE (lib/chatPrompt.ts). A system turn
     from the caller is never forwarded, and the coin is checked against the coins this app tracks. */
  const mode = body.mode;
  if (mode !== 'chat' && mode !== 'search') return NextResponse.json({ error: `Unknown mode: ${String(mode)}` }, { status: 400 });
  const isSearch = mode === 'search';
  const ctx = parseChatContext(body.context);
  if (!ctx) return NextResponse.json({ error: 'context.coin must be a coin this app tracks' }, { status: 400 });
  const history = parseChatHistory(body.messages);
  if (!history) return NextResponse.json({ error: 'messages must end with the trader\'s question' }, { status: 400 });
  const messages = [{ role: 'system', content: buildChatSystemPrompt(ctx, { search: isSearch, minimal: body.minimal === true }) }, ...history];

  /* ── Rate limit check ── */
  const today = todayUtc();
  const [{ chatUsed, searchUsed }, role] = await Promise.all([
    getUsageRow(token, userId, today),
    getUsageTier(token, userId),
  ]);

  const chatLimit   = AI_LIMITS[role].chat;
  const searchLimit = AI_LIMITS[role].search;

  // Atomic check-and-increment (reserve before spending on xAI) - closes the
  // TOCTOU race the old read-then-upsert pattern had between concurrent requests.
  const column = isSearch ? 'chat_search_count' : 'chat_count';
  const limit  = isSearch ? searchLimit : chatLimit;
  const usageResult = await incrementUsageColumn(userId, role, column, limit);
  if (usageResult.blocked) {
    const label = isSearch ? 'live search messages' : 'chat messages';
    return NextResponse.json(
      {
        error: rateLimitMessage(usageResult.reason, limit, label),
        code: 'RATE_LIMIT',
        usage: { chat_used: chatUsed, chat_limit: chatLimit, search_used: searchUsed, search_limit: searchLimit },
      },
      { status: 429 }
    );
  }

  /* ── Call xAI ── */
  const xWindow = searchWindow(CHAT_X_DAYS);
  try {
    let data: unknown;
    let status: number;

    if (isSearch) {
      // The conversation is the only caller input - model and tools are pinned above.
      const r = await xaiFetch('https://api.x.ai/v1/responses', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
        /* max_output_tokens for the same reason the chat branch below clamps max_tokens, and it was missing
           on the MORE expensive of the two: this is the branch that carries web and X search. Same figure as
           app/api/grok/route.ts:258, the app's other /v1/responses call. */
        body:    JSON.stringify({ model: MODEL, input: messages, tools: searchTools(xWindow), max_output_tokens: 2000 }),
      });
      data   = await r.json();
      status = r.status;
    } else {
      // Model pinned; max_tokens clamped rather than trusted, so a modified client can shrink it but never raise it past the ceiling.
      const maxTokens = clampMaxTokens(body.max_tokens);
      const r = await xaiFetch('https://api.x.ai/v1/chat/completions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
        body:    JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens }),
      });
      data   = await r.json();
      status = r.status;
    }

    if (status >= 200 && status < 300) {
      const raw = data as { usage?: unknown; model?: string } | null;
      await recordAiCall({ userId, callType: isSearch ? 'chat_search' : 'chat', model: raw?.model ?? MODEL, usage: raw?.usage });
      const newChat   = isSearch ? chatUsed   : usageResult.count;
      const newSearch = isSearch ? usageResult.count : searchUsed;
      /* #1631 E: only the answer, its follow-up questions, any search citations and the usage reach the browser - not xAI's raw JSON
         (reasoning_content, model name, system_fingerprint, cost ticks). */
      const { text, followUps } = splitFollowUps(answerText(data, isSearch));
      return NextResponse.json({
        text: text || '(no response)',
        followUps,
        citations: isSearch ? searchCitations(data, xWindow) : [],
        _usage: { chat_used: newChat, chat_limit: chatLimit, search_used: newSearch, search_limit: searchLimit },
      }, { status });
    }

    // xAI refused: say so generically. Its error body is not passed through.
    return apiError('grok-chat', new Error(`xAI answered ${status}`), 502, 'AI service error');
  } catch (e) {
    return apiError('grok-chat', e, 500, 'AI service error');
  }
}
