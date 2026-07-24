'use client';
import { useState } from 'react';
import { CoinId, COINS } from '@/lib/marketStore';
import { runBacktest, BacktestRunResult, runOrderFlowBacktest, OrderFlowBacktestResult, ROUND_TRIP_COST_PCT, TAKER_FEE_PCT, SLIPPAGE_PCT } from '@/lib/backtestEngine';
import { SideCard, fmtPct, fmtR } from '@/components/BacktestStatsUI';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { FullPageUpgradeGate } from '@/components/UpgradeGateModal';
import LoadingState from '@/components/LoadingState';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';

const OF_YEARS_BACK = 1; // shorter than EMA's lookback - 15m+1h+4h+funding fetch per coin is much heavier

const TIMEFRAMES = ['30m', '1h', '4h', '1d'] as const;
type TF = typeof TIMEFRAMES[number];

const MAJORS: CoinId[] = ['btc', 'eth', 'sol', 'xrp', 'bnb', 'ltc', 'bch', 'ada'];

const YEARS_BACK_BY_TF: Record<TF, number> = {
  '30m': 2, '1h': 3, '4h': 4, '1d': 4,
};

const WT_VARIANT_LABEL_KEYS: Record<string, LabelKey> = {
  current:         'BACKTEST_WT_VARIANT_CURRENT',
  tightRecency:    'BACKTEST_WT_VARIANT_TIGHT_RECENCY',
  armWindow:       'BACKTEST_WT_VARIANT_ARM_WINDOW',
  divergenceOnly:  'BACKTEST_WT_VARIANT_DIVERGENCE_ONLY',
  looseThresholds: 'BACKTEST_WT_VARIANT_LOOSE_THRESHOLDS',
};

const SMC_TFS = ['5m', '15m', '30m', '1h', '4h', '1d'] as const;
type SMCTF = typeof SMC_TFS[number];

const SMC_SECTIONS: Array<{ key: string; labelKey: LabelKey; color?: string }> = [
  { key: 'MARKET_STRUCTURE', labelKey: 'BACKTEST_SMC_SECTION_MARKET_STRUCTURE', color: 'var(--accent)' },
  { key: 'FAIR_VALUE_GAPS',  labelKey: 'BACKTEST_SMC_SECTION_FAIR_VALUE_GAPS',  color: 'var(--amber)' },
  { key: 'ORDER_BLOCKS',     labelKey: 'BACKTEST_SMC_SECTION_ORDER_BLOCKS',     color: 'var(--orange)' },
  { key: 'LIQUIDITY_ZONES',  labelKey: 'BACKTEST_SMC_SECTION_LIQUIDITY_ZONES',  color: 'var(--accent-2)' },
  { key: 'BIAS',             labelKey: 'BACKTEST_SMC_SECTION_DIRECTIONAL_BIAS'                   },
  { key: 'KEY_LEVELS',       labelKey: 'BACKTEST_SMC_SECTION_KEY_LEVELS',       color: 'var(--green)' },
];

const UNLOCK_SECTIONS: Array<{ key: string; labelKey: LabelKey; color?: string }> = [
  { key: 'CURRENT_SUPPLY',     labelKey: 'BACKTEST_UL_SECTION_CURRENT_SUPPLY'                         },
  { key: 'UNLOCK_SCHEDULE',    labelKey: 'BACKTEST_UL_SECTION_UNLOCK_SCHEDULE',    color: 'var(--amber)'   },
  { key: 'SELL_PRESSURE_30D',  labelKey: 'BACKTEST_UL_SECTION_SELL_PRESSURE_30D', color: 'var(--red)' },
  { key: 'SELL_PRESSURE_90D',  labelKey: 'BACKTEST_UL_SECTION_SELL_PRESSURE_90D', color: 'var(--orange)' },
  { key: 'HISTORICAL_PATTERN', labelKey: 'BACKTEST_UL_SECTION_HISTORICAL_PATTERN'                      },
  { key: 'RECOMMENDATION',     labelKey: 'BACKTEST_UL_SECTION_RECOMMENDATION',     color: 'var(--green)'   },
];

function parseSMCSection(text: string, key: string): string {
  const keys = SMC_SECTIONS.map(s => s.key);
  const regex = new RegExp(key + ':\\s*([\\s\\S]*?)(?=' + keys.join(':|') + ':|$)');
  return (text.match(regex)?.[1] ?? '').trim();
}

