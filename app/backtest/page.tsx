'use client';
import { useState } from 'react';
import { CoinId, COINS } from '@/lib/marketStore';
import { runBacktest, BacktestRunResult, runOrderFlowBacktest, OrderFlowBacktestResult } from '@/lib/backtestEngine';
import { SideCard, fmtPct, fmtR } from '@/components/BacktestStatsUI';

const OF_YEARS_BACK = 1; // shorter than EMA's lookback — 15m+1h+4h+funding fetch per coin is much heavier

const TIMEFRAMES = ['30m', '1h', '4h', '1d'] as const;
type TF = typeof TIMEFRAMES[number];

const MAJORS: CoinId[] = ['btc', 'eth', 'sol', 'xrp', 'bnb', 'ltc', 'bch', 'ada'];

const YEARS_BACK_BY_TF: Record<TF, number> = {
  '30m': 2, '1h': 3, '4h': 4, '1d': 4,
};

const WT_VARIANT_LABELS: Record<string, string> = {
  current:         'Current (5-bar window)',
  looseRecency:    'Loose Recency (20-bar)',
  armWindow:       'Arm Window (full cross phase)',
  divergenceOnly:  'Divergence Only (no cross req.)',
  looseThresholds: 'Loose Thresholds (±45 + arm)',
};

