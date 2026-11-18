'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CoinId } from './marketStore.ts';
import { fetchOHLCV, TF_BN, TF_BY } from './useEMAStrategy.ts';
import { TF_MS, dropForming, msUntilNextClose } from './candles.ts';
import { findStrategy, type StrategyResult } from './strategies/index.ts';
import { strategyUnavailable, type Unavailable } from './strategies/availability.ts';
import { fetchFundingHistory, fetchOiRelative, fetchTakerMap, fundingClassRelative } from './strategies/liveInputs.ts';

export interface StrategySignalState {
  result: StrategyResult | null;
  loading: boolean;
  error: boolean;
  /** The picked strategy cannot run on this timeframe (it reads closed candles of 1m to 1d only). An honest end state, not a loading one. */
  unsupportedTf?: boolean;
  /** The picked strategy cannot run on this coin or timeframe BY DESIGN (lib/strategies/availability.ts): the call box says why in one line; nothing is fetched. Not an error and not a quiet WAIT. */
  unavailable?: Unavailable;
  /** Runs the read again now (the Retry button of the unavailable state). */
  retry?: () => void;
}

/* Runs the selected Arena strategy (lib/strategies) over the CLOSED candles of the displayed coin and timeframe, and again at each candle close. No strategy selected
 * means no fetch at all. A failed read is `error`, never a quiet "wait": unknown is not neutral. `liqLevels` only adds a note to the reason, it never changes the verdict. */
export function useStrategySignal(coin: CoinId, tf: string, strategyId: string | null, liqLevels?: readonly number[], fundingRate?: number | null): StrategySignalState {
  const [state, setState] = useState<StrategySignalState>({ result: null, loading: false, error: false });
  const [nonce, setNonce] = useState(0);
  const retry = useCallback(() => setNonce(n => n + 1), []);
  const liqRef = useRef(liqLevels);
  liqRef.current = liqLevels;
  const fundingRef = useRef(fundingRate);
  fundingRef.current = fundingRate;

  useEffect(() => {
    const def = findStrategy(strategyId);
    const tfMs = TF_MS[tf];
    if (!def || !tfMs || !TF_BN[tf]) { setState({ result: null, loading: false, error: false, unsupportedTf: !!def }); return; }
    const na = strategyUnavailable(def.id, coin, tfMs);
    if (na) { setState({ result: null, loading: false, error: false, unavailable: na }); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        const wantsBtc = !!def.needsBtc && coin !== 'btc';
        const [raw, btcRaw] = await Promise.all([
          fetchOHLCV(coin, TF_BN[tf], TF_BY[tf], 300),
          wantsBtc ? fetchOHLCV('btc', TF_BN[tf], TF_BY[tf], 300) : Promise.resolve(undefined),
        ]);
        if (cancelled) return;
        const btcCandles = btcRaw ? dropForming(btcRaw, tfMs, Date.now()) : undefined;
        const closed = dropForming(raw, tfMs, Date.now());
        if (closed.length < def.minCandles) { setState({ result: null, loading: false, error: true }); }
        else {
          /* THE LIVE INPUTS OF THE DERIVATIVES STRATEGIES (phase 2): funding from the page's own feed, open interest history and taker volume read now. A failed read is simply absent, which the strategy answers as "needs live data" / "needs taker data", never as no signal. */
          const [history, oi] = def.needsLive ? await Promise.all([fetchFundingHistory(coin).catch(() => null), fetchOiRelative(coin, tf, tfMs).catch(() => null)]) : [null, null];
          /* "Paying heavily" is judged against the coin's own last 90 days (lib/strategies/liveInputs.ts fundingClassRelative); no history is no reading (absent), never a guess. */
          const fc = def.needsLive ? fundingClassRelative(fundingRef.current, history, Date.now()) : null;
          const taker = def.needsTaker ? await fetchTakerMap(coin, TF_BN[tf], 300).catch(() => undefined) : undefined;
          if (cancelled) return;
          setState({ result: def.detect(closed, { coin, tf, tfMs, liqLevels: liqRef.current, btcCandles, ...(fc ?? {}), oiChange6Pct: oi?.oiChange6Pct ?? null, oiExtreme: oi?.oiExtreme ?? null, taker }), loading: false, error: false });
        }
      } catch {
        if (!cancelled) setState({ result: null, loading: false, error: true });
      }
      if (!cancelled) timer = setTimeout(run, Math.max(5_000, msUntilNextClose(tfMs, Date.now()) + 2_000));
    };
    setState({ result: null, loading: true, error: false });
    run();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [coin, tf, strategyId, nonce]);

  return useMemo(() => ({ ...state, retry }), [state, retry]);
}
