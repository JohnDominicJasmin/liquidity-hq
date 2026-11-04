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
import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { xaiFetch } from '@/lib/xai';
import { recordAiCall } from '@/lib/aiCallLog';
import { cached } from '@/lib/apiCache';
import { incrementToolUsage, rateLimitMessage, refundToolUsage, todayUtc, type UsageBlockReason } from '@/lib/aiUsage';
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
function parseWindow(
  raw: unknown,
  barOpen: number,
): { candles: StructureCandle[] } | { error: string } {
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
  /* THE FORMING CANDLE IS DROPPED, and that is load-bearing for the cache rather than a
   * nicety about data quality. Two traders on the same 4h chart send windows that differ in
   * exactly one place - the current bar's close, which moves every tick - so hashing the
   * window with it included would make the key unique per request and the cache dead weight.
   * Closed bars are identical across clients on the same feed and bar, so the hash matches
   * and one call serves both.
   *
   * It is also the right input on its own terms: a half-formed bar's high and low are not yet
   * facts, and a line fitted through one is fitted through a number that will change. */
  const closed = out.filter(c => c.timestamp < barOpen);
  if (closed.length < MIN_CANDLES) {
    return { error: `need at least ${MIN_CANDLES} closed candles` };
  }
  return { candles: closed.slice(-WINDOW) };
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

/* THE THREE WAYS AN EMPTY RESULT HAPPENS, AND WHY THEY MUST NOT SHARE ONE RETURN.
 *
 * This returned `[]` for all of them: no JSON in the reply, JSON that would not parse, and a
 * model that genuinely proposed nothing. The route then answered 200 with `structures: []` for
 * each, and the client rendered DRAW_STRUCTURE_NONE - "Nothing proposed on this window." So two
 * failures reached the trader as a calm statement about their chart, which is the same shape as
 * an unreadable AI answer drawn as FLAT. PM's ruling on #1263, 2026-11-05.
 *
 * `ok: false` IS NOT "NO PROPOSALS", it is "I could not read the reply". The caller refunds the
 * reservation and refuses, exactly as `app/api/grok/route.ts` does for BAD_ANSWER - a comment
 * there records that "no refund, as for any failed xAI call" was wrong, because the user paid for
 * a read they did not get.
 *
 * AN EMPTY `raw` WITH `ok: true` IS STILL A REAL ANSWER. `{"structures": []}` is the model saying
 * it saw nothing to draw, which is worth a read and worth the empty state. The distinction this
 * function now draws is exactly: did the model answer? */
type UnreadableReason = 'no-json' | 'bad-json' | 'not-an-array';
type ParsedProposals =
  | { ok: true; raw: RawProposal[] }
  | { ok: false; reason: UnreadableReason };

/** The model is asked for JSON only, and sometimes fences it anyway. */
function parseProposals(text: string): ParsedProposals {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return { ok: false, reason: 'no-json' };
  let parsed: { structures?: unknown };
  try {
    parsed = JSON.parse(body.slice(start, end + 1)) as { structures?: unknown };
  } catch {
    return { ok: false, reason: 'bad-json' };
  }
  /* A reply with no `structures` key at all is not an empty window - it is a reply that did not
     answer the question asked. Separated from `bad-json` so the log says which it was. */
  if (!Array.isArray(parsed.structures)) return { ok: false, reason: 'not-an-array' };
  return { ok: true, raw: parsed.structures as RawProposal[] };
}

/** The reply could not be read at all. Carries the reason for the log, never for the user. */
class UnreadableAnswerError extends Error {
  constructor(readonly reason: UnreadableReason) {
    super('unreadable answer');
    this.name = 'UnreadableAnswerError';
  }
}

/** The model answered and every proposal was undrawable. Distinct from "it proposed nothing":
 *  the trader paid for a read that produced something we then had to throw away. */
class UndrawableAnswerError extends Error {
  constructor(readonly proposed: number) {
    super('no drawable proposals');
    this.name = 'UndrawableAnswerError';
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

  /* Unreachable today: `drawStructureAvailable` has already restricted tf to 4h and 1d, both
   * of which `intervalToMs` knows. Handled rather than asserted because the cache key is what
   * breaks if it is ever wrong - a 0 interval makes `closedCandleKey` return 0, which would
   * pin every request in the same bucket and serve one trader's proposals to everyone. */
  const intervalMs = intervalToMs(tf);
  if (!intervalMs) {
    return NextResponse.json({ error: 'Invalid timeframe' }, { status: 400 });
  }
  const bar = closedCandleKey(intervalMs, Date.now());

  const parsed = parseWindow(body.candles, bar);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const candles = parsed.candles;

  /* THE WINDOW IS PART OF THE CACHE KEY, and leaving it out was a real cross-user defect
   * rather than a theoretical one. Caught by the automated security review on the first
   * commit of this route; recording it here because the mistake is instructive.
   *
   * The key was `coin:tf:bar`, which is correct ONLY if the candles are canonical. They are
   * not - they come from the client, deliberately (see the header). So trader A could send
   * any window for btc/4h and trader B, on a genuine btc/4h chart, would be served A's
   * proposals: lines whose timestamps came from A's candles, drawn on B's chart. That is
   * precisely the failure this feature exists to avoid - a plausible-looking line through
   * the wrong candles - arriving through the cache instead of through the geometry.
   *
   * I justified client-supplied candles for correctness and then keyed the cache as though
   * they were canonical. The two decisions contradicted each other and the review caught it.
   *
   * Hashing the window keeps the cost sharing that the cache exists for: honest clients on
   * the same feed and the same closed bar send byte-identical arrays, so they still share one
   * call. Anyone sending anything else caches only against themselves, billed to their own
   * pool. A hash mismatch costs a duplicate call, never a wrong line - the right direction
   * for the failure to fall. */
  const windowHash = createHash('sha256')
    .update(candles.map(c => `${c.timestamp}:${c.open}:${c.high}:${c.low}:${c.close}`).join('|'))
    .digest('hex')
    .slice(0, 16);

  /* Set inside the cache-miss path below, read by the catch. `null` means this request never
     reserved - a cache hit, or a refusal before the reservation - and must not be refunded.

     A ONE-FIELD BOX RATHER THAN A `let`, because TypeScript's control-flow analysis does not
     follow an assignment made inside the nested async closure below: it still believes the
     variable is `null` at the catch, so `if (reserved)` narrowed it to `never` and the refund
     calls failed to compile. The box is not narrowed, and it reads as what it is - a slot the
     inner function fills for the outer one. */
  const reserved: { current: { userId: string; on: string } | null } = { current: null };

  try {
    const result = await cached(
      `draw-structure:${coin}:${tf}:${bar}:${windowHash}`,
      MAX_TTL,
      async (): Promise<{ structures: DrawableStructure[]; coin: string; tf: string }> => {
        /* Only the cache-miss path spends, so only it bills - a second trader on the same bar
         * gets the same proposals free. The increment is a RESERVATION taken before the xAI call
         * (see 20261023a), which is also why a missing migration cannot leak a free paid call:
         * the RPC refuses an unknown column and this throws before `xaiFetch`. */
        const tier = await getUsageTier(token, authData.user.id);
        /* THE DATE IS CAPTURED HERE, BESIDE THE RESERVATION, and handed to the refund below rather
           than recomputed. `lib/aiUsage.ts` records why: an AI call can outlive UTC midnight, and
           `todayUtc()` at refund time would credit the next day's row - quota minted on one day
           against a charge left standing on the other. Flagged by a security review on the grok
           route and the same hazard applies here.
           Assigned to the outer `reserved` so the catch, which is outside this closure and outside
           `cached()`, can tell a request that paid from one that never got as far as reserving. */
        const usage = await incrementToolUsage(authData.user.id, 'drawStructure', tier);
        if (usage.blocked) throw new RateLimitError(usage.limit, usage.reason);
        reserved.current = { userId: authData.user.id, on: todayUtc() };

        const aiRes = await xaiFetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
          body: JSON.stringify({
            model: 'grok-4.3',
            messages: [{ role: 'user', content: buildPrompt(coin, tf, candles) }],
            /* WRITTEN AS A LITERAL, not a constant, and that is a test contract rather than a style
               choice. `__tests__/xaiOutputCapsPairWithEndpoint.test.mts` reads every xAI call site's
               cap from the source and allows exactly ONE computed value - grok-chat's, which is
               clamped because the browser supplies the figure and has its own behavioural test for
               the clamp. A constant here reads as 'computed' to that sweep and fails it, correctly:
               a cap it cannot see the value of is a cap it cannot check.

               700 is enough for a handful of proposals as JSON and nothing like enough for prose. A
               model that starts explaining itself gets truncated, and a truncated explanation fails
               the JSON parse - which is the outcome we want: no half-read structure reaches the
               chart. Nothing clamps it because nothing caller-controlled feeds it. */
            max_tokens: 700,
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
         * confidence field if the model volunteered one.
         *
         * THREE OUTCOMES, NOT ONE. This block used to collapse all of them into `structures: []`
         * and a 200, so a reply we could not read and a reply we could read but not use both
         * reached the trader as "Nothing proposed on this window." - a calm statement about their
         * chart. Only the third is that:
         *
         *   unreadable      no JSON, unparseable JSON, or no `structures` key -> refuse, refund
         *   all undrawable  the model answered, every proposal failed toDrawable -> refuse, refund
         *   empty answer    `{"structures": []}` -> 200, and the empty state is CORRECT
         *
         * THROWN FROM INSIDE `cached()` ON PURPOSE: it stores only successes, so a refusal is
         * never pinned for the TTL and the next trader on the same bar gets a fresh attempt. */
        const parsed = parseProposals(text);
        if (!parsed.ok) throw new UnreadableAnswerError(parsed.reason);

        const structures = parsed.raw
          .map(p => toDrawable(p, candles))
          .filter((s): s is DrawableStructure => s !== null);

        /* The model proposed things and not one of them was drawable. Distinguished from an empty
         * answer because the cause is ours or the model's, not the market's: an unknown type, an
         * index outside the window, or fewer than two distinct points. Telling the trader their
         * chart has no structure would be describing our parse failure as their chart. */
        if (parsed.raw.length > 0 && structures.length === 0) {
          throw new UndrawableAnswerError(parsed.raw.length);
        }

        return { structures, coin, tf };
      },
    );
    return NextResponse.json(result);
  } catch (e) {
    /* THE TWO REFUSALS THAT COST A READ, AND BOTH REFUND IT.
     *
     * `app/api/grok/route.ts` already settled this and corrected itself in the process: its
     * comment records that "no refund, as for any failed xAI call" was wrong, because the user
     * paid for a read they did not get. Same here. 502 rather than 500, matching that route's
     * BAD_ANSWER, because the failure is upstream's answer and not our request.
     *
     * THE MESSAGE IS THE SERVER'S OWN WORDS, which is this feature's established pattern -
     * `components/KLineProChart.tsx:2753` prefers a server `message` over the local
     * DRAW_STRUCTURE_FAILED default precisely because only this side knows why. So no new label
     * key and no new owner copy approval: these two reuse the one string the client already has
     * for a failed read, and the CODE is what distinguishes them for us.
     *
     * NEITHER SAYS WHAT WENT WRONG. A trader cannot act on "the model returned nothing
     * drawable", and naming a cause in the UI is how a log line becomes a claim. The reason and
     * the count go to the log. */
    if (e instanceof UnreadableAnswerError) {
      console.error(`[draw-structure] UNREADABLE reason=${e.reason} coin=${coin} tf=${tf}`);
      if (reserved.current) await refundToolUsage(reserved.current.userId, 'drawStructure', reserved.current.on);
      return NextResponse.json({ error: 'Could not read the chart. Try again.', code: 'BAD_ANSWER' }, { status: 502 });
    }
    if (e instanceof UndrawableAnswerError) {
      console.error(`[draw-structure] UNDRAWABLE proposed=${e.proposed} drawable=0 coin=${coin} tf=${tf}`);
      if (reserved.current) await refundToolUsage(reserved.current.userId, 'drawStructure', reserved.current.on);
      return NextResponse.json({ error: 'Could not read the chart. Try again.', code: 'UNDRAWABLE' }, { status: 502 });
    }
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
