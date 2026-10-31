/* #1631 ITEM 5, STEP 2: THE SERVER FETCHES THE ARENA'S NUMBERS ITSELF.
 *
 * Step 1 moved the prompt ASSEMBLY to `app/api/grok/route.ts` and shared the formatters in
 * `lib/arenaContextFields.ts`. Every number in that prompt still arrived from the browser, so a
 * hand-made request could describe any market it liked and be analysed on it. This module is the
 * other half: it builds the same market row the browser builds, from the server's own feeds, and
 * the route overwrites the client's values with it before the prompt is built.
 *
 * SHARED FORMATTER, NOT A SECOND ONE. The thirteen fields are formatted by
 * `arenaNumberFields()` - the same function the Arena page calls. This module only assembles the
 * ROW it is given. `lib/arenaContextFields.ts`'s header explains why that matters: each field is a
 * sentence with interpretive text baked in ("68.4 (Overbought)"), and a prompt that differs by one
 * adjective produces a different answer with nothing failing.
 *
 * ── TWO KINDS OF MISSING, AND THEY ARE ANSWERED DIFFERENTLY ─────────────────────────────────────
 *
 * This is the whole design, so it is stated before the code.
 *
 * 1. THE FEED IS DOWN. `marketSnapshotData()` returns `ok: false`, or names `ticker` in its
 *    `partial` list because the section came back empty for EVERY coin. Then the server has no
 *    numbers at all, and falling back to the client's would hand an attacker the method: induce a
 *    feed failure, or simply wait for one, and the fabricated numbers go through exactly as before.
 *    **So this is refused** - `ok: false`, and the route answers 503 without spending quota or
 *    making an xAI call. Same shape as the route's existing PLAN_UNKNOWN: a read we cannot do
 *    safely is retried, never guessed at, and never billed.
 *
 * 2. THE COIN IS OUTSIDE THE SERVER'S COVERAGE. The ticker section is populated but holds nothing
 *    for this coin. Today that is exactly one coin: `lib/marketSnapshotData.ts:91` excludes `hype`
 *    from `SYMS` because it has no Binance perp, while `lib/coins.ts:64` lists it as a tracked,
 *    selectable coin. **So `hype` keeps the browser's numbers**, and `fields` comes back empty.
 *
 * WHY 2 IS NOT REFUSED, SINCE IT IS THE WEAKER CHOICE AND SHOULD BE ARGUED FOR RATHER THAN
 * ASSUMED. Refusing it would turn "the server cannot source HYPE" into "Pro users cannot get an AI
 * read on HYPE", which is removing a paid feature to close a hole that is open for every coin
 * today. Keeping the client's numbers for one coin is **exactly today's behaviour for that coin**
 * and strictly better for the other forty-four. The carve-out is one coin, named here, for a
 * reason that is visible in the code it comes from - not a silent fallback that covers whatever
 * happens to be missing.
 *
 * It is also a FOLLOW-UP rather than a resting place. `lib/marketRsi.ts` already sources HYPE from
 * Bybit (`BY_TIMEFRAMES`), and `marketSnapshotData` already carries `bybitTickerToEntry` and
 * `bybitKlineToBinanceShape`. Extending the snapshot to cover HYPE closes this properly, and it
 * changes `/api/market/snapshot` for every client, so it is its own change with its own check.
 *
 * ── WHAT A PER-FIELD GAP MEANS ──────────────────────────────────────────────────────────────────
 *
 * Within a coin the server DOES cover, a field it could not read becomes `'-'` through
 * `arenaNumberFields`'s own `!= null` guards - **not** the client's value for that field. A
 * mixed row, half server-sourced and half client-sourced, would be the hole again at field
 * granularity, and nothing in the prompt would say which half was which. `'-'` is what the browser
 * itself sends for an absent field, so this introduces no new vocabulary.
 *
 * ── COST ────────────────────────────────────────────────────────────────────────────────────────
 *
 * Both reads are cached (`cached()` in each module, on their original TTLs) and both are shared
 * with the polling market routes, so an Arena read usually adds no upstream traffic at all. The
 * RSI call asks for the SLOW group only: `rsiSnapshot(false)` covers 1h, 4h and 1d, and the Arena
 * needs no 5m reading. The gather runs AFTER the route's auth, entitlement and coin-ladder gates,
 * so an unauthenticated or refused request causes no upstream call - a bill with no user attached
 * is the thing those gates are ordered that way to prevent.
 */
