import { NextRequest, NextResponse } from 'next/server';
import { xaiFetch } from '@/lib/xai';
import { recordAiCall } from '@/lib/aiCallLog';
import { applyResultChecks, buildVerdictRepairPrompt, GROK_EMPTY_ANSWER_MESSAGE, GROK_UNREADABLE_ANSWER_MESSAGE, parseCombinedResponse, parseVerdict } from '@/lib/grok';
import { answerText, searchCitations, searchTools, searchWindow } from '@/lib/xaiAnswer';
import { T } from '@/lib/tables';
import { getEntitlementStatus, getUsageTier, getUsageTierStatus } from '@/lib/entitlements';
import { aiCoinAllowed, normalizeCoinId } from '@/lib/signalCoinGate';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { AI_LIMITS, GATED_TFS, isGatedTf, type UsageTier } from '@/lib/limits';
import { incrementUsageColumn, rateLimitMessage, refundUsageColumn, todayUtc } from '@/lib/aiUsage';
import { apiError } from '@/lib/apiError';
import { getUserCompat, getUserCompatForBilledCall } from '@/lib/authUser';
import { anonServerClient, userClient } from '@/lib/supabase-user';

// Keys / limits (limits: single source of truth in lib/limits.ts)
const GROK_KEY = process.env.GROK_API_KEY ?? '';

/** #1651 item 1: the days of X posts a Deep read may draw on, today included. */
const DEEP_X_DAYS = 2;

/** #1651 item 3: ask once more for a verdict the answer did not state readably. A plain chat call - no search, no market data, the
 *  answer itself is the input - logged as its own call type so its cost is counted. null on any failure: the caller then refuses. */