function parseUnlockSection(text: string, key: string): string {
  const keys = UNLOCK_SECTIONS.map(s => s.key);
  const regex = new RegExp(key + ':\\s*([\\s\\S]*?)(?=' + keys.join(':|') + ':|$)');
  return (text.match(regex)?.[1] ?? '').trim();
}

const STRATEGY_SECTIONS: Array<{ key: string; labelKey: LabelKey; color?: string }> = [
  { key: 'THEORETICAL_EDGE',      labelKey: 'BACKTEST_SR_SECTION_THEORETICAL_EDGE' },
  { key: 'OPTIMAL_CONDITIONS',    labelKey: 'BACKTEST_SR_SECTION_OPTIMAL_CONDITIONS' },
  { key: 'KEY_RISKS',             labelKey: 'BACKTEST_SR_SECTION_KEY_RISKS', color: 'var(--red)' },
  { key: 'PARAMETER_SUGGESTIONS', labelKey: 'BACKTEST_SR_SECTION_PARAMETER_SUGGESTIONS', color: 'var(--green)' },
  { key: 'CRYPTO_NOTES',          labelKey: 'BACKTEST_SR_SECTION_CRYPTO_NOTES', color: 'var(--amber)' },
  { key: 'HONEST_ASSESSMENT',     labelKey: 'BACKTEST_SR_SECTION_HONEST_ASSESSMENT', color: 'var(--accent)' },
];

function parseSection(text: string, key: string): string {
  const keys = STRATEGY_SECTIONS.map(s => s.key);
  const regex = new RegExp(key + ':\\s*([\\s\\S]*?)(?=' + keys.join(':|') + ':|$)');
  return (text.match(regex)?.[1] ?? '').trim();
}

