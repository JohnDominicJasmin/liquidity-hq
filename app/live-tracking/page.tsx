'use client';
import { useState, useEffect } from 'react';
import { getSupabase } from '@/lib/supabase';
import { useLabels } from '@/lib/labels';
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
  const { t } = useLabels();
  const [rows, setRows]       = useState<LiveSignalRow[] | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sb = getSupabase();
      if (!sb) { setError(t('LIVE_TRACKING_ERROR_SUPABASE_NOT_CONFIGURED')); setLoading(false); return; }
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
        <h1 className="mb-title">{t('LIVE_TRACKING_TITLE')}</h1>
        <div className="mb-subtitle">
          {t('LIVE_TRACKING_SUBTITLE')}
        </div>
      </div>

      {loading && <LoadingState message={t('LIVE_TRACKING_LOADING')} />}
      {error && <div style={{ color: '#f87171', fontSize: 'var(--fs-caption)' }}>{t('LIVE_TRACKING_ERROR', { message: error })}</div>}

      {!loading && !error && rows && rows.length === 0 && (
        <EmptyState
          title={t('LIVE_TRACKING_EMPTY_TITLE')}
          sub={t('LIVE_TRACKING_EMPTY_SUB')}
        />
      )}

      {!loading && !error && rows && rows.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 24 }}>
            <SideCard title={t('LIVE_TRACKING_LIVE_SIDECARD_TITLE')} stats={stats} color="#34d399" />
          </div>

          <h2 className="mb-title" style={{ fontSize: 'var(--fs-card-title)', marginBottom: 8 }}>{t('LIVE_TRACKING_PER_COIN_BREAKDOWN')}</h2>
          <div style={{ overflowX: 'auto', marginBottom: 24 }}>
            <table className="frh-table">
              <thead>
                <tr>
                  <th>{t('LIVE_TRACKING_TABLE_COIN')}</th><th>{t('LIVE_TRACKING_TABLE_TRADES')}</th><th>{t('LIVE_TRACKING_TABLE_WIN_RATE')}</th>
                  <th><Tip width={220} text={t('LIVE_TRACKING_TIP_AVG_R')}>{t('LIVE_TRACKING_TABLE_AVG_R')}</Tip></th>
                  <th><Tip width={220} text={t('LIVE_TRACKING_TIP_PROFIT_FACTOR')}>{t('LIVE_TRACKING_TABLE_PROFIT_FACTOR')}</Tip></th>
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

          <h2 className="mb-title" style={{ fontSize: 'var(--fs-card-title)', marginBottom: 8 }}>{t('LIVE_TRACKING_RECENT_SIGNALS')}</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="frh-table">
              <thead>
                <tr>
                  <th>{t('LIVE_TRACKING_TABLE_COIN')}</th><th>{t('LIVE_TRACKING_TABLE_TF')}</th><th>{t('LIVE_TRACKING_TABLE_DIR')}</th><th>{t('LIVE_TRACKING_TABLE_ENTRY')}</th><th>{t('LIVE_TRACKING_TABLE_SIGNAL_TIME')}</th><th>{t('LIVE_TRACKING_TABLE_STATUS')}</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(r => {
                  const statusCol = r.outcome === 'win' ? '#34d399' : r.outcome === 'loss' ? '#f87171' : 'var(--txt3)';
                  const statusLabel = r.outcome === 'win' ? t('LIVE_TRACKING_STATUS_WIN', { multiple: r.r_multiple != null ? '+' + r.r_multiple.toFixed(2) + 'R' : '' })
                    : r.outcome === 'loss' ? t('LIVE_TRACKING_STATUS_LOSS')
                    : t('LIVE_TRACKING_STATUS_OPEN');
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
