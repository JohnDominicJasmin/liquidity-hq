import { strategyUnavailable } from './strategies/availability.ts';
import type { OHLCV } from './strategyCore.ts';
import type { LabelKey } from './labelKeys.ts';
import { STRATEGIES, findStrategy, type StrategyDef, type StrategyContext } from './strategies/index.ts';
import { strategyReasonText } from './strategies/reason.ts';

/* THE ARENA STRATEGY'S CALL, AS THE AI READ IS GIVEN IT (owner order 2026-11-19: "ALL INDICATORS ... MUST BE CONNECTED TO QUICK AND DEEP
 * RESEARCH"). Pure: closed candles and live inputs in, one reading per strategy out. The network half (which candles, which live values) is
 * lib/arenaStrategyServer.ts; the prompt text that presents a reading is lib/grok.ts withStrategyRead.
 *
 * THE SAME DETECTOR CALL AS THE ARENA'S CALL BOX (lib/useStrategySignal.ts) and the fire log (app/api/strategies/track): `def.detect(closed, ctx)`.
 * The reason is the call box's own sentence (lib/strategies/reason.ts).
 *
 * UNKNOWN IS NEVER A WAIT. Too few candles, no candles, a timeframe the strategies do not run on, or a strategy whose live input could not be read
 * is `status: 'none'` with the cause, and the prompt says the strategy has no reading. A WAIT is only ever a WAIT the detector actually returned
 * on the data it needed. */

export type StrategyReading =
  | {
      id: string;
      name: string;
      status: 'ok';
      verdict: 'BUY' | 'SELL' | 'WAIT';
      reason: string;
      entry: number | null;
      stop: number | null;
      target: number | null;
      /** Closed candles since the signal candle (0 = the latest closed candle). Null on a WAIT. */
      barsAgo: number | null;
    }
  | { id: string; name: string; status: 'none'; why: string };

/** What the read is told: the trader's picked strategy, or (picked = none, no chips: "Let the read choose") every strategy for the read to choose from. Null: nothing about strategies (the trader chose Custom indicators only). */
export type ArenaStrategyRead = { mode: 'picked' | 'auto'; readings: StrategyReading[] } | null;

export interface StrategyInputs {
  coin: string;
  tf: string;
  /** Milliseconds per candle; undefined when the strategies do not run on this timeframe. */
  tfMs: number | undefined;
  /** CLOSED candles of the coin on this timeframe, oldest first. Null when the read failed. */
  candles: readonly OHLCV[] | null;
  /** Closed BTC candles on the same timeframe (only needed for a needsBtc strategy on a coin other than BTC). Null when that read failed. */
  btcCandles?: readonly OHLCV[] | null;
  taker?: StrategyContext['taker'];
  fundingClass?: StrategyContext['fundingClass'];
  fundingPct?: number;
  oiChange6Pct?: number | null;
}

type T = (key: LabelKey, vars?: Record<string, string | number>) => string;

/** The fewest closed BTC candles a needsBtc strategy is run with (the fire log's bar, app/api/strategies/track). */
const MIN_BTC_CANDLES = 60;

export function readStrategy(def: StrategyDef, inp: StrategyInputs, t: T): StrategyReading {
  const name = t(def.nameKey);
  const none = (why: string): StrategyReading => ({ id: def.id, name, status: 'none', why });
  if (!inp.tfMs) return none('this strategy does not run on this timeframe');
  const na = strategyUnavailable(def.id, inp.coin, inp.tfMs);
  if (na) return none(t(na.reasonKey, na.vars).replace(/\.$/, ''));   // by design, not a failed read (lib/strategies/availability.ts)
  if (!inp.candles || inp.candles.length === 0) return none('no candles could be read for this coin and timeframe');
  if (inp.candles.length < def.minCandles) return none(`only ${inp.candles.length} closed candles, it needs ${def.minCandles}`);
  const wantsBtc = !!def.needsBtc && inp.coin !== 'btc';
  if (wantsBtc && (inp.btcCandles?.length ?? 0) < MIN_BTC_CANDLES) return none('the BTC candles it compares against could not be read');
  let r: ReturnType<StrategyDef['detect']>;
  try {
    r = def.detect(inp.candles, {
      coin: inp.coin, tf: inp.tf, tfMs: inp.tfMs,
      ...(wantsBtc && inp.btcCandles ? { btcCandles: inp.btcCandles } : {}),
      ...(inp.taker ? { taker: inp.taker } : {}),
      ...(inp.fundingClass ? { fundingClass: inp.fundingClass, fundingPct: inp.fundingPct } : {}),
      oiChange6Pct: inp.oiChange6Pct ?? null,
    });
  } catch {
    return none('it could not be computed on these candles');
  }
  /* A detector that answered WAIT because its live input was missing (the derivatives strategies) has no reading: its "needs ... data" WAIT is
     an unknown, not a call. */
  if (r.params.noLive === true || r.params.noTaker === true) return none(strategyReasonText(def, r, t).replace(/\.$/, ''));
  const num = (k: string) => (typeof r.params[k] === 'number' && Number.isFinite(r.params[k]) ? (r.params[k] as number) : null);
  const last = inp.candles[inp.candles.length - 1];
  return {
    id: def.id,
    name,
    status: 'ok',
    verdict: r.verdict === 'buy' ? 'BUY' : r.verdict === 'sell' ? 'SELL' : 'WAIT',
    reason: strategyReasonText(def, r, t),
    entry: r.verdict === 'wait' ? null : num('entry'),
    /* `stop` where the strategy sets one; else its "wrong if" level (`inv`), which is the stop the call box shows. */
    stop: r.verdict === 'wait' ? null : num('stop') ?? num('inv'),
    target: r.verdict === 'wait' ? null : num('target'),
    barsAgo: r.signalTimestamp != null ? Math.max(0, Math.round((last.time - r.signalTimestamp) / inp.tfMs)) : null,
  };
}

/** The read for a request: the picked strategy, or every strategy when the trader let the read choose, or null (Custom). */
export function arenaStrategyRead(strategyId: string | null, selection: readonly string[], inp: StrategyInputs, t: T): ArenaStrategyRead {
  const picked = findStrategy(strategyId);
  if (picked) return { mode: 'picked', readings: [readStrategy(picked, inp, t)] };
  if (selection.length > 0) return null;
  return { mode: 'auto', readings: STRATEGIES.map(def => readStrategy(def, inp, t)) };
}

/** Which strategies a request needs computed: used by the server to fetch only the inputs those need. */
export function strategiesFor(strategyId: string | null, selection: readonly string[]): readonly StrategyDef[] {
  const picked = findStrategy(strategyId);
  if (picked) return [picked];
  return selection.length > 0 ? [] : STRATEGIES;
}