export default function BacktestPage() {
  const [tf, setTf]               = useState<TF>('1h');
  const [coinScope, setCoinScope] = useState<'majors' | 'all'>('majors');
  const [running, setRunning]     = useState(false);
  const [progress, setProgress]   = useState<{ done: number; total: number; coin: string } | null>(null);
  const [result, setResult]       = useState<BacktestRunResult | null>(null);
  const [error, setError]         = useState<string | null>(null);

  const [ofRunning, setOfRunning] = useState(false);
  const [ofProgress, setOfProgress] = useState<{ done: number; total: number; coin: string } | null>(null);
  const [ofResult, setOfResult]   = useState<OrderFlowBacktestResult | null>(null);
  const [ofError, setOfError]     = useState<string | null>(null);

  const coins = coinScope === 'majors' ? MAJORS : COINS;

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress({ done: 0, total: coins.length, coin: '' });
    try {
      const res = await runBacktest(coins, tf, YEARS_BACK_BY_TF[tf], (done, total, currentCoin) => {
        setProgress({ done, total, coin: currentCoin.toUpperCase() });
      });
      setResult(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  }

  async function runOrderFlow() {
    setOfRunning(true);
    setOfError(null);
    setOfResult(null);
    setOfProgress({ done: 0, total: coins.length, coin: '' });
    try {
      const res = await runOrderFlowBacktest(coins, OF_YEARS_BACK, (done, total, currentCoin) => {
        setOfProgress({ done, total, coin: currentCoin.toUpperCase() });
      });
      setOfResult(res);
    } catch (err) {
      setOfError(String(err));
    } finally {
      setOfRunning(false);
    }
  }

  return (
    <div>
      <div className="mb-header">
        <div className="mb-title">Strategy Backtest</div>
        <div className="mb-subtitle">EMA ribbon strategy replayed against historical candles — Anti-Chop ON vs OFF, side by side</div>
      </div>

      <div className="frh-range-row">
        {TIMEFRAMES.map(t => (
          <button key={t} className={`frh-range-btn${tf === t ? ' on' : ''}`} onClick={() => setTf(t)} disabled={running}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="frh-range-row">
        <button className={`frh-range-btn${coinScope === 'majors' ? ' on' : ''}`} onClick={() => setCoinScope('majors')} disabled={running}>
          Majors ({MAJORS.length})
        </button>
        <button className={`frh-range-btn${coinScope === 'all' ? ' on' : ''}`} onClick={() => setCoinScope('all')} disabled={running}>
          All Coins ({COINS.length})
        </button>
      </div>

      <p style={{ fontSize: 11, opacity: 0.4, marginBottom: 14 }}>
        Lookback: {YEARS_BACK_BY_TF[tf]} years · Pooled across {coins.length} coin{coins.length !== 1 ? 's' : ''} · Fixed 2:1 R:R per signal (matches live strategy SL/TP rule)
      </p>

      <button
        onClick={run}
        disabled={running}
        style={{
          background: running ? 'rgba(255,255,255,0.06)' : 'var(--purple-bg)',
          color: running ? 'rgba(255,255,255,0.4)' : 'var(--purple)',
          border: `1px solid ${running ? 'var(--bdr)' : 'var(--purple-bdr)'}`,
          borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 700,
          cursor: running ? 'default' : 'pointer', marginBottom: 18,
        }}
      >
        {running
          ? `Running… ${progress?.done ?? 0}/${progress?.total ?? coins.length}${progress?.coin ? ` (${progress.coin})` : ''}`
          : 'Run Backtest'}
      </button>

      {error && (
        <div style={{ color: '#f87171', fontSize: 12, marginBottom: 14 }}>Error: {error}</div>
      )}

      {result && (
        <>
          {result.failedCoins.length > 0 && (
            <div style={{ fontSize: 11, opacity: 0.4, marginBottom: 12 }}>
              Skipped {result.failedCoins.length} coin{result.failedCoins.length !== 1 ? 's' : ''} (no data or fetch error): {result.failedCoins.map(c => c.toUpperCase()).join(', ')}
            </div>
          )}

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 24 }}>
            <SideCard title="ANTI-CHOP ON" stats={result.antiChopOn.stats} color="#34d399" />
            <SideCard title="ANTI-CHOP OFF" stats={result.antiChopOff.stats} color="#f87171" />
          </div>

          <div className="mb-title" style={{ fontSize: 15, marginBottom: 4 }}>WaveTrend Confirming-Layer Tuning</div>
          <p style={{ fontSize: 11, opacity: 0.4, marginBottom: 8 }}>
            Each row requires WaveTrend to also agree before counting an Anti-Chop ON signal as a trade. Compare against the Anti-Chop ON baseline above ({fmtPct(result.antiChopOn.stats.winRate)} win rate, {result.antiChopOn.stats.totalTrades} trades, PF {isFinite(result.antiChopOn.stats.profitFactor) ? result.antiChopOn.stats.profitFactor.toFixed(2) : '∞'}).
          </p>
          <table className="frh-table" style={{ marginBottom: 24 }}>
            <thead>
              <tr>
                <th>Variant</th><th>Trades</th><th>Win Rate</th><th>Avg R</th><th>Profit Factor</th><th>Max DD</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(result.waveTrendVariants).map(([name, side]) => {
                const s = side.stats;
                const beatsBaseline = isFinite(s.profitFactor) && s.profitFactor > result.antiChopOn.stats.profitFactor;
                return (
                  <tr key={name}>
                    <td style={{ fontWeight: 600 }}>{WT_VARIANT_LABELS[name] ?? name}{beatsBaseline ? <span style={{ color: '#4ade80' }}> ▲</span> : ''}</td>
                    <td>{s.totalTrades} ({s.wins}W/{s.losses}L)</td>
                    <td style={{ color: s.winRate >= 0.5 ? '#34d399' : '#f87171' }}>{fmtPct(s.winRate)}</td>
                    <td style={{ color: s.avgR >= 0 ? '#34d399' : '#f87171' }}>{fmtR(s.avgR)}</td>
                    <td style={{ color: beatsBaseline ? '#34d399' : 'var(--txt)' }}>{isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'}</td>
                    <td>-{s.maxDrawdownR.toFixed(2)}R</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mb-title" style={{ fontSize: 15, marginBottom: 8 }}>Per-Coin Breakdown (Anti-Chop ON)</div>
          <table className="frh-table">
            <thead>
              <tr>
                <th>Coin</th><th>Trades</th><th>Win Rate</th><th>Avg R</th><th>Profit Factor</th>
              </tr>
            </thead>
            <tbody>
              {result.coins.filter(c => result.antiChopOn.perCoin[c]).map(c => {
                const s = result.antiChopOn.perCoin[c]!;
                return (
                  <tr key={c}>
                    <td style={{ fontWeight: 600 }}>{c.toUpperCase()}</td>
                    <td>{s.totalTrades} ({s.wins}W/{s.losses}L)</td>
                    <td style={{ color: s.winRate >= 0.5 ? '#34d399' : '#f87171' }}>{fmtPct(s.winRate)}</td>
                    <td style={{ color: s.avgR >= 0 ? '#34d399' : '#f87171' }}>{fmtR(s.avgR)}</td>
                    <td>{isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <div style={{ borderTop: '1px solid var(--bdr)', margin: '32px 0 20px' }} />

      <div className="mb-header">
        <div className="mb-title">Order Flow Setup Validation</div>
        <div className="mb-subtitle">
          Tests the Arena page&apos;s &quot;Order Flow Setup&quot; card — but only the 5 signals that can be faithfully
          replayed from history: RSI on 15m/1h/4h, price vs POC, price vs VWAP, and funding rate.
        </div>
      </div>

      <p style={{ fontSize: 11, opacity: 0.4, marginBottom: 14, maxWidth: 640 }}>
        Open Interest trend, CVD divergence, and taker buy ratio (3 of the live card&apos;s 8 signals) are
        intentionally excluded — those need trade-level/positioning data exchanges don&apos;t retain far enough
        back to backtest meaningfully (Binance&apos;s OI history, for example, only goes back ~30 days). Lookback
        is {OF_YEARS_BACK} year{OF_YEARS_BACK !== 1 ? 's' : ''} (shorter than the EMA backtest above — fetching
        15m+1h+4h+funding per coin is a much heavier pull) · uses the same coin scope selected above ({coins.length} coins).
      </p>

      <button
        onClick={runOrderFlow}
        disabled={ofRunning}
        style={{
          background: ofRunning ? 'rgba(255,255,255,0.06)' : 'rgba(251,191,36,0.1)',
          color: ofRunning ? 'rgba(255,255,255,0.4)' : '#fbbf24',
          border: `1px solid ${ofRunning ? 'var(--bdr)' : 'rgba(251,191,36,0.3)'}`,
          borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 700,
          cursor: ofRunning ? 'default' : 'pointer', marginBottom: 18,
        }}
      >
        {ofRunning
          ? `Running… ${ofProgress?.done ?? 0}/${ofProgress?.total ?? coins.length}${ofProgress?.coin ? ` (${ofProgress.coin})` : ''}`
          : 'Run Order Flow Backtest'}
      </button>

      {ofError && (
        <div style={{ color: '#f87171', fontSize: 12, marginBottom: 14 }}>Error: {ofError}</div>
      )}

      {ofResult && (
        <>
          {ofResult.failedCoins.length > 0 && (
            <div style={{ fontSize: 11, opacity: 0.4, marginBottom: 12 }}>
              Skipped {ofResult.failedCoins.length} coin{ofResult.failedCoins.length !== 1 ? 's' : ''} (no data or fetch error): {ofResult.failedCoins.map(c => c.toUpperCase()).join(', ')}
            </div>
          )}

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 24 }}>
            <SideCard title="ORDER FLOW SETUP (5 SIGNALS)" stats={ofResult.side.stats} color="#fbbf24" />
          </div>

          <div className="mb-title" style={{ fontSize: 15, marginBottom: 8 }}>Per-Coin Breakdown</div>
          <table className="frh-table">
            <thead>
              <tr>
                <th>Coin</th><th>Trades</th><th>Win Rate</th><th>Avg R</th><th>Profit Factor</th>
              </tr>
            </thead>
            <tbody>
              {ofResult.coins.filter(c => ofResult.side.perCoin[c]).map(c => {
                const s = ofResult.side.perCoin[c]!;
                return (
                  <tr key={c}>
                    <td style={{ fontWeight: 600 }}>{c.toUpperCase()}</td>
                    <td>{s.totalTrades} ({s.wins}W/{s.losses}L)</td>
                    <td style={{ color: s.winRate >= 0.5 ? '#34d399' : '#f87171' }}>{fmtPct(s.winRate)}</td>
                    <td style={{ color: s.avgR >= 0 ? '#34d399' : '#f87171' }}>{fmtR(s.avgR)}</td>
                    <td>{isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
