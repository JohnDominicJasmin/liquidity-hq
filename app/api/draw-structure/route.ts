/* DRAW STRUCTURE: the model proposes lines, the trader decides. Nothing here judges.
 *
 * Owner decision 2026-10-31, option D on #1818. The reasoning and the three measurements that
 * closed the door on an automatic detector are in `lib/drawStructure.ts` - read that header before
 * changing anything in this file, because every refusal below is a consequence of it.
 *
 * THE CANDLES COME FROM THE CLIENT, AND THAT IS THE CORRECTNESS ARGUMENT, NOT A SHORTCUT.
 *
 * The proposal is a set of candle INDICES, which `toDrawable` turns into timestamps so the chart
 * can draw by timestamp. That only lands on the right bars if the indices refer to the array the
 * user is actually looking at. If this route fetched its own klines it could disagree with the
 * chart in a way nothing would report: `/api/market/klines` fails over to Bybit under conditions
 * that depend on the request (`shouldFailToBybit`, `canFailoverForRequest`), and Bybit bars are
 * rescaled by `bybitPriceFactor`. A chart on Bybit bars and a route on Binance bars produce a line
 * drawn through the wrong candles at the wrong prices - and it would look plausible, which is worse
 * than looking broken.
 *
 * Sending the window also means this works for Bybit-only coins with no extra code, and spends one
 * exchange call instead of two.
 *
 * The candles are therefore UNTRUSTED INPUT, validated below. The validation is not about an
 * attacker - the worst a caller can do with a forged window is get a geometry proposal about
 * nothing, billed to their own Pro quota. It is about a malformed window producing a confident
 * line, which is the failure this whole feature exists to avoid.
 */
import { NextRequest, NextResponse } from 'next/server';
import { xaiFetch } from '@/lib/xai';
import { recordAiCall } from '@/lib/aiCallLog';
import { cached } from '@/lib/apiCache';
import { incrementToolUsage, rateLimitMessage, type UsageBlockReason } from '@/lib/aiUsage';
import { getUsageTier, hasProFeatures } from '@/lib/entitlements';
import { apiError } from '@/lib/apiError';
import { getUserCompatForBilledCall } from '@/lib/authUser';
import { intervalToMs, closedCandleKey } from '@/lib/candles';
import { COINS, type CoinId } from '@/lib/coins';
import {
  toDrawable, drawStructureAvailable, STRUCTURE_TYPES,
  type DrawableStructure, type RawProposal,
} from '@/lib/drawStructure';
import type { StructureCandle } from '@/lib/chartStructures';

const GROK_KEY = process.env.GROK_API_KEY ?? '';

/* Keyed per (coin, tf, closed bar), so two traders on the same 4h chart share one call and the
 * answer refreshes when a bar closes rather than on a wall-clock timer. On the only timeframes
 * this is offered on - 4h and 1d - a fixed short TTL would either re-spend inside one unchanged
 * bar or go stale across a new one. */
const MAX_TTL = 15 * 60_000;

/* The window the model is asked about. 200 is what the #1818 measurements used, so it is the only
 * window size anything is known about. A caller may send more; only the last 200 are used. */
const WINDOW = 200;
const MIN_CANDLES = 60;
const MAX_CANDLES = 1500;

/* Enough for a handful of proposals as JSON and nothing like enough for prose. A model that starts
 * explaining itself gets truncated, and a truncated explanation fails the JSON parse, which is the
 * outcome we want: no half-read structure reaches the chart. */
const MAX_TOKENS = 700;

class RateLimitError extends Error {
  constructor(public limit: number, public reason: UsageBlockReason) {
    super(rateLimitMessage(reason, limit, 'Draw Structure'));
  }
}

interface ClientCandle { timestamp?: unknown; open?: unknown; high?: unknown; low?: unknown; close?: unknown }

/**
 * Accepts the window or says exactly why not.
 *
 * `high < low` is rejected rather than silently swapped: a window where the two are transposed is
 * not a window with a typo in it, it is a window from somewhere we do not understand, and fitting
 * a line to it would produce a plausible-looking answer about nothing. Same reasoning for
 * out-of-order timestamps - `toDrawable` returns endpoints in index order, so a non-monotonic
 * window would draw a line backwards in time.
 */
