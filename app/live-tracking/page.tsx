'use client';
import { useState, useEffect } from 'react';
import { getSupabase } from '@/lib/supabase';
import { T } from '@/lib/tables';
import { CoinId } from '@/lib/marketStore';
import { computeStats, SimulatedTrade, BacktestStats } from '@/lib/backtestEngine';
import { SideCard, fmtPct, fmtR } from '@/components/BacktestStatsUI';
import EmptyState from '@/components/EmptyState';
import Tip from '@/components/Tip';
import LoadingState from '@/components/LoadingState';

interface LiveSignalRow {
  id: number;
  coin: string;
  tf: string;
  dir: 'long' | 'short';
  entry_price: number;
  sl: number;
  tp: number;
  signal_time: string;
  outcome: 'open' | 'win' | 'loss';
  exit_price: number | null;
  exit_time: string | null;
  r_multiple: number | null;
  created_at: string;
}

function rowToTrade(r: LiveSignalRow): SimulatedTrade {
  return {
    coin: r.coin as CoinId,
    dir: r.dir,
    entryTime: new Date(r.signal_time).getTime(),
    entryPrice: r.entry_price,
    sl: r.sl,
    tp: r.tp,
    exitTime: r.exit_time ? new Date(r.exit_time).getTime() : null,
    exitPrice: r.exit_price,
    outcome: r.outcome,
    rMultiple: r.r_multiple ?? 0,
  };
}

export default function LiveTrackingPage() {
  const [rows, setRows]       = useState<LiveSignalRow[] | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sb = getSupabase();
      if (!sb) { setError('Supabase not configured'); setLoading(false); return; }
      const { data, error: err } = await sb
        .from(T.live_signals)
        .select('*')
        .order('signal_time', { ascending: true })
        .limit(5000); // safety cap - this table grows continuously via the tracking cron
      if (cancelled) return;
      if (err) setError(err.message);
      else setRows(data as LiveSignalRow[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const trades = (rows ?? []).map(rowToTrade);
  const stats: BacktestStats = computeStats(trades);

  const perCoin = new Map<string, LiveSignalRow[]>();
  for (const r of rows ?? []) {
    if (!perCoin.has(r.coin)) perCoin.set(r.coin, []);
    perCoin.get(r.coin)!.push(r);
  }

  const recent = [...(rows ?? [])].sort((a, b) => +new Date(b.signal_time) - +new Date(a.signal_time)).slice(0, 30);

  return (
    <div>
      <div className="mb-header">
        <h1 className="mb-title">Live Outcome Tracking</h1>
        <div className="mb-subtitle">
          Real EMA Ribbon signals (default filter, majors, 1h + 4h) as they actually fired - not a replay.
          Complements the historical backtest by validating the strategy against current market conditions.
        </div>
      </div>

      {loading && <LoadingState message="Loading…" />}
      {error && <div style={{ color: '#f87171', fontSize: 'var(--fs-caption)' }}>Error: {error}</div>}

      {!loading && !error && rows && rows.length === 0 && (
        <EmptyState
          title="No signals logged yet"
          sub="This page populates as the live tracker detects and resolves real EMA Ribbon signals over time."
        />
      )}

      {!loading && !error && rows && rows.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 24 }}>
            <SideCard title="LIVE (ANTI-CHOP ON)" stats={stats} color="#34d399" />
          </div>

          <h2 className="mb-title" style={{ fontSize: 'var(--fs-card-title)', marginBottom: 8 }}>Per-Coin Breakdown</h2>
          <div style={{ overflowX: 'auto', marginBottom: 24 }}>
            <table className="frh-table">
              <thead>
                <tr>
                  <th>Coin</th><th>Trades</th><th>Win Rate</th>
                  <th><Tip width={220} text="R = risk multiple. +1R means the trade won exactly what was risked (distance to stop-loss); +2R means it won double. Avg R across all trades tells you if wins are outsized enough to cover the losses.">Avg R</Tip></th>
                  <th><Tip width={220} text="Total profit from winning trades divided by total loss from losing trades. Above 1.0 means the strategy is net profitable over this sample; below 1.0 means it's losing money even if the win rate looks decent.">Profit Factor</Tip></th>
                </tr>
              </thead>
              <tbody>
                {[...perCoin.entries()].map(([coin, coinRows]) => {
                  const s = computeStats(coinRows.map(rowToTrade));
                  return (
                    <tr key={coin}>
                      <td style={{ fontWeight: 600 }}>{coin.toUpperCase()}</td>
                      <td>{s.totalTrades} ({s.wins}W/{s.losses}L/{s.open} open)</td>
                      <td style={{ color: s.winRate >= 0.5 ? '#34d399' : '#f87171' }}>{fmtPct(s.winRate)}</td>
                      <td style={{ color: s.avgR >= 0 ? '#34d399' : '#f87171' }}>{fmtR(s.avgR)}</td>
                      <td>{isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h2 className="mb-title" style={{ fontSize: 'var(--fs-card-title)', marginBottom: 8 }}>Recent Signals</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="frh-table">
              <thead>
                <tr>
                  <th>Coin</th><th>TF</th><th>Dir</th><th>Entry</th><th>Signal Time</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(r => {
                  const statusCol = r.outcome === 'win' ? '#34d399' : r.outcome === 'loss' ? '#f87171' : 'var(--txt3)';
                  const statusLabel = r.outcome === 'win' ? `WIN (${r.r_multiple != null ? '+' + r.r_multiple.toFixed(2) + 'R' : ''})`
                    : r.outcome === 'loss' ? 'LOSS (-1R)'
                    : 'OPEN';
                  return (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.coin.toUpperCase()}</td>
                      <td>{r.tf.toUpperCase()}</td>
                      <td style={{ color: r.dir === 'long' ? '#34d399' : '#f87171' }}>{r.dir.toUpperCase()}</td>
                      <td>${r.entry_price.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                      <td style={{ fontSize: 'var(--fs-caption)', opacity: 0.6 }}>{new Date(r.signal_time).toLocaleString()}</td>
                      <td style={{ color: statusCol, fontWeight: 600 }}>{statusLabel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
