import labelDefaults from './labelDefaults.en.json';
import type { LabelKey } from './labelKeys.ts';
import { binanceFuturesSymbol, coinRow } from './coins.ts';
import { deadlineSignal } from './deadlineSignal.ts';
import { exchangeFetch } from './exchangeGuard.ts';
import { closedCandles, EMA_SIGNAL_TFS, fetchRibbonCandles, type EMASignalTF } from './ribbonCandles.ts';
import { FUNDING_WINDOW_DAYS, OI_ROWS, fundingClassRelative, oiRelative, parseBinanceFunding, parseBybitFunding, type FundingPoint } from './strategies/liveInputs.ts';
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

async function closedFor(coin: string, tf: EMASignalTF, limit = 300): Promise<StrategyInputs['candles']> {
  try {
    const all = await fetchRibbonCandles(coin, tf, undefined, limit);
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

/* THE FUNDING HISTORY, SERVER SIDE: the same rule as the browser's (lib/strategies/liveInputs.ts fundingClassRelative, the coin's own settled funding of the last 90 days paged by TIME), read straight from the exchange and kept 30 minutes per coin. */
const FUNDING_CACHE_MS = 30 * 60_000;
const fundingCache = new Map<string, { at: number; pts: FundingPoint[] }>();

async function fundingHistoryFor(coin: string): Promise<FundingPoint[] | null> {
  const hit = fundingCache.get(coin);
  const now = Date.now();
  if (hit && now - hit.at < FUNDING_CACHE_MS) return hit.pts;
  const start = now - FUNDING_WINDOW_DAYS * 86_400_000;
  const bn = binanceFuturesSymbol(coin);
  const by = coinRow(coin)?.bybit ?? undefined;
  const get = async (url: string): Promise<unknown> => {
    const r = await exchangeFetch(url, { cache: 'no-store', signal: deadlineSignal(6_000) });
    return r.ok ? r.json() : null;
  };
  const out: FundingPoint[] = [];
  try {
    if (bn) {
      let cursor = start;
      for (let page = 0; page < 6; page++) {
        const rows = parseBinanceFunding(await get(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${bn}&startTime=${cursor}&endTime=${now}&limit=1000`));
        if (!rows.length) break;
        out.push(...rows);
        const last = rows[rows.length - 1].time;
        if (rows.length < 1000 || last <= cursor) break;
        cursor = last + 1;
      }
    }
    if (!out.length && by) {
      let upper = now;
      for (let page = 0; page < 14; page++) {
        const rows = parseBybitFunding(await get(`https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${by}&startTime=${start}&endTime=${upper}&limit=200`));
        if (!rows.length) break;
        out.push(...rows);
        const oldest = Math.min(...rows.map(p => p.time));
        if (rows.length < 200 || oldest <= start) break;
        upper = oldest - 1;
      }
      out.sort((a, b) => a.time - b.time);
    }
  } catch { /* what was read so far is judged below: too little history is no reading */ }
  if (!out.length) return null;
  fundingCache.set(coin, { at: now, pts: out });
  return out;
}

/** The inputs the page hands the squeeze strategy (lib/useStrategySignal.ts), judged the same way: funding against the coin's own 90 days, open interest against its own recent changes. Either missing is left absent. */
async function liveFor(coin: string, tf: EMASignalTF): Promise<Pick<StrategyInputs, 'fundingClass' | 'fundingPct' | 'oiChange6Pct' | 'oiExtreme'>> {
  const sym = binanceFuturesSymbol(coin);
  if (!sym) return {};
  const [rate, history, oi] = await Promise.all([
    exchangeFetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`, { cache: 'no-store', signal: deadlineSignal(6_000) })
      .then(async r => (r.ok ? Number(((await r.json()) as { lastFundingRate?: string }).lastFundingRate) : null))
      .catch(() => null),
    fundingHistoryFor(coin).catch(() => null),
    exchangeFetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}&period=${tf}&limit=${OI_ROWS}`, { cache: 'no-store', signal: deadlineSignal(6_000) })
      .then(async r => (r.ok ? oiRelative((await r.json()) as never, TF_MS[tf]) : null))
      .catch(() => null),
  ]);
  const funding = fundingClassRelative(rate, history, Date.now());
  return { ...(funding ?? {}), oiChange6Pct: oi?.oiChange6Pct ?? null, oiExtreme: oi?.oiExtreme ?? null };
}

export async function serverStrategyRead(coin: string, tf: string, strategyId: string | null, selection: readonly string[]): Promise<ArenaStrategyRead> {
  const defs = strategiesFor(strategyId, selection);
  const supported = (EMA_SIGNAL_TFS as readonly string[]).includes(tf);
  const stf = tf as EMASignalTF;
  const inputs: StrategyInputs = { coin, tf, tfMs: supported ? TF_MS[stf] : undefined, candles: null };
  if (defs.length && supported) {
    const needsBtc = coin !== 'btc' && defs.some(d => d.needsBtc);
    const [candles, btcCandles, taker, live] = await Promise.all([
      closedFor(coin, stf, Math.max(300, ...defs.map(d => d.candleLimit ?? 300))),
      needsBtc ? closedFor('btc', stf) : Promise.resolve(undefined),
      defs.some(d => d.needsTaker) ? takerFor(coin, stf) : Promise.resolve(undefined),
      defs.some(d => d.needsLive) ? liveFor(coin, stf) : Promise.resolve({}),
    ]);
    Object.assign(inputs, { candles, btcCandles, taker }, live);
  }
  return arenaStrategyRead(strategyId, selection, inputs, tEn);
}