function parseWindow(raw: unknown): { candles: StructureCandle[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'candles must be an array' };
  if (raw.length < MIN_CANDLES) return { error: `need at least ${MIN_CANDLES} candles` };
  if (raw.length > MAX_CANDLES) return { error: `at most ${MAX_CANDLES} candles` };

  const out: StructureCandle[] = [];
  let prevTs = -Infinity;
  for (let i = 0; i < raw.length; i++) {
    const c = (raw[i] ?? {}) as ClientCandle;
    const ts = Number(c.timestamp);
    const open = Number(c.open), high = Number(c.high), low = Number(c.low), close = Number(c.close);
    if (![ts, open, high, low, close].every(Number.isFinite)) {
      return { error: `candle ${i} has a non-numeric field` };
    }
    if (!Number.isInteger(ts) || ts <= 0) return { error: `candle ${i} has a bad timestamp` };
    if (ts <= prevTs) return { error: `candle ${i} is not after the one before it` };
    if (high < low) return { error: `candle ${i} has high below low` };
    prevTs = ts;
    out.push({ timestamp: ts, open, high, low, close });
  }
  return { candles: out.slice(-WINDOW) };
}

/**
 * INDICES, NOT TIMESTAMPS, and that was measured rather than guessed.
 *
 * Asked for 13-digit millisecond timestamps, Grok returned an empty list on every one of three
 * windows our own geometry rated highly, across three runs - it could describe the structure in
 * prose on the same window and would not copy the numbers back. Asked for indices it returned six
 * structures immediately. See `lib/drawStructure.ts`.
 *
 * NOTHING IN THIS PROMPT ASKS HOW SURE THE MODEL IS. No confidence, no strength, no "only if
 * significant". Two reasons, both measured on #1818: a confidence number it emits is not calibrated
 * (AUC 0.648, interval containing 0.5), and a prompt that invites the model to withhold weak answers
 * is a switch rather than a filter - adding "an empty list is a valid and correct answer" took the
 * count to zero on a structured window and a noise window alike. So it is asked for what it can see
 * and the trader decides, which is the whole design.
 */
function buildPrompt(coin: string, tf: string, candles: readonly StructureCandle[]): string {
  const dp = Math.max(2, Math.min(10, Math.ceil(-Math.log10(candles[candles.length - 1].close || 1)) + 4));
  const rows = candles.map((c, i) =>
    `${i} O:${c.open.toFixed(dp)} H:${c.high.toFixed(dp)} L:${c.low.toFixed(dp)} C:${c.close.toFixed(dp)}`,
  ).join('\n');

  return [
    `You are reading a ${tf} candle chart for ${coin.toUpperCase()}. Each row below is one candle,`,
    'prefixed by its INDEX. Index 0 is the oldest candle shown, the last index is the most recent.',
    '',
    'Identify the price structures a technical trader would draw on this chart.',
    '',
    'For each one, give the INDEX NUMBERS of the candles the line passes through - at least two,',
    'and only indices that appear below. Use the candle HIGHS for a line above price (side "high")',
    'and the candle LOWS for a line below price (side "low").',
    '',
    `Allowed types: ${STRUCTURE_TYPES.join(', ')}.`,
    '',
    'Reply with JSON only, in exactly this shape, and nothing else:',
    '{"structures":[{"type":"trendline","side":"low","touchIndices":[12,40,88]}]}',
    '',
    'CANDLES:',
    rows,
  ].join('\n');
}