async function restateVerdict(answer: string, userId: string) {
  try {
    const r = await xaiFetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
      body: JSON.stringify({ model: 'grok-4.3', messages: [{ role: 'user', content: buildVerdictRepairPrompt(answer) }], max_tokens: 200 }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    await recordAiCall({ userId, callType: 'verdict_repair', model: d.model ?? 'grok-4.3', usage: d.usage });
    return parseVerdict(answerText(d, false));
  } catch {
    return null;
  }
}

function sb(token?: string) {
  return token ? userClient(token) : anonServerClient();
}

async function getUsageRow(token: string, userId: string, today: string) {
  const { data } = await sb(token).from(T.grok_usage)
    .select('deep_count, quick_count, chat_count, chat_search_count, briefing_count, tool_pool_count')
    .eq('user_id', userId)
    .eq('date', today)
    .maybeSingle();
  return {
    deepUsed:     data?.deep_count        ?? 0,
    quickUsed:    data?.quick_count       ?? 0,
    chatUsed:     data?.chat_count        ?? 0,
    searchUsed:   data?.chat_search_count ?? 0,
    briefingUsed: data?.briefing_count    ?? 0,
    toolPoolUsed: data?.tool_pool_count   ?? 0,
  };
}

// The shared one-shot-tool budget (lib/limits.ts AI_LIMITS[role].toolPool) is
// Pro-only - free stays on per-tool caps, so there is no single number to show
// a free user. 0 means "no pool", and UsageRings skips the ring entirely
// rather than rendering a meaningless 0/0.
function toolPoolLimitFor(role: UsageTier): number {
  return AI_LIMITS[role].toolPool ?? 0;
}

// ── GET - return today's usage without running an analysis ──────────────────
export async function GET(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') || undefined;
  if (!token) return NextResponse.json({ usage: null });

  const { data } = await getUserCompat(token);
  const userId = data.user?.id ?? null;
  if (!userId) return NextResponse.json({ usage: null });

  const today = todayUtc();
  const [{ deepUsed, quickUsed, chatUsed, searchUsed, briefingUsed, toolPoolUsed }, role] = await Promise.all([
    getUsageRow(token, userId, today),
    getUsageTier(token, userId),
  ]);
  const deepLimit     = AI_LIMITS[role].deep;
  const quickLimit    = AI_LIMITS[role].quick;
  const chatLimit     = AI_LIMITS[role].chat;
  const searchLimit   = AI_LIMITS[role].search;
  const briefingLimit = AI_LIMITS[role].briefing;

  return NextResponse.json({
    usage: {
      deep_used:      deepUsed,     deep_limit:      deepLimit,
      quick_used:     quickUsed,    quick_limit:     quickLimit,
      chat_used:      chatUsed,     chat_limit:      chatLimit,
      search_used:    searchUsed,   search_limit:    searchLimit,
      briefing_used:  briefingUsed, briefing_limit:  briefingLimit,
      tool_pool_used: toolPoolUsed, tool_pool_limit: toolPoolLimitFor(role),
    },
  });
}

// ── POST - run an analysis ──────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!(await isFeatureEnabled('grok'))) {
    return NextResponse.json({ error: 'AI Arena is temporarily unavailable.', code: 'FEATURE_DISABLED' }, { status: 503 });
  }

  const { prompt, tf, session, type, coin } = await req.json() as {
    prompt: string; tf: string; session: string; type: 'quick' | 'deep'; coin?: string;
  };

  // The prompt is assembled in the browser (lib/grok.ts) and sent whole, so its
  // length is caller-controlled. The daily cap counts CALLS, not tokens, so
  // without a bound here one allowed call can cost an arbitrary amount at xAI.
  // The real assembled prompt runs well under this; anything larger is not the
  // app talking.
  if (typeof prompt !== 'string' || prompt.length > 64_000) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const token = req.headers.get('Authorization')?.replace('Bearer ', '') || undefined;

  // Auth required for both Quick and Deep - prevents unauthenticated API burn
  let userId: string | null = null;
  if (token) {
    const { data } = await getUserCompatForBilledCall(token);
    userId = data.user?.id ?? null;
  }

  if (!userId) {
    return NextResponse.json(
      { error: 'Sign in required to use AI Arena', code: 'AUTH_REQUIRED' },
      { status: 401 }
    );
  }

  // ── Fast timeframes are Pro (#1263) ───────────────────────────────────────
  // Arena only clamps 1m/5m/15m in the browser, so before this a free token
  // could POST tf=5m directly and get a fast-timeframe read. Checked before the
  // usage reservation below so a refused request costs no quota and no xAI.
  //
  // Only a CONFIRMED free account is refused. 'unknown' (the plan read failed)
  // goes through - #1119: a failed read is not evidence the user is free, and
  // refusing it would lock a paying Pro user out of the timeframe they pay for
  // whenever that read errors. What this lets through is bounded: the daily
  // quick/deep cap below still applies, and a plan read that fails there too
  // bills the call against the free row.
  //
  // This gates the timeframe the request DECLARES. The prompt itself is built
  // in the browser (lib/grok.ts), so a hand-made request can still describe
  // fast candles under tf=1h; closing that means building the prompt here.
  if (isGatedTf(tf) && (await getEntitlementStatus(token!, userId)) === 'not_entitled') {
    return NextResponse.json(
      { error: 'PRO_REQUIRED', message: `Fast timeframes (${GATED_TFS.join(', ')}) are a Pro feature.` },
      { status: 403 }
    );
  }

  // ── Coin ladder (#1596) ───────────────────────────────────────────────────
  // Free AND free trial (anyone who has not PAID) get Quick and Deep on BTC, ETH and SOL only; paid Pro gets every coin. This is enforced
  // here and not only by a disabled button, because a page check can be bypassed and every call costs money at xAI. It runs BEFORE the usage
  // reservation below, so a refused request counts against no quota and makes no xAI request.
  //
  // The coin is the one the request DECLARES. The prompt is built in the browser, so a hand-made request can still describe another coin under
  // coin=btc; closing that means building the prompt on the server (the same limit the fast-timeframe gate above states). Names, spacing and
  // case do not matter: ' XRP ' and 'Xrp' are the locked coin 'xrp'. A request that names no coin is refused for anyone who has not paid.
  //
  // A plan read that FAILED is neither Free nor Pro: for a coin on the Free list it goes through as it always did, and for any other coin it is
  // answered 503 PLAN_UNKNOWN (retry), never PRO_REQUIRED-style "you are not Pro" and never an AI call - a paying user is not told they are
  // Free, and a locked coin does not run on a guess.
  const coinPlan = await getUsageTierStatus(token!, userId);
  if (!aiCoinAllowed(coinPlan.tier, coin)) {
    if (coinPlan.failed) {
      return NextResponse.json({ error: 'Could not check your plan. Try again in a moment.', code: 'PLAN_UNKNOWN' }, { status: 503 });
    }
    if (normalizeCoinId(coin) === null) {
      return NextResponse.json({ error: 'Reload the page and try again.', code: 'COIN_REQUIRED' }, { status: 400 });
    }
    return NextResponse.json({ error: 'This coin is Pro only.', code: 'COIN_LOCKED' }, { status: 403 });
  }

  // ── Rate limit check ──────────────────────────────────────────────────────
  const today = todayUtc();
  let [{ deepUsed, quickUsed, chatUsed, searchUsed, briefingUsed, toolPoolUsed }, role] = await Promise.all([
    getUsageRow(token!, userId, today),
    getUsageTier(token!, userId),
  ]);
  const deepLimit     = AI_LIMITS[role].deep;
  const quickLimit    = AI_LIMITS[role].quick;
  const chatLimit     = AI_LIMITS[role].chat;
  const searchLimit   = AI_LIMITS[role].search;
  const briefingLimit = AI_LIMITS[role].briefing;

  const allUsage = () => ({
    deep_used:      deepUsed,     deep_limit:      deepLimit,
    quick_used:     quickUsed,    quick_limit:     quickLimit,
    chat_used:      chatUsed,     chat_limit:      chatLimit,
    search_used:    searchUsed,   search_limit:    searchLimit,
    briefing_used:  briefingUsed, briefing_limit:  briefingLimit,
    tool_pool_used: toolPoolUsed, tool_pool_limit: toolPoolLimitFor(role),
  });

  // Atomic check-and-increment (reserve before spending on xAI) - closes the
  // TOCTOU race the old read-then-upsert pattern had between concurrent requests.
  const column = type === 'deep' ? 'deep_count' : 'quick_count';
  const limit  = type === 'deep' ? deepLimit : quickLimit;
  /* The date the reservation is written under, captured HERE and reused for any refund - a Deep call can cross UTC midnight,
     and recomputing the date at refund time would credit a row that never paid. */
  const reservedOn = todayUtc();
  /* Anything from the request body is attacker-controlled text before it is a log field: a coin of "btc
[grok] BAD_ANSWER ..."
     writes a second line that reads like ours and forges whatever it likes into the record we debug from. Flagged by the automated
     security review. Stripped to the characters a coin id or a timeframe can legitimately contain, and truncated. */
  const logTag = (v: unknown) => String(v ?? 'unknown').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 24) || 'unknown';
  /* The HEAD of an unparseable answer, one line, 160 characters. Without it the log says a verdict could not be read and not what
     arrived instead, which is the difference between knowing and guessing - QA's candidate for #1721 is that the model now bolds the
     VALUE ("SIGNAL: **BULLISH**"), a shape these regexes reject while accepting every other markdown variant. This line settles that
     on the next failure at no cost. Newlines become a marker so a crafted answer cannot forge a second log line. */
  const logHead = (v: string) => v.replace(/\s*[\r\n]+\s*/g, ' | ').replace(/[^\x20-\x7E]/g, '').slice(0, 160);
  const usageResult = await incrementUsageColumn(userId, role, column, limit);
  if (usageResult.blocked) {
    const label = type === 'deep' ? 'deep analyses' : 'quick analyses';
    return NextResponse.json(
      { error: rateLimitMessage(usageResult.reason, limit, label), code: 'RATE_LIMIT', usage: allUsage() },
      { status: 429 }
    );
  }

  // ── Call xAI ──────────────────────────────────────────────────────────────
  let text: string;
  let citations: string[] = [];
  try {
    if (type === 'deep') {
      // Responses API with live web + X search. #1651 item 1: X is searched over yesterday and today only - Deep asks why the coin is
      // moving TODAY, and an older post is not today's catalyst.
      const xWindow = searchWindow(DEEP_X_DAYS);
      const r = await xaiFetch('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
        body: JSON.stringify({
          model: 'grok-4.3',
          input: [{ role: 'user', content: prompt }],
          tools: searchTools(xWindow),
          // Deep is the expensive path (frontier model + web and X search) and
          // was the only xAI call in the app with no output bound at all.
          max_output_tokens: 2000,
        }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(`xAI ${r.status}: ${e.error ?? r.statusText}`);
      }
      const d = await r.json();
      await recordAiCall({ userId, callType: 'deep', model: d.model ?? 'grok-4.3', usage: d.usage });
      text = answerText(d, true);
      // #1631 A: the sources the search returned are kept - they used to be dropped here with everything but the text.
      // #1651 item 2: an X post dated outside the window by its own ID is dropped.
      citations = searchCitations(d, xWindow);
    } else {
      // chat/completions - no search tools, cheaper
      const r = await xaiFetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
        body: JSON.stringify({
          model: 'grok-4.3',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 800,
        }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(`xAI ${r.status}: ${e.error ?? r.statusText}`);
      }
      const d = await r.json();
      await recordAiCall({ userId, callType: 'quick', model: d.model ?? 'grok-4.3', usage: d.usage });
      text = answerText(d, false);
    }
  } catch (e: unknown) {
    return apiError('grok', e, 500, 'AI service error');
  }

  const newDeep  = type === 'deep'  ? usageResult.count : deepUsed;
  const newQuick = type === 'quick' ? usageResult.count : quickUsed;
  const usage = {
    deep_used:     newDeep,      deep_limit:     deepLimit,
    quick_used:    newQuick,     quick_limit:    quickLimit,
    chat_used:     chatUsed,     chat_limit:     chatLimit,
    search_used:   searchUsed,   search_limit:   searchLimit,
    briefing_used: briefingUsed, briefing_limit: briefingLimit,
  };

  /* The refused response must report the count the user actually has left, not the one that was reserved and given back - otherwise
     the counter on screen says they spent a read they did not. `refunded` is null when the refund did not land (migration 20261023a
     not applied yet), and then the honest number is the reserved one. */
  const usageAfterRefund = (refunded: number | null) =>
    refunded === null ? usage : { ...usage, [type === 'deep' ? 'deep_used' : 'quick_used']: refunded };

  /* #1651 item 3: the verdict must be one of the five signals with a 0-100 confidence. An answer without them used to be parsed as FLAT
     at 0% and shown as a "Wait" the model never said. One retry asks for the verdict again; if that is unreadable too, the read is
     refused with a plain message (the client's existing BAD_ANSWER path).

     THE USE IS REFUNDED. This comment used to say "no refund, as for any failed xAI call" and that was wrong in the one case that
     matters: the customer paid a Deep read and saw nothing. PM measured it on 2026-10-22 - two refusals took deep_used 1 -> 2 with
     no answer either time. The reservation stays before the call (it closes a TOCTOU race); it is handed back here instead. */
  let restated = false;
  if (!parseVerdict(text)) {
    // Nothing to restate: an empty answer is refused as empty, without paying for a second call on it.
    if (!text.trim()) {
      /* LOGS, because a refusal that writes nothing is unmeasurable (#1631, QA). PM searched production for this failure and found
         silence - which meant nothing, since these two paths were plain NextResponse.json with no apiError, no console, no health
         report. Without a line here the eventual FIX is also unverifiable on prod: we would ship it and have no way to know. */
      console.error(`[grok] BAD_ANSWER empty-text type=${logTag(type)} coin=${logTag(coin)} tf=${logTag(tf)} restated=false`);
      const refunded = await refundUsageColumn(userId, column, reservedOn);
      return NextResponse.json({ error: GROK_EMPTY_ANSWER_MESSAGE, code: 'BAD_ANSWER', usage: usageAfterRefund(refunded) }, { status: 502 });
    }
    const v = await restateVerdict(text, userId);
    if (!v) {
      /* restated=true: the restatement attempt RAN and still produced no verdict - a different fault from an answer that arrived
         empty, and the distinction is the first thing anyone debugging this will want. */
      console.error(`[grok] BAD_ANSWER unreadable-verdict type=${logTag(type)} coin=${logTag(coin)} tf=${logTag(tf)} restated=true chars=${text.trim().length} head=${JSON.stringify(logHead(text.trim()))}`);
      const refunded = await refundUsageColumn(userId, column, reservedOn);
      return NextResponse.json({ error: GROK_UNREADABLE_ANSWER_MESSAGE, code: 'BAD_ANSWER', usage: usageAfterRefund(refunded) }, { status: 502 });
    }
    text = `SIGNAL: ${v.signal}\nCONFIDENCE: ${v.confidence}\n${text}`;
    restated = true;
  }

  /* #1631 B and D: the rules the answer can be checked against are applied here, where the prompt is known - a full tier the model's own
     count does not support, a raid with no cluster data to aim at (both XRP runs invented a "long flush" target), and a missing
     "perps-vs-spot unavailable" disclosure. See applyResultChecks in lib/grok.ts. */
  const result = applyResultChecks({ ...parseCombinedResponse(text, tf, session), citations }, prompt);
  if (restated) (result.checks ??= []).push('verdict restated by a second pass: the answer did not state SIGNAL and CONFIDENCE in the required form');

  return NextResponse.json({ result, usage });
}
