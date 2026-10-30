/* Server-side validation of the DATA an Arena read is built from (#1631 item 5).
 *
 * WHAT THIS CLOSES. /api/grok used to receive a finished `prompt` string assembled in the browser, with
 * `coin` and `tf` sent beside it as labels. Both gates said so in their own comments and both named the same
 * fix: the coin ladder (#1596) and the fast-timeframe gate (#1263) checked the value the request DECLARED,
 * so a hand-made request could pass `coin=btc` and ask about something else entirely, or pass `tf=1h` and
 * ask for 5-minute candles. The gate read the label; xAI read the text; nothing compared them.
 *
 * Now the browser sends the data and the server builds the prompt, so there is no second place for the
 * request to say something different. The gate and the prompt read the same validated object.
 *
 * THE SELECTION IS THE PART THAT MATTERS MOST, and it is the one that looks harmless. Arena lets the trader
 * weigh chosen indicators, and the page used to append not just their names but the INSTRUCTIONS around
 * them - "Give them more weight in the read, and say plainly if they disagree...". That is prompt text, not
 * data. Moving the prompt server-side while still accepting that sentence from the client would have
 * reopened the hole through a narrower window, and made it harder to see afterwards, because the route
 * would look like it builds its own prompt.
 *
 * So the selection travels as IDENTIFIERS and an unknown one is REFUSED rather than dropped. The server
 * owns `describeSelection` and the sentences around it. That turns a free-text channel into an enum, which
 * is the whole point of the item.
 *
 * Pure functions, no network, no Supabase - the convention from #1223, so this is testable without a live
 * upstream. Modelled on `parseChatContext` in lib/chatPrompt.ts, which already does this for /api/grok-chat:
 * that route has taken data and built its own system prompt since #1631 E, and this is the same move for
 * the route that was left behind.
 */

import type { GrokContext, ChartData } from './grok.ts';
import { findIndicator } from './strategyRegistry.ts';
import { COINS } from './coins.ts';

/** Per-field ceiling. Every GrokContext field is a short pre-formatted display string - the longest in
 *  normal use is a news or events block of a few hundred characters. 4,000 matches the per-turn cap
 *  `parseChatHistory` already applies in lib/chatPrompt.ts, and the whole-body bound still comes from the
 *  route's own request-size check. */
const MAX_FIELD_CHARS = 4_000;

/** Arena's own indicator limit is 3 for Pro (lib/strategyRegistry.ts LIMITS), so 8 is loose enough never to
 *  refuse a real selection and tight enough that the list cannot be used as a payload. */
const MAX_SELECTION = 8;

/* Every key of GrokContext, listed once. The assertion below makes this list and the interface the same
 * thing to the compiler. */
export const ARENA_CONTEXT_KEYS = [
  'coin', 'price', 'change24h', 'fundingRate', 'openInterest', 'fearGreed', 'btcDominance', 'session',
  'clusters', 'news', 'rsi14', 'ma20', 'priceVsMA', 'volRatio', 'longShortRatio', 'oilPrice', 'bonds10y',
  'real10y', 'etfFlows', 'ethEtfFlows', 'upcomingEvents', 'rsi1h', 'rsi4h', 'rsiDaily', 'cvd',
  'cvdDivergence', 'basis', 'fibNearest', 'orderWalls', 'squeezeScore', 'pcRatio', 'maxPain', 'btcGex',
  'exchangeNetFlow', 'stablecoinFlow', 'cascadeLine', 'whaleFlow', 'liqLevels', 'btcDomTrend',
  'sectorRotation', 'structureBreak', 'pocLine', 'dxyLine', 'spxLine', 'goldLine', 'takerRatio',
  'cbPremium', 'vwap', 'oiTrend', 'crossExchangeFunding', 'setupScan', 'distribution', 'oi1hChange',
  'marketStructure', 'absorptionScore', 'yenWatch', 'perpSpot', 'emaStrategy', 'emaATR', 'ema50Slope',
  'waveTrend',
] as const;

type ContextKey = (typeof ARENA_CONTEXT_KEYS)[number];

/* A LIST OF FIELD NAMES BESIDE AN INTERFACE IS A SECOND DEFINITION OF ONE THING, and it would rot the
 * ordinary way: someone adds a field to GrokContext, the prompt builder reads it, this validator never
 * copies it across, and every AI read silently loses that input. No test fails, because the prompt still
 * builds and the answer still parses - it is just missing a number nobody notices is gone.
 *
 * So the compiler is made to care. `Exact` is only assignable from `true` when the two key sets are
 * identical in both directions, which turns "added a field and forgot this file" into a build error here
 * rather than a quiet gap in production. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _keysMatchGrokContext: Exact<ContextKey, keyof GrokContext> = true;
void _keysMatchGrokContext;

/** Why a body was refused. Server-side only - it names the field, which is exactly what a 400 must not tell
 *  a caller probing the shape, so the route logs it and answers with a flat message. */
export type ArenaParseFailure = { ok: false; reason: string };
export type ArenaParseResult<T> = { ok: true; value: T } | ArenaParseFailure;

/**
 * The market context for one read.
 *
 * EVERY FIELD IS REQUIRED, and the strictness is deliberate. The page types its own object as `GrokContext`
 * and fills an "unavailable" string where a source did not answer, so all 61 are present by construction in
 * a real request. Accepting a missing field and substituting an empty string would mean a broken client
 * quietly sending an emptier and emptier context while every read still succeeds - a read that looks
 * normal and was made on less data. That is the failure this codebase keeps writing down.
 */