import { marketSnapshotData } from './marketSnapshotData.ts';
import { rsiSnapshot } from './marketRsi.ts';
import { arenaNumberFields, SERVER_SOURCED_FIELDS, type ServerSourcedField } from './arenaContextFields.ts';
import type { CoinData } from './marketStore.ts';
import type { GrokContext } from './grok.ts';

/** The subset of the context the server overwrites. Empty when the coin is outside its coverage. */
export type ServerNumberFields = Partial<Pick<GrokContext, ServerSourcedField>>;

export type ArenaNumbersResult =
  | {
      ok: true;
      /** Keys to spread over the client's context. Empty means "keep what the client sent". */
      fields: ServerNumberFields;
      /** Which of the twelve were sourced here. `[]` for a coin outside coverage. */
      sourced: readonly ServerSourcedField[];
      /** Snapshot sections that came back empty, passed through for logging. */
      partial: readonly string[];
      /** True when the ticker is populated but holds nothing for this coin (today: `hype`). */
      coinOutsideCoverage: boolean;
    }
  | { ok: false; reason: unknown };

/**
 * Build the Arena's numeric context fields from the server's own feeds.
 *
 * @param coin lowercase tracked coin id, as `arenaContextCoinId()` returns it. The snapshot and the
 *   RSI map are both keyed this way (`SYMS` comes from `BINANCE_SYMS`, whose keys are these ids),
 *   so no case mapping is needed - and getting that wrong would miss every coin and look exactly
 *   like a feed outage.
 */
export async function arenaServerNumbers(coin: string): Promise<ArenaNumbersResult> {
  /* Independent feeds, so allSettled-style independence: an RSI failure must not cost the price.
     marketSnapshotData already returns a result rather than throwing; rsiSnapshot does too. */
  const [snap, rsi] = await Promise.all([marketSnapshotData(), rsiSnapshot(false)]);

  if (!snap.ok) return { ok: false, reason: snap.reason };

  /* THE SECTION, NOT THE COIN. `partial` names a section that came back empty for everyone, which
     is an outage; a coin absent from a populated section is a coverage gap. Only the first is
     refused - see the header. */
  if (snap.data.partial.includes('ticker')) {
    return { ok: false, reason: new Error('market snapshot returned an empty ticker section') };
  }

  const t = snap.data.ticker[coin];
  if (!t) {
    return { ok: true, fields: {}, sourced: [], partial: snap.data.partial, coinOutsideCoverage: true };
  }

  const k = snap.data.klines[coin];
  const r = rsi.ok ? rsi.rsi[coin] : undefined;

  /* The same shape the market store holds, so the shared formatter cannot tell which caller built
     it. Every field is optional and every expression in the formatter guards with `!= null`, so a
     missing feed degrades per field rather than losing the row. */
  const row: Partial<CoinData> = {
    price:         t.price,
    change:        t.change,
    ma20:          k?.ma20,
    volRatio:      k?.volRatio,
    rsi14:         k?.rsi14,
    vwap:          k?.vwap,
    takerBuyRatio: k?.takerBuyRatio,
    poc:           k?.poc,
    vah:           k?.vah,
    val:           k?.val,
    rsi1h:         r?.rsi1h,
    rsi4h:         r?.rsi4h,
    rsiDaily:      r?.rsiDaily,
  };

  /* The formatter produces all thirteen; this takes the twelve the server owns. `longShortRatio`
     is formatted and then dropped on purpose - it reads the Bybit 1h ratio, which this row does
     not carry. SERVER_SOURCED_FIELDS documents why, and the Pick is driven by that list so the day
     it gains a thirteenth entry this loop covers it with no edit here. */
  const all = arenaNumberFields(row);
  const fields: ServerNumberFields = {};
  for (const key of SERVER_SOURCED_FIELDS) fields[key] = all[key];

  return {
    ok: true,
    fields,
    sourced: SERVER_SOURCED_FIELDS,
    partial: snap.data.partial,
    coinOutsideCoverage: false,
  };
}
