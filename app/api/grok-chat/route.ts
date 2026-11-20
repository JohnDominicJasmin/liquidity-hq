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
import { getUsageTierStatus, getPlanSnapshot } from '@/lib/entitlements';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { AI_LIMITS, type UsageTier } from '@/lib/limits';
import { incrementUsageColumn, rateLimitMessage, refundUsageColumn, todayUtc, blockedResponse } from '@/lib/aiUsage';
import { apiError } from '@/lib/apiError';
import { clampMaxTokens } from '@/lib/grokTokenClamp';
import { getUserCompat, getUserCompatForBilledCall } from '@/lib/authUser';
import { userClient } from '@/lib/supabase-user';
import { buildChatSystemPrompt, capChatSelection, parseChatContext, parseChatHistory, splitFollowUps } from '@/lib/chatPrompt';
import { answerText, searchCitations, searchTools, searchWindow } from '@/lib/xaiAnswer';
import { bearerToken } from '@/lib/bearerToken';

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

/* A FAILED USAGE READ IS UNKNOWN, NOT ZERO (PM route audit, 2026-11-20): `strict` makes a database error throw, so the usage GET answers 503 instead of 200 with every count at 0, which showed a user with no uses spent a full allowance and (for a user at the cap) a false zero. Only the GET asks for it; the POST paths keep reading the row as before. */
async function getUsageRow(token: string, userId: string, today: string, strict = false) {
  const { data, error } = await sb(token).from(T.grok_usage)
    .select('chat_count, chat_search_count')
    .eq('user_id', userId)
    .eq('date', today)
    .maybeSingle();
  if (strict && error) throw new Error(`usage read failed: ${error.message}`);
  return { chatUsed: data?.chat_count ?? 0, searchUsed: data?.chat_search_count ?? 0 };
}

export async function GET(req: NextRequest) {
  if (!GROK_KEY) return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  if (!(await isFeatureEnabled('grok'))) return NextResponse.json({ error: 'LiquidityAI is temporarily unavailable.', code: 'FEATURE_DISABLED' }, { status: 503 });
  const token = bearerToken(req.headers);
  if (!token) return NextResponse.json({ error: 'Auth required' }, { status: 401 });
  const { data: userData } = await getUserCompat(token);
  if (!userData.user) return NextResponse.json({ error: 'Auth required' }, { status: 401 });
  const userId = userData.user.id;
  const today = todayUtc();
  let usageRead: Awaited<ReturnType<typeof getUsageRow>>, plan: Awaited<ReturnType<typeof getUsageTierStatus>>;
  try {
    [usageRead, plan] = await Promise.all([
      getUsageRow(token, userId, today, true),
      getUsageTierStatus(token, userId),
    ]);
  } catch (e) {
    console.error('/api/grok-chat GET usage unavailable:', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: 'USAGE_UNAVAILABLE' }, { status: 503 });
  }
  const { chatUsed, searchUsed } = usageRead;
  /* U7: an UNKNOWN plan is never billed against the Free cap. Every plan may chat, so it proceeds against the Pro count cap with the dollar cap failing closed, exactly as POST /api/grok does (#2412). */
  const role: UsageTier = plan.failed ? 'pro' : plan.tier;
  const chatLimit   = AI_LIMITS[role].chat;
  const searchLimit = AI_LIMITS[role].search;
  return NextResponse.json({ chat_used: chatUsed, chat_limit: chatLimit, search_used: searchUsed, search_limit: searchLimit });
}