export function parseArenaContext(raw: unknown): ArenaParseResult<GrokContext> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'context is not an object' };
  }
  const r = raw as Record<string, unknown>;
  const out: Record<string, string> = {};

  for (const key of ARENA_CONTEXT_KEYS) {
    const v = r[key];
    if (typeof v !== 'string') return { ok: false, reason: `context.${key} is not a string` };
    out[key] = v.slice(0, MAX_FIELD_CHARS);
  }
  if (!out.coin.trim())    return { ok: false, reason: 'context.coin is empty' };
  if (!out.session.trim()) return { ok: false, reason: 'context.session is empty' };

  return { ok: true, value: out as unknown as GrokContext };
}

/**
 * The coin id a context is about, or null when it does not name a coin this app tracks.
 *
 * `ctx.coin` IS A DISPLAY STRING, NOT AN ID, and that is a trap worth naming because it is invisible at
 * the call site. `gatherContext` writes `selectedCoin.toUpperCase() + '/USDT'`, so the field reads
 * `BTC/USDT`. The coin ladder compares against ids - `normalizeCoinId` only trims and lowercases, so
 * handing it `BTC/USDT` yields `btc/usdt`, which is not on the Free list. Passing the raw field to the
 * gate would have refused every Free and trial account on BTC, ETH and SOL - the whole free tier's AI
 * reads - while a Pro account saw nothing wrong, because `aiCoinAllowed` returns true for Pro before it
 * ever looks at the coin.
 *
 * So the id is derived here, once, and checked against the tracked list. A value that is not one of them
 * returns null rather than a guess, which the caller turns into the same "name no coin" refusal the route
 * already had. If the display format ever changes, every read fails loudly instead of the ladder quietly
 * reading the wrong thing.
 */
export function arenaContextCoinId(ctx: GrokContext): string | null {
  const head = ctx.coin.trim().toLowerCase().split('/')[0].trim();
  return (COINS as readonly string[]).includes(head) ? head : null;
}

/** A finite number, or null where the type allows one. Rejects NaN and Infinity rather than letting them
 *  reach the prompt, where they would print as "NaN" and be read by the model as a value. */
function finiteOrNull(v: unknown): number | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return v;
}

/**
 * The chart half of a read. `tf` comes from here and nowhere else - it is what the fast-timeframe gate
 * checks AND what the prompt is built from, which is the point.
 */
export function parseArenaChart(raw: unknown): ArenaParseResult<ChartData> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'chart is not an object' };
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.tf !== 'string' || !r.tf.trim()) return { ok: false, reason: 'chart.tf is missing' };
  /* A timeframe is a short token like '15m' or '4h'. Bounded here as well as gated, because it is
     interpolated into the prompt and reaches the usage log. */
  if (!/^[0-9a-zA-Z]{1,8}$/.test(r.tf)) return { ok: false, reason: 'chart.tf is not a timeframe' };

  const ema9   = finiteOrNull(r.ema9);
  const sma200 = finiteOrNull(r.sma200);
  const rsi    = finiteOrNull(r.rsi);
  if (ema9 === undefined)   return { ok: false, reason: 'chart.ema9 is not a number or null' };
  if (sma200 === undefined) return { ok: false, reason: 'chart.sma200 is not a number or null' };
  if (rsi === undefined)    return { ok: false, reason: 'chart.rsi is not a number or null' };

  for (const key of ['hi', 'lo', 'lastClose'] as const) {
    if (typeof r[key] !== 'number' || !Number.isFinite(r[key])) {
      return { ok: false, reason: `chart.${key} is not a finite number` };
    }
  }
  if (typeof r.recent20 !== 'string') return { ok: false, reason: 'chart.recent20 is not a string' };
  if (r.detectedPatterns !== undefined && typeof r.detectedPatterns !== 'string') {
    return { ok: false, reason: 'chart.detectedPatterns is not a string' };
  }

  return {
    ok: true,
    value: {
      tf: r.tf,
      ema9, sma200, rsi,
      recent20:  r.recent20.slice(0, MAX_FIELD_CHARS),
      hi:        r.hi as number,
      lo:        r.lo as number,
      lastClose: r.lastClose as number,
      ...(r.detectedPatterns === undefined
        ? {}
        : { detectedPatterns: r.detectedPatterns.slice(0, MAX_FIELD_CHARS) }),
    },
  };
}

/**
 * The indicators the trader chose to weigh, as identifiers.
 *
 * AN UNKNOWN IDENTIFIER IS REFUSED, NOT DROPPED. Dropping would be the friendlier failure and the wrong
 * one: a caller probing what the server accepts would get a 200 either way, and a client bug that started
 * sending stale ids would silently stop applying the trader's choice while every read still looked fine.
 * A refusal says which of those happened.
 *
 * Absent and empty both mean "no selection", which is the ordinary case - the trader has chosen nothing.
 */
export function parseSelection(raw: unknown): ArenaParseResult<string[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, reason: 'selection is not an array' };
  if (raw.length > MAX_SELECTION) return { ok: false, reason: 'selection has too many entries' };

  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') return { ok: false, reason: 'selection holds a non-string' };
    if (!findIndicator(v)) return { ok: false, reason: 'selection holds an unknown indicator' };
    out.push(v);
  }
  return { ok: true, value: out };
}