export default function BacktestPage() {
  const { t } = useLabels();
  const { entitled, loading: authLoading } = useAuth();
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

  /* Strategy Research state */
  const [srPrompt,   setSrPrompt]   = useState('');
  const [srRunning,  setSrRunning]  = useState(false);
  const [srResult,   setSrResult]   = useState<string | null>(null);
  const [srError,    setSrError]    = useState<string | null>(null);

  /* SMC Snapshot state */
  const [smcAsset,   setSmcAsset]   = useState('BTC');
  const [smcTf,      setSmcTf]      = useState<SMCTF>('1h');
  const [smcRunning, setSmcRunning] = useState(false);
  const [smcResult,  setSmcResult]  = useState<string | null>(null);
  const [smcError,   setSmcError]   = useState<string | null>(null);

  /* Token Unlock state */
  const [ulSymbol,   setUlSymbol]   = useState('');
  const [ulRunning,  setUlRunning]  = useState(false);
  const [ulResult,   setUlResult]   = useState<string | null>(null);
  const [ulError,    setUlError]    = useState<string | null>(null);

  /* Pine Script Export state */
  const [psRunning,  setPsRunning]  = useState(false);
  const [psResult,   setPsResult]   = useState<string | null>(null);
  const [psError,    setPsError]    = useState<string | null>(null);
  const [psCopied,   setPsCopied]   = useState(false);

  const coins = coinScope === 'majors' ? MAJORS : COINS;

  async function runStrategyResearch() {
    if (!srPrompt.trim()) return;
    setSrRunning(true);
    setSrError(null);
    setSrResult(null);
    try {
      const db = getSupabase();
      const token = db ? (await db.auth.getSession()).data.session?.access_token : undefined;
      const res = await fetch('/api/strategy-research', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ description: srPrompt }),
      });
      const json = await res.json() as { analysis?: string; error?: string };
      if (!res.ok) {
        setSrError(json.error ?? t('BACKTEST_SR_ANALYSIS_FAILED'));
      } else {
        setSrResult(json.analysis ?? null);
      }
    } catch {
      setSrError(t('BACKTEST_SR_NETWORK_ERROR'));
    } finally {
      setSrRunning(false);
    }
  }

  async function runPineScript() {
    if (!srResult) return;
    setPsRunning(true);
    setPsError(null);
    setPsResult(null);
    setPsCopied(false);
    try {
      const db    = getSupabase();
      const token = db ? (await db.auth.getSession()).data.session?.access_token : undefined;
      const res   = await fetch('/api/pine-script', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ description: srPrompt, analysisText: srResult }),
      });
      const json = await res.json() as { code?: string; error?: string };
      if (!res.ok) setPsError(json.error ?? t('BACKTEST_PINE_GENERATION_FAILED'));
      else         setPsResult(json.code ?? null);
    } catch {
      setPsError(t('BACKTEST_PINE_NETWORK_ERROR'));
    } finally {
      setPsRunning(false);
    }
  }

  async function runSMCSnapshot() {
    if (!smcAsset.trim()) return;
    setSmcRunning(true);
    setSmcError(null);
    setSmcResult(null);
    try {
      const db    = getSupabase();
      const token = db ? (await db.auth.getSession()).data.session?.access_token : undefined;
      const res   = await fetch('/api/smc-snapshot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ asset: smcAsset, tf: smcTf }),
      });
      const json = await res.json() as { analysis?: string; error?: string };
      if (!res.ok) setSmcError(json.error ?? t('BACKTEST_SMC_ANALYSIS_FAILED'));
      else         setSmcResult(json.analysis ?? null);
    } catch {
      setSmcError(t('BACKTEST_SMC_NETWORK_ERROR'));
    } finally {
      setSmcRunning(false);
    }
  }

  async function runTokenUnlock() {
    if (!ulSymbol.trim()) return;
    setUlRunning(true);
    setUlError(null);
    setUlResult(null);
    try {
      const db    = getSupabase();
      const token = db ? (await db.auth.getSession()).data.session?.access_token : undefined;
      const res   = await fetch('/api/token-unlock', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ symbol: ulSymbol }),
      });
      const json = await res.json() as { analysis?: string; error?: string };
      if (!res.ok) setUlError(json.error ?? t('BACKTEST_UL_ANALYSIS_FAILED'));
      else         setUlResult(json.analysis ?? null);
    } catch {
      setUlError(t('BACKTEST_UL_NETWORK_ERROR'));
    } finally {
      setUlRunning(false);
    }
  }

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

  // Backtesting is Pro-only (trial users included). Wait for the auth role to
  // resolve so an entitled user never sees a paywall flash, then replace the
  // entire page for free users.
  if (authLoading) return <LoadingState message={t('BACKTEST_LOADING')} fullPage />;
  if (!entitled) {
    return (
      <FullPageUpgradeGate
        title={t('BACKTEST_UPGRADE_TITLE')}
        description={t('BACKTEST_UPGRADE_DESC')}
      />
    );
  }

  return (
    <div>
      <div className="mb-header">
        <h1 className="mb-title">{t('BACKTEST_PAGE_TITLE')}</h1>
        <div className="mb-subtitle">{t('BACKTEST_PAGE_SUBTITLE')}</div>
      </div>

      <div className="frh-range-row">
        {TIMEFRAMES.map(tfOption => (
          <button key={tfOption} className={`frh-range-btn${tf === tfOption ? ' on' : ''}`} onClick={() => setTf(tfOption)} disabled={running}>
            {tfOption.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="frh-range-row">
        <button className={`frh-range-btn${coinScope === 'majors' ? ' on' : ''}`} onClick={() => setCoinScope('majors')} disabled={running}>
          {t('BACKTEST_MAJORS_BUTTON', { count: MAJORS.length })}
        </button>
        <button className={`frh-range-btn${coinScope === 'all' ? ' on' : ''}`} onClick={() => setCoinScope('all')} disabled={running}>
          {t('BACKTEST_ALL_COINS_BUTTON', { count: COINS.length })}
        </button>
      </div>

      <p style={{ fontSize: 'var(--fs-caption)', opacity: 0.4, marginBottom: 14 }}>
        {t('BACKTEST_LOOKBACK_INFO', {
          years: YEARS_BACK_BY_TF[tf],
          count: coins.length,
          s: coins.length !== 1 ? 's' : '',
          roundTripPct: ROUND_TRIP_COST_PCT.toFixed(2),
          takerFeePct: TAKER_FEE_PCT,
          slippagePct: SLIPPAGE_PCT,
        })}
      </p>

      <button
        onClick={run}
        disabled={running}
        style={{
          background: running ? 'rgba(255,255,255,0.06)' : 'var(--purple-bg)',
          color: running ? 'rgba(255,255,255,0.4)' : 'var(--purple)',
          border: `1px solid ${running ? 'var(--bdr)' : 'var(--purple-bdr)'}`,
          borderRadius: 8, padding: '10px 20px', fontSize: 'var(--fs-label)', fontWeight: 700,
          cursor: running ? 'default' : 'pointer', marginBottom: 18,
        }}
      >
        {running
          ? t('BACKTEST_RUNNING_PROGRESS', { done: progress?.done ?? 0, total: progress?.total ?? coins.length, coinSuffix: progress?.coin ? ` (${progress.coin})` : '' })
          : t('BACKTEST_RUN_BUTTON')}
      </button>

      {error && (
        <div style={{ color: '#f87171', fontSize: 'var(--fs-caption)', marginBottom: 14 }}>{t('BACKTEST_ERROR_PREFIX', { error })}</div>
      )}

      {!result && !srResult && !smcResult && !ulResult && !running && !srRunning && !smcRunning && !ulRunning && (
        <div style={{ border: '0.5px solid var(--bdr)', borderRadius: 10, padding: '16px 18px', marginBottom: 20 }}>
          <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
            {t('BACKTEST_TOOLS_INTRO')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {([
              { dot: '#1a7aff', labelKey: 'BACKTEST_TOOL_BACKTEST_LABEL',   descKey: 'BACKTEST_TOOL_BACKTEST_DESC' },
              { dot: '#5aa3ff', labelKey: 'BACKTEST_TOOL_RESEARCH_LABEL',   descKey: 'BACKTEST_TOOL_RESEARCH_DESC' },
              { dot: '#fbbf24', labelKey: 'BACKTEST_TOOL_SMC_LABEL',        descKey: 'BACKTEST_TOOL_SMC_DESC' },
              { dot: '#f87171', labelKey: 'BACKTEST_TOOL_UNLOCK_LABEL',     descKey: 'BACKTEST_TOOL_UNLOCK_DESC' },
            ] as const).map(tool => (
              <div key={tool.labelKey} style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.02)', border: '0.5px solid var(--bdr)', borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: tool.dot, flexShrink: 0 }} />
                  <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--txt)' }}>{t(tool.labelKey)}</span>
                </div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', lineHeight: 1.55 }}>{t(tool.descKey)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result && (
        <>
          {result.failedCoins.length > 0 && (
            <div style={{ fontSize: 'var(--fs-caption)', opacity: 0.4, marginBottom: 12 }}>
              {t('BACKTEST_SKIPPED_COINS', { count: result.failedCoins.length, s: result.failedCoins.length !== 1 ? 's' : '', list: result.failedCoins.map(c => c.toUpperCase()).join(', ') })}
            </div>
          )}

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 24 }}>
            <SideCard title={t('BACKTEST_SIDECARD_ANTICHOP_ON')} stats={result.antiChopOn.stats} color="#34d399" />
            <SideCard title={t('BACKTEST_SIDECARD_ANTICHOP_OFF')} stats={result.antiChopOff.stats} color="#f87171" />
          </div>

          <h2 className="mb-title" style={{ fontSize: 'var(--fs-card-title)', marginBottom: 4 }}>{t('BACKTEST_WT_TUNING_TITLE')}</h2>
          <p style={{ fontSize: 'var(--fs-caption)', opacity: 0.4, marginBottom: 8 }}>
            {t('BACKTEST_WT_TUNING_DESC', {
              winRate: fmtPct(result.antiChopOn.stats.winRate),
              trades: result.antiChopOn.stats.totalTrades,
              pf: isFinite(result.antiChopOn.stats.profitFactor) ? result.antiChopOn.stats.profitFactor.toFixed(2) : '∞',
            })}
          </p>
          <div style={{ overflowX: 'auto', marginBottom: 24 }}>
            <table className="frh-table">
              <thead>
                <tr>
                  <th>{t('BACKTEST_COL_VARIANT')}</th><th>{t('BACKTEST_COL_TRADES')}</th><th>{t('BACKTEST_COL_WIN_RATE')}</th><th>{t('BACKTEST_COL_AVG_R')}</th><th>{t('BACKTEST_COL_PROFIT_FACTOR')}</th><th>{t('BACKTEST_COL_MAX_DD')}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(result.waveTrendVariants).map(([name, side]) => {
                  const s = side.stats;
                  const beatsBaseline = isFinite(s.profitFactor) && s.profitFactor > result.antiChopOn.stats.profitFactor;
                  return (
                    <tr key={name}>
                      <td style={{ fontWeight: 600 }}>{WT_VARIANT_LABEL_KEYS[name] ? t(WT_VARIANT_LABEL_KEYS[name]) : name}{beatsBaseline ? <span style={{ color: '#4ade80' }}> ▲</span> : ''}</td>
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
          </div>

          <h2 className="mb-title" style={{ fontSize: 'var(--fs-card-title)', marginBottom: 8 }}>{t('BACKTEST_PERCOIN_TITLE_ON')}</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="frh-table">
              <thead>
                <tr>
                  <th>{t('BACKTEST_COL_COIN')}</th><th>{t('BACKTEST_COL_TRADES')}</th><th>{t('BACKTEST_COL_WIN_RATE')}</th><th>{t('BACKTEST_COL_AVG_R')}</th><th>{t('BACKTEST_COL_PROFIT_FACTOR')}</th>
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
          </div>
        </>
      )}

      <div style={{ borderTop: '1px solid var(--bdr)', margin: '32px 0 20px' }} />

      <div className="mb-header">
        <h2 className="mb-title">{t('BACKTEST_OF_SECTION_TITLE')}</h2>
        <div className="mb-subtitle">
          {t('BACKTEST_OF_SECTION_SUBTITLE')}
        </div>
      </div>

      <p style={{ fontSize: 'var(--fs-caption)', opacity: 0.4, marginBottom: 14, maxWidth: 640 }}>
        {t('BACKTEST_OF_INFO', {
          years: OF_YEARS_BACK,
          s: OF_YEARS_BACK !== 1 ? 's' : '',
          count: coins.length,
          roundTripPct: ROUND_TRIP_COST_PCT.toFixed(2),
        })}
      </p>

      <button
        onClick={runOrderFlow}
        disabled={ofRunning}
        style={{
          background: ofRunning ? 'rgba(255,255,255,0.06)' : 'var(--amber-bg)',
          color: ofRunning ? 'rgba(255,255,255,0.4)' : 'var(--amber)',
          border: `1px solid ${ofRunning ? 'var(--bdr)' : 'var(--amber-bdr)'}`,
          borderRadius: 8, padding: '10px 20px', fontSize: 'var(--fs-label)', fontWeight: 700,
          cursor: ofRunning ? 'default' : 'pointer', marginBottom: 18,
        }}
      >
        {ofRunning
          ? t('BACKTEST_RUNNING_PROGRESS', { done: ofProgress?.done ?? 0, total: ofProgress?.total ?? coins.length, coinSuffix: ofProgress?.coin ? ` (${ofProgress.coin})` : '' })
          : t('BACKTEST_RUN_OF_BUTTON')}
      </button>

      {ofError && (
        <div style={{ color: '#f87171', fontSize: 'var(--fs-caption)', marginBottom: 14 }}>{t('BACKTEST_OF_ERROR_PREFIX', { error: ofError })}</div>
      )}

      {ofResult && (
        <>
          {ofResult.failedCoins.length > 0 && (
            <div style={{ fontSize: 'var(--fs-caption)', opacity: 0.4, marginBottom: 12 }}>
              {t('BACKTEST_OF_SKIPPED_COINS', { count: ofResult.failedCoins.length, s: ofResult.failedCoins.length !== 1 ? 's' : '', list: ofResult.failedCoins.map(c => c.toUpperCase()).join(', ') })}
            </div>
          )}

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 24 }}>
            <SideCard title={t('BACKTEST_SIDECARD_OF_TITLE')} stats={ofResult.side.stats} color="var(--amber)" />
          </div>

          <h2 className="mb-title" style={{ fontSize: 'var(--fs-card-title)', marginBottom: 8 }}>{t('BACKTEST_PERCOIN_TITLE')}</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="frh-table">
              <thead>
                <tr>
                  <th>{t('BACKTEST_COL_COIN')}</th><th>{t('BACKTEST_COL_TRADES')}</th><th>{t('BACKTEST_COL_WIN_RATE')}</th><th>{t('BACKTEST_COL_AVG_R')}</th><th>{t('BACKTEST_COL_PROFIT_FACTOR')}</th>
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
          </div>
        </>
      )}

      {/* ── AI Strategy Research ─────────────────────────────────────────────── */}
      <div style={{ borderTop: '1px solid var(--bdr)', margin: '36px 0 20px' }} />

      <div className="mb-header">
        <h2 className="mb-title">{t('BACKTEST_AI_RESEARCH_TITLE')}</h2>
        <div className="mb-subtitle">{t('BACKTEST_AI_RESEARCH_SUBTITLE')}</div>
      </div>

      <p style={{ fontSize: 'var(--fs-caption)', opacity: 0.4, marginBottom: 14, maxWidth: 560 }}>
        {t('BACKTEST_AI_RESEARCH_EXAMPLES')}
      </p>

      <textarea
        value={srPrompt}
        onChange={e => setSrPrompt(e.target.value)}
        placeholder={t('BACKTEST_SR_PLACEHOLDER')}
        rows={3}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '10px 12px', borderRadius: 8,
          border: '0.5px solid var(--bdr)', background: 'var(--bg1)',
          color: 'var(--txt)', fontSize: 'var(--fs-label)', resize: 'vertical',
          outline: 'none', marginBottom: 10,
        }}
      />

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
        <button
          onClick={runStrategyResearch}
          disabled={srRunning || !srPrompt.trim()}
          style={{
            background: srRunning || !srPrompt.trim() ? 'rgba(255,255,255,0.06)' : 'rgba(26,122,255,0.12)',
            color: srRunning || !srPrompt.trim() ? 'var(--txt3)' : '#1a7aff',
            border: `1px solid ${srRunning || !srPrompt.trim() ? 'var(--bdr)' : 'rgba(26,122,255,0.35)'}`,
            borderRadius: 8, padding: '10px 20px', fontSize: 'var(--fs-label)', fontWeight: 700,
            cursor: srRunning || !srPrompt.trim() ? 'default' : 'pointer',
          }}
        >
          {srRunning ? t('BACKTEST_SR_RUNNING') : t('BACKTEST_SR_BUTTON')}
        </button>
        {srResult && (
          <button
            onClick={() => { setSrResult(null); setSrError(null); }}
            style={{
              background: 'transparent', color: 'var(--txt3)',
              border: '0.5px solid var(--bdr)', borderRadius: 6,
              padding: '6px 12px', fontSize: 'var(--fs-caption)', cursor: 'pointer',
            }}
          >
            {t('BACKTEST_SR_CLEAR')}
          </button>
        )}
      </div>

      {srError && <div style={{ color: '#f87171', fontSize: 'var(--fs-caption)', marginBottom: 14 }}>{srError}</div>}

      {srResult && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
            {STRATEGY_SECTIONS.map(({ key, labelKey, color }) => {
              const content = parseSection(srResult, key);
              if (!content) return null;
              return (
                <div key={key} style={{
                  background: 'var(--bg1)', border: '0.5px solid var(--bdr)',
                  borderRadius: 'var(--radius-card)', padding: '12px 14px',
                }}>
                  <div style={{
                    fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                    color: color ?? 'var(--txt3)', marginBottom: 8,
                  }}>
                    {t(labelKey)}
                  </div>
                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {content}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pine Script Export */}
          <div style={{ borderTop: '0.5px solid var(--bdr)', paddingTop: 14 }}>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 8 }}>
              {t('BACKTEST_PINE_EXPORT_LABEL')}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: psResult ? 12 : 0 }}>
              {!psResult && (
                <button
                  onClick={runPineScript}
                  disabled={psRunning}
                  style={{
                    background: psRunning ? 'rgba(255,255,255,0.06)' : 'rgba(52,211,153,0.10)',
                    color: psRunning ? 'var(--txt3)' : '#34d399',
                    border: `1px solid ${psRunning ? 'var(--bdr)' : 'rgba(52,211,153,0.3)'}`,
                    borderRadius: 8, padding: '8px 16px', fontSize: 'var(--fs-caption)', fontWeight: 700,
                    cursor: psRunning ? 'default' : 'pointer',
                  }}
                >
                  {psRunning ? t('BACKTEST_PINE_GENERATING') : t('BACKTEST_PINE_GENERATE_BUTTON')}
                </button>
              )}
              {psResult && (
                <>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(psResult).then(() => {
                        setPsCopied(true);
                        setTimeout(() => setPsCopied(false), 2000);
                      });
                    }}
                    style={{
                      background: psCopied ? 'rgba(52,211,153,0.12)' : 'rgba(26,122,255,0.10)',
                      color: psCopied ? '#34d399' : '#1a7aff',
                      border: `1px solid ${psCopied ? 'rgba(52,211,153,0.3)' : 'rgba(26,122,255,0.3)'}`,
                      borderRadius: 8, padding: '8px 16px', fontSize: 'var(--fs-caption)', fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    {psCopied ? t('BACKTEST_PINE_COPIED') : t('BACKTEST_PINE_COPY_BUTTON')}
                  </button>
                  <button
                    onClick={() => { setPsResult(null); setPsError(null); }}
                    style={{ background: 'transparent', color: 'var(--txt3)', border: '0.5px solid var(--bdr)', borderRadius: 6, padding: '6px 10px', fontSize: 'var(--fs-caption)', cursor: 'pointer' }}
                  >
                    {t('BACKTEST_PINE_REGENERATE')}
                  </button>
                </>
              )}
            </div>
            {psError && <div style={{ color: '#f87171', fontSize: 'var(--fs-caption)', marginBottom: 10 }}>{psError}</div>}
            {psResult && (
              <div style={{
                background: 'rgba(0,0,0,0.3)', border: '0.5px solid var(--bdr)',
                borderRadius: 8, padding: '12px 14px', overflowX: 'auto',
              }}>
                <pre style={{
                  margin: 0, fontSize: 'var(--fs-caption)', color: '#34d399',
                  fontFamily: 'var(--font-mono), monospace', lineHeight: 1.5,
                  whiteSpace: 'pre', overflowX: 'auto',
                }}>{psResult}</pre>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── SMC Snapshot ─────────────────────────────────────────────────────── */}
      <div style={{ borderTop: '1px solid var(--bdr)', margin: '36px 0 20px' }} />

      <div className="mb-header">
        <h2 className="mb-title">{t('BACKTEST_SMC_TITLE')}</h2>
        <div className="mb-subtitle">{t('BACKTEST_SMC_SUBTITLE')}</div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <input
          value={smcAsset}
          onChange={e => setSmcAsset(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
          placeholder={t('BACKTEST_SMC_ASSET_PLACEHOLDER')}
          maxLength={10}
          style={{
            width: 80, padding: '8px 10px', borderRadius: 6,
            border: '0.5px solid var(--bdr)', background: 'var(--bg1)',
            color: 'var(--txt)', fontSize: 'var(--fs-label)', outline: 'none',
            fontFamily: 'var(--font-mono), monospace', fontWeight: 700,
          }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          {SMC_TFS.map(smcTfOption => (
            <button
              key={smcTfOption}
              className={`frh-range-btn${smcTf === smcTfOption ? ' on' : ''}`}
              onClick={() => setSmcTf(smcTfOption)}
              disabled={smcRunning}
            >
              {smcTfOption}
            </button>
          ))}
        </div>
        <button
          onClick={runSMCSnapshot}
          disabled={smcRunning || !smcAsset.trim()}
          style={{
            background: smcRunning || !smcAsset.trim() ? 'rgba(255,255,255,0.06)' : 'rgba(26,122,255,0.12)',
            color: smcRunning || !smcAsset.trim() ? 'var(--txt3)' : '#1a7aff',
            border: `1px solid ${smcRunning || !smcAsset.trim() ? 'var(--bdr)' : 'rgba(26,122,255,0.35)'}`,
            borderRadius: 8, padding: '8px 16px', fontSize: 'var(--fs-label)', fontWeight: 700,
            cursor: smcRunning || !smcAsset.trim() ? 'default' : 'pointer',
          }}
        >
          {smcRunning ? t('BACKTEST_SMC_RUNNING') : t('BACKTEST_SMC_RUN_BUTTON')}
        </button>
        {smcResult && (
          <button
            onClick={() => { setSmcResult(null); setSmcError(null); }}
            style={{ background: 'transparent', color: 'var(--txt3)', border: '0.5px solid var(--bdr)', borderRadius: 6, padding: '5px 10px', fontSize: 'var(--fs-caption)', cursor: 'pointer' }}
          >
            {t('BACKTEST_SMC_CLEAR')}
          </button>
        )}
      </div>

      {smcError && <div style={{ color: '#f87171', fontSize: 'var(--fs-caption)', marginBottom: 14 }}>{smcError}</div>}

      {smcResult && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
          {SMC_SECTIONS.map(({ key, labelKey, color }) => {
            const content = parseSMCSection(smcResult, key);
            if (!content) return null;
            return (
              <div key={key} style={{
                background: 'var(--bg1)', border: '0.5px solid var(--bdr)',
                borderRadius: 'var(--radius-card)', padding: '12px 14px',
              }}>
                <div style={{
                  fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: color ?? 'var(--txt3)', marginBottom: 8,
                }}>
                  {t(labelKey)}
                </div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {content}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Token Unlock Sell Pressure Forecaster ────────────────────────────── */}
      <div style={{ borderTop: '1px solid var(--bdr)', margin: '36px 0 20px' }} />

      <div className="mb-header">
        <h2 className="mb-title">{t('BACKTEST_UL_TITLE')}</h2>
        <div className="mb-subtitle">{t('BACKTEST_UL_SUBTITLE')}</div>
      </div>

      <p style={{ fontSize: 'var(--fs-caption)', opacity: 0.4, marginBottom: 14, maxWidth: 560 }}>
        {t('BACKTEST_UL_EXAMPLES')}
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
        <input
          value={ulSymbol}
          onChange={e => setUlSymbol(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
          onKeyDown={e => e.key === 'Enter' && runTokenUnlock()}
          placeholder={t('BACKTEST_UL_PLACEHOLDER')}
          maxLength={10}
          style={{
            width: 110, padding: '8px 10px', borderRadius: 6,
            border: '0.5px solid var(--bdr)', background: 'var(--bg1)',
            color: 'var(--txt)', fontSize: 'var(--fs-label)', outline: 'none',
            fontFamily: 'var(--font-mono), monospace', fontWeight: 700,
          }}
        />
        <button
          onClick={runTokenUnlock}
          disabled={ulRunning || !ulSymbol.trim()}
          style={{
            background: ulRunning || !ulSymbol.trim() ? 'rgba(255,255,255,0.06)' : 'rgba(26,122,255,0.12)',
            color: ulRunning || !ulSymbol.trim() ? 'var(--txt3)' : '#1a7aff',
            border: `1px solid ${ulRunning || !ulSymbol.trim() ? 'var(--bdr)' : 'rgba(26,122,255,0.35)'}`,
            borderRadius: 8, padding: '8px 16px', fontSize: 'var(--fs-label)', fontWeight: 700,
            cursor: ulRunning || !ulSymbol.trim() ? 'default' : 'pointer',
          }}
        >
          {ulRunning ? t('BACKTEST_UL_RUNNING') : t('BACKTEST_UL_RUN_BUTTON')}
        </button>
        {ulResult && (
          <button
            onClick={() => { setUlResult(null); setUlError(null); }}
            style={{ background: 'transparent', color: 'var(--txt3)', border: '0.5px solid var(--bdr)', borderRadius: 6, padding: '5px 10px', fontSize: 'var(--fs-caption)', cursor: 'pointer' }}
          >
            {t('BACKTEST_UL_CLEAR')}
          </button>
        )}
      </div>

      {ulError && <div style={{ color: '#f87171', fontSize: 'var(--fs-caption)', marginBottom: 14 }}>{ulError}</div>}

      {ulResult && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {UNLOCK_SECTIONS.map(({ key, labelKey, color }) => {
            const content = parseUnlockSection(ulResult, key);
            if (!content) return null;
            return (
              <div key={key} style={{
                background: 'var(--bg1)', border: '0.5px solid var(--bdr)',
                borderRadius: 'var(--radius-card)', padding: '12px 14px',
              }}>
                <div style={{
                  fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: color ?? 'var(--txt3)', marginBottom: 8,
                }}>
                  {t(labelKey)}
                </div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {content}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
