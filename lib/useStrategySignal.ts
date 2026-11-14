'use client';
import { useEffect, useRef, useState } from 'react';
import type { CoinId } from './marketStore.ts';
import { fetchOHLCV, TF_BN, TF_BY } from './useEMAStrategy.ts';
import { TF_MS, dropForming, msUntilNextClose } from './candles.ts';
import { findStrategy, type StrategyResult } from './strategies/index.ts';

export interface StrategySignalState {
  result: StrategyResult | null;
  loading: boolean;
  error: boolean;
}

/* Runs the selected Arena strategy (lib/strategies) over the CLOSED candles of the displayed coin and timeframe, and again at each candle close. No strategy selected
 * means no fetch at all. A failed read is `error`, never a quiet "wait": unknown is not neutral. `liqLevels` only adds a note to the reason, it never changes the verdict. */
export function useStrategySignal(coin: CoinId, tf: string, strategyId: string | null, liqLevels?: readonly number[]): StrategySignalState {
  const [state, setState] = useState<StrategySignalState>({ result: null, loading: false, error: false });
  const liqRef = useRef(liqLevels);
  liqRef.current = liqLevels;

  useEffect(() => {
    const def = findStrategy(strategyId);
    const tfMs = TF_MS[tf];
    if (!def || !tfMs || !TF_BN[tf]) { setState({ result: null, loading: false, error: false }); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        const raw = await fetchOHLCV(coin, TF_BN[tf], TF_BY[tf], 300);
        if (cancelled) return;
        const closed = dropForming(raw, tfMs, Date.now());
        if (closed.length < def.minCandles) { setState({ result: null, loading: false, error: true }); }
        else setState({ result: def.detect(closed, { coin, tf, tfMs, liqLevels: liqRef.current }), loading: false, error: false });
      } catch {
        if (!cancelled) setState({ result: null, loading: false, error: true });
      }
      if (!cancelled) timer = setTimeout(run, Math.max(5_000, msUntilNextClose(tfMs, Date.now()) + 2_000));
    };
    setState({ result: null, loading: true, error: false });
    run();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [coin, tf, strategyId]);

  return state;
}