/** The model is asked for JSON only, and sometimes fences it anyway. */
function parseProposals(text: string): RawProposal[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as { structures?: unknown };
    return Array.isArray(parsed.structures) ? parsed.structures as RawProposal[] : [];
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: authData } = await getUserCompatForBilledCall(token);
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  /* Pro-only, server-side, like the other eleven tool routes. The button is Pro-gated in the UI
   * too, but a UI gate is not a gate - without this check the paid xAI call is reachable with a
   * free account's token. */
  if (!(await hasProFeatures(token, authData.user.id))) {
    return NextResponse.json(
      { error: 'PRO_REQUIRED', message: 'Draw Structure is a Pro feature.' },
      { status: 403 },
    );
  }

  if (!GROK_KEY) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });

  const body = await req.json().catch(() => ({})) as { coin?: string; tf?: string; candles?: unknown };
  const coin = String(body.coin ?? '').toLowerCase().trim() as CoinId;
  const tf = String(body.tf ?? '').trim();

  if (!(COINS as readonly string[]).includes(coin)) {
    return NextResponse.json({ error: 'Unknown coin' }, { status: 400 });
  }
  /* 4h and 1d only, from the owner's own answers on 28 blind charts. The UI hides the button
   * elsewhere; this is the same rule enforced where it cannot be bypassed. */
  if (!drawStructureAvailable(tf)) {
    return NextResponse.json(
      { error: 'Draw Structure is available on the 4h and 1d timeframes.' },
      { status: 400 },
    );
  }

  const parsed = parseWindow(body.candles);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const candles = parsed.candles;

  /* Unreachable today: `drawStructureAvailable` has already restricted tf to 4h and 1d, both
   * of which `intervalToMs` knows. Handled rather than asserted because the cache key is what
   * breaks if it is ever wrong - a 0 interval makes `closedCandleKey` return 0, which would
   * pin every request in the same bucket and serve one trader's proposals to everyone. */
  const intervalMs = intervalToMs(tf);
  if (!intervalMs) {
    return NextResponse.json({ error: 'Invalid timeframe' }, { status: 400 });
  }
  const bar = closedCandleKey(intervalMs, Date.now());

  try {
    const result = await cached(
      `draw-structure:${coin}:${tf}:${bar}`,
      MAX_TTL,
      async (): Promise<{ structures: DrawableStructure[]; coin: string; tf: string }> => {
        /* Only the cache-miss path spends, so only it bills - a second trader on the same bar
         * gets the same proposals free. The increment is a RESERVATION taken before the xAI call
         * (see 20261023a), which is also why a missing migration cannot leak a free paid call:
         * the RPC refuses an unknown column and this throws before `xaiFetch`. */
        const tier = await getUsageTier(token, authData.user.id);
        const usage = await incrementToolUsage(authData.user.id, 'drawStructure', tier);
        if (usage.blocked) throw new RateLimitError(usage.limit, usage.reason);

        const aiRes = await xaiFetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
          body: JSON.stringify({
            model: 'grok-4.3',
            messages: [{ role: 'user', content: buildPrompt(coin, tf, candles) }],
            max_tokens: MAX_TOKENS,
          }),
        });
        if (!aiRes.ok) {
          const err = await aiRes.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error ?? 'AI error');
        }

        const aiData = await aiRes.json();
        await recordAiCall({
          userId: authData.user.id,
          callType: 'draw_structure',
          model: aiData.model ?? 'grok-4.3',
          usage: aiData.usage,
        });

        const text: string = aiData.choices?.[0]?.message?.content ?? '';
        /* Every well-formed proposal is returned and NONE is ranked or filtered for strength -
         * there is no validated statistic to rank on. `toDrawable` drops anything that is not
         * drawable (unknown type, invented index, fewer than two distinct points) and drops the
         * confidence field if the model volunteered one. An empty array is a real answer here,
         * not an error: it means the model saw nothing to draw. */
        const structures = parseProposals(text)
          .map(p => toDrawable(p, candles))
          .filter((s): s is DrawableStructure => s !== null);

        return { structures, coin, tf };
      },
    );
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof RateLimitError) {
      /* `not_enabled` is not a rate limit and must not be sent as one: it means this tool's usage
       * column is missing, which is our deployment state, not the user's quota. 503 so a client
       * retry-after-reset heuristic does not treat it as "wait until tomorrow". */
      const notEnabled = e.reason === 'not_enabled';
      return NextResponse.json(
        { error: e.message, code: notEnabled ? 'NOT_ENABLED' : 'RATE_LIMIT' },
        { status: notEnabled ? 503 : 429 },
      );
    }
    return apiError('draw-structure', e, 502, 'Request failed');
  }
}
