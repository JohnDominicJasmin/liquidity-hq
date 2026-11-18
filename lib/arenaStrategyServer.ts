import labelDefaults from './labelDefaults.en.json';
import type { LabelKey } from './labelKeys.ts';
import { binanceFuturesSymbol, coinRow } from './coins.ts';
import { deadlineSignal } from './deadlineSignal.ts';
import { exchangeFetch } from './exchangeGuard.ts';
import { closedCandles, EMA_SIGNAL_TFS, fetchRibbonCandles, type EMASignalTF } from './ribbonCandles.ts';
import { fundingClassOf, oiChange6 } from './strategies/liveInputs.ts';
import { arenaStrategyRead, strategiesFor, type ArenaStrategyRead, type StrategyInputs } from './arenaStrategyRead.ts';

/* THE SERVER COMPUTES THE PICKED STRATEGY ITSELF (owner order 2026-11-19). The request carries only the strategy's id; this reads the closed
 * candles of the request's coin and timeframe from the same shared, cached source the Arena's server chart and the strategy fire log use
 * (lib/ribbonCandles.ts fetchRibbonCandles + closedCandles), plus the live inputs a derivatives strategy needs, and runs the detector on them
 * (lib/arenaStrategyRead.ts). A strategy result sent by the browser is never read: there is no field for one.
 *
 * NEVER THROWS. A failed read becomes `status: 'none'` on the affected strategies (lib/arenaStrategyRead.ts), so the AI read still runs and the
 * prompt says the strategy has no reading. Inputs a request does not need are not fetched. */

const LABELS = labelDefaults as Record<string, string>;

/** The shipped English label for a key, with {placeholders} filled the way the page's t() fills them (lib/labels.ts interpolate). */
function tEn(key: LabelKey, vars?: Record<string, string | number>): string {
  const template = LABELS[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));
}

const TF_MS: Record<EMASignalTF, number> = {
  '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '1d': 86_400_000,
};

async function closedFor(coin: string, tf: EMASignalTF): Promise<StrategyInputs['candles']> {
  try {
    const all = await fetchRibbonCandles(coin, tf);
    return all.length ? closedCandles(all, tf) : null;
  } catch {
    return null;
  }
}

/** Per-candle taker buy / sell volume from Binance futures klines (index 9 = taker buy base volume), the fire log's source. Undefined when unreadable. */
async function takerFor(coin: string, tf: EMASignalTF): Promise<StrategyInputs['taker']> {
  const sym = binanceFuturesSymbol(coin);
  if (!sym) return undefined;
  try {
    const res = await exchangeFetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${tf}&limit=300`, { cache: 'no-store', signal: deadlineSignal(9_000) });
    if (!res.ok) return undefined;
    const raw = (await res.json()) as (string | number)[][];
    if (!Array.isArray(raw)) return undefined;
    const m = new Map<number, { buy: number; sell: number }>();
    for (const k of raw) {
      const vol = +k[5], buy = +k[9];
      if (Number.isFinite(vol) && Number.isFinite(buy)) m.set(+k[0], { buy, sell: vol - buy });
    }
    return m.size ? m : undefined;
  } catch {
    return undefined;
  }
}

/** Funding class + open-interest change over the last 6 candles, the inputs the page hands the squeeze strategy (lib/useStrategySignal.ts). Either missing is left absent. */
async function liveFor(coin: string, tf: EMASignalTF): Promise<Pick<StrategyInputs, 'fundingClass' | 'fundingPct' | 'oiChange6Pct'>> {
  const sym = binanceFuturesSymbol(coin);
  if (!sym) return {};
  const [funding, oi] = await Promise.all([
    exchangeFetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`, { cache: 'no-store', signal: deadlineSignal(6_000) })
      .then(async r => (r.ok ? fundingClassOf(Number(((await r.json()) as { lastFundingRate?: string }).lastFundingRate)) : null))
      .catch(() => null),
    exchangeFetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}&period=${tf}&limit=7`, { cache: 'no-store', signal: deadlineSignal(6_000) })
      .then(async r => (r.ok ? oiChange6((await r.json()) as never, TF_MS[tf]) : null))
      .catch(() => null),
  ]);
  return { ...(funding ?? {}), oiChange6Pct: oi };
}

export async function serverStrategyRead(coin: string, tf: string, strategyId: string | null, selection: readonly string[]): Promise<ArenaStrategyRead> {
  const defs = strategiesFor(strategyId, selection);
  const supported = (EMA_SIGNAL_TFS as readonly string[]).includes(tf);
  const stf = tf as EMASignalTF;
  const inputs: StrategyInputs = { coin, tf, tfMs: supported ? TF_MS[stf] : undefined, candles: null };
  if (defs.length && supported) {
    const needsBtc = coin !== 'btc' && defs.some(d => d.needsBtc);
    const [candles, btcCandles, taker, live] = await Promise.all([
      closedFor(coin, stf),
      needsBtc ? closedFor('btc', stf) : Promise.resolve(undefined),
      defs.some(d => d.needsTaker) ? takerFor(coin, stf) : Promise.resolve(undefined),
      defs.some(d => d.needsLive) ? liveFor(coin, stf) : Promise.resolve({}),
    ]);
    Object.assign(inputs, { candles, btcCandles, taker }, live);
  }
  return arenaStrategyRead(strategyId, selection, inputs, tEn);
}