export async function POST(req: NextRequest) {
  if (!GROK_KEY) {
    return NextResponse.json({ error: 'AI is not configured' }, { status: 503 });
  }
  if (!(await isFeatureEnabled('grok'))) {
    return NextResponse.json({ error: 'LiquidityAI is temporarily unavailable.', code: 'FEATURE_DISABLED' }, { status: 503 });
  }

  /* ── Auth check ── */
  const token = bearerToken(req.headers);
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

  /* ── Rate limit check ── */
  const today = todayUtc();
  const [{ chatUsed, searchUsed }, plan] = await Promise.all([
    getUsageRow(token, userId, today),
    getPlanSnapshot(token, userId),
  ]);
  /* U7: an UNKNOWN plan is never billed against the Free cap. Every plan may chat, so it proceeds against the Pro count cap with the dollar cap failing closed, exactly as POST /api/grok does (#2412). */
  const role: UsageTier = plan.failed ? 'pro' : plan.tier;

  const chatLimit   = AI_LIMITS[role].chat;
  const searchLimit = AI_LIMITS[role].search;

  /* The system prompt is written AFTER the plan read: the indicators the trader "is weighing" come from the browser, so a plan the server KNOWS is not entitled names only the first one (Free is one at a time).
     An unknown or failed plan read leaves it as sent. */
  const messages = [{ role: 'system', content: buildChatSystemPrompt({ ...ctx, selection: capChatSelection(ctx.selection, plan.status === 'not_entitled') }, { search: isSearch, minimal: body.minimal === true }) }, ...history];

  // Atomic check-and-increment (reserve before spending on xAI) - closes the
  // TOCTOU race the old read-then-upsert pattern had between concurrent requests.
  const column = isSearch ? 'chat_search_count' : 'chat_count';
  const limit  = isSearch ? searchLimit : chatLimit;
  const usageResult = await incrementUsageColumn(userId, role, column, limit, null, plan.failed);
  if (usageResult.blocked) {
    const label = isSearch ? 'live search messages' : 'chat messages';
    return blockedResponse(usageResult.reason, rateLimitMessage(usageResult.reason, limit, label), {
      usage: { chat_used: chatUsed, chat_limit: chatLimit, search_used: searchUsed, search_limit: searchLimit },
    });
  }

  /* ── Call xAI ── */
  /* A reserved use is given back when nothing reached the user (a failed or unusable xAI answer, a thrown call, an empty answer), exactly as /api/grok does; nothing is given back once xAI answered 2xx (the tokens are billed). (U1: this route charged on every failure path and refunded none.) `today` was captured BEFORE the reservation, so a refund credits the row that paid. */
  let billed = false;
  const giveBack = () => refundUsageColumn(userId, column, today);
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
      billed = true;   // 2xx: the tokens are billed from here
      const raw = data as { usage?: unknown; model?: string } | null;
      await recordAiCall({ userId, callType: isSearch ? 'chat_search' : 'chat', model: raw?.model ?? MODEL, usage: raw?.usage });
      let reservedCount = usageResult.count;
      /* #1631 E: only the answer, its follow-up questions, any search citations and the usage reach the browser - not xAI's raw JSON
         (reasoning_content, model name, system_fingerprint, cost ticks). */
      const { text, followUps } = splitFollowUps(answerText(data, isSearch));
      /* An EMPTY answer delivered nothing: the use goes back (the grok route treats an empty answer the same way). */
      if (!text) { const refunded = await giveBack(); if (refunded !== null) reservedCount = refunded; }
      const newChat   = isSearch ? chatUsed   : reservedCount;
      const newSearch = isSearch ? reservedCount : searchUsed;
      return NextResponse.json({
        text: text || '(no response)',
        followUps,
        citations: isSearch ? searchCitations(data, xWindow) : [],
        _usage: { chat_used: newChat, chat_limit: chatLimit, search_used: newSearch, search_limit: searchLimit },
      }, { status });
    }

    // xAI refused: the use goes back, and the answer says so generically. Its error body is not passed through.
    await giveBack();
    return apiError('grok-chat', new Error(`xAI answered ${status}`), 502, 'AI service error');
  } catch (e) {
    if (!billed) await giveBack();   // a throw before the 2xx (network error, the 180 s timeout, a non-JSON body)
    return apiError('grok-chat', e, 500, 'AI service error');
  }
}
