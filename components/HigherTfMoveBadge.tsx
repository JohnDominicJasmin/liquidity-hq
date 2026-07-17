'use client';
import { useEffect, useState } from 'react';
import type { CoinId } from '@/lib/marketStore';
import { BINANCE_SYMS, BYBIT_SYMS } from '@/lib/coins';
import Tip from './Tip';
import { Warn } from './icons';

// Informational only - NOT a signal filter. Backtested three separate hard-suppression
// approaches this session (same-TF range position, same-TF choppiness, higher-TF RSI/
// price-change/choppiness - 10 variants across 6 coin/TF combos) and none showed a
// reliable edge: sometimes helped a little, sometimes catastrophically removed the best
// trades (e.g. SOL 15m RSI 65/35 turned +3R into -6R by suppressing signals that were
// 83% winners). A blunt threshold can't reliably tell "exhausted chop" from "a genuine
// trend leg that already moved" - both look identical to these metrics in the moment.
// So instead of guessing for the trader, this surfaces the 4h context and lets them judge.

const LOWER_TFS = new Set(['1m', '5m', '15m', '30m']);
const LOOKBACK_BARS = 6; // ~24h of 4h candles
const MOVE_THRESHOLD_PCT = 6;
const REFRESH_MS = 5 * 60_000;

interface Props { coin: CoinId; tf: string; signalDir: 'long' | 'short' | null }

export default function HigherTfMoveBadge({ coin, tf, signalDir }: Props) {
  const [changePct, setChangePct] = useState<number | null>(null);

  useEffect(() => {
    setChangePct(null);
    if (!LOWER_TFS.has(tf)) return;
    let cancelled = false;

    async function load() {
      try {
        const bn = BINANCE_SYMS[coin];
        const by = BYBIT_SYMS[coin];
        let closes: number[] = [];
        if (bn) {
          const r = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${bn}&interval=4h&limit=${LOOKBACK_BARS + 1}`);
          const raw = await r.json() as (string | number)[][];
          closes = raw.map(k => +k[4]);
        } else if (by) {
          const r = await fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${by}&interval=240&limit=${LOOKBACK_BARS + 1}`);
          const d = await r.json() as { result?: { list?: string[][] } };
          closes = [...(d?.result?.list ?? [])].reverse().map(k => +k[4]);
        }
        if (closes.length < LOOKBACK_BARS + 1) return;
        const now = closes[closes.length - 1], then = closes[closes.length - 1 - LOOKBACK_BARS];
        if (!cancelled && then > 0) setChangePct(((now - then) / then) * 100);
      } catch { /* silent - informational only */ }
    }
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [coin, tf]);

  if (!LOWER_TFS.has(tf) || changePct == null || Math.abs(changePct) < MOVE_THRESHOLD_PCT) return null;

  const pumped = changePct > 0;
  const agrees = signalDir != null && ((pumped && signalDir === 'long') || (!pumped && signalDir === 'short'));
  const col = '#fbbf24';

  return (
    <div style={{
      margin: '0 0 10px', fontSize: '0.6875rem', fontWeight: 600, lineHeight: 1.5,
      color: col, padding: '8px 10px', borderRadius: 8,
      background: col + '14', border: `0.5px solid ${col}44`,
    }}>
      <Tip
        width={280}
        iconColor={col + '99'}
        text="Informational only, not a filter - no signal is hidden based on this. 4h price moves this size sometimes precede sideways chop, sometimes continue trending; a fixed rule can't reliably tell which in advance, so this just surfaces the context for you to judge."
      >
        <Warn /> 4H {pumped ? 'pumped' : 'dumped'} {Math.abs(changePct).toFixed(1)}% in ~24h
      </Tip>
      {agrees && <span> - this {signalDir === 'long' ? 'buy' : 'sell'} signal is chasing the same direction. Could be continuation, could be relief-rally chop.</span>}
    </div>
  );
}
