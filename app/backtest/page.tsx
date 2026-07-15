'use client';
import { useState } from 'react';
import Link from 'next/link';
import { CoinId, COINS } from '@/lib/marketStore';
import { runBacktest, BacktestRunResult, runOrderFlowBacktest, OrderFlowBacktestResult, ROUND_TRIP_COST_PCT, TAKER_FEE_PCT, SLIPPAGE_PCT } from '@/lib/backtestEngine';
import { SideCard, fmtPct, fmtR } from '@/components/BacktestStatsUI';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { getCheckoutUrl } from '@/lib/checkout';

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

const SMC_TFS = ['5m', '15m', '30m', '1h', '4h', '1d'] as const;
type SMCTF = typeof SMC_TFS[number];

const SMC_SECTIONS = [
  { key: 'MARKET_STRUCTURE', label: 'Market Structure', color: '#5a6aff' },
  { key: 'FAIR_VALUE_GAPS',  label: 'Fair Value Gaps',  color: '#fbbf24' },
  { key: 'ORDER_BLOCKS',     label: 'Order Blocks',     color: '#fb923c' },
  { key: 'LIQUIDITY_ZONES',  label: 'Liquidity Zones',  color: '#a78bfa' },
  { key: 'BIAS',             label: 'Directional Bias'                   },
  { key: 'KEY_LEVELS',       label: 'Key Levels',       color: '#34d399' },
];

const UNLOCK_SECTIONS = [
  { key: 'CURRENT_SUPPLY',     label: 'Current Supply'                         },
  { key: 'UNLOCK_SCHEDULE',    label: 'Unlock Schedule',    color: '#fbbf24'   },
  { key: 'SELL_PRESSURE_30D',  label: '30-Day Sell Pressure', color: '#f87171' },
  { key: 'SELL_PRESSURE_90D',  label: '90-Day Sell Pressure', color: '#fb923c' },
  { key: 'HISTORICAL_PATTERN', label: 'Historical Pattern'                      },
  { key: 'RECOMMENDATION',     label: 'Recommendation',     color: '#34d399'   },
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

const STRATEGY_SECTIONS = [
  { key: 'THEORETICAL_EDGE',      label: 'Theoretical Edge' },
  { key: 'OPTIMAL_CONDITIONS',    label: 'Optimal Conditions' },
  { key: 'KEY_RISKS',             label: 'Key Risks', color: '#f87171' },
  { key: 'PARAMETER_SUGGESTIONS', label: 'Parameter Suggestions', color: '#34d399' },
  { key: 'CRYPTO_NOTES',          label: 'Crypto Notes', color: '#fbbf24' },
  { key: 'HONEST_ASSESSMENT',     label: 'Honest Assessment', color: '#5a6aff' },
];

function parseSection(text: string, key: string): string {
  const keys = STRATEGY_SECTIONS.map(s => s.key);
  const regex = new RegExp(key + ':\\s*([\\s\\S]*?)(?=' + keys.join(':|') + ':|$)');
  return (text.match(regex)?.[1] ?? '').trim();
}

export default function BacktestPage() {
  const { isPro, loading: authLoading, user } = useAuth();
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
        setSrError(json.error ?? 'Analysis failed');
      } else {
        setSrResult(json.analysis ?? null);
      }
    } catch {
      setSrError('Network error — try again');
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
      if (!res.ok) setPsError(json.error ?? 'Generation failed');
      else         setPsResult(json.code ?? null);
    } catch {
      setPsError('Network error — try again');
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
      if (!res.ok) setSmcError(json.error ?? 'Analysis failed');
      else         setSmcResult(json.analysis ?? null);
    } catch {
      setSmcError('Network error — try again');
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
      if (!res.ok) setUlError(json.error ?? 'Analysis failed');
      else         setUlResult(json.analysis ?? null);
    } catch {
      setUlError('Network error — try again');
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

  // Backtesting is Pro-only. Wait for the auth role to resolve so a Pro user
  // never sees a paywall flash, then replace the entire page for free users.
  if (authLoading) return <div style={{ minHeight: '60vh' }} />;
  if (!isPro) {
    return (
      <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{
          width: '100%', maxWidth: 480,
          background: 'linear-gradient(180deg, var(--bg2), var(--bg1))',
          border: '0.5px solid var(--bdr2)',
          borderRadius: 'var(--radius-card, 12px)',
          padding: '34px 34px 30px',
        }}>
          <div style={{
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 10, fontWeight: 600, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: 'var(--accent-2)', marginBottom: 14,
          }}>
            Pro Feature
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--txt)', margin: '0 0 10px', lineHeight: 1.25 }}>
            Backtesting is part of Pro.
          </h1>
          <p style={{ fontSize: 13.5, color: 'var(--txt2)', lineHeight: 1.7, margin: '0 0 22px' }}>
            Replay the full signal engine against years of historical candles — every coin,
            every timeframe, Anti-Chop on and off side by side — plus the order flow backtest
            and the AI strategy research tools.
          </p>
          <a
            href={getCheckoutUrl(user)}
            style={{
              display: 'block', textAlign: 'center',
              background: 'var(--accent)', color: '#fff',
              fontSize: 14, fontWeight: 700,
              padding: '12px 16px', borderRadius: 8,
              textDecoration: 'none',
            }}
          >
            Upgrade to Pro
          </a>
          <div style={{ textAlign: 'center', marginTop: 14 }}>
            <Link href="/upgrade" style={{ fontSize: 12, color: 'var(--txt3)', textDecoration: 'underline', textUnderlineOffset: 2 }}>
              Compare Free and Pro
            </Link>
          </div>
        </div>
      </div>
    );
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
        Lookback: {YEARS_BACK_BY_TF[tf]} years · Pooled across {coins.length} coin{coins.length !== 1 ? 's' : ''} · Fixed 2:1 R:R per signal (matches live strategy SL/TP rule) · Net of an estimated {ROUND_TRIP_COST_PCT.toFixed(2)}% round-trip cost ({TAKER_FEE_PCT}% taker fee + {SLIPPAGE_PCT}% slippage, each side) — not gross
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

      {!result && !srResult && !smcResult && !ulResult && !running && !srRunning && !smcRunning && !ulRunning && (
        <div style={{ border: '0.5px solid var(--bdr)', borderRadius: 10, padding: '16px 18px', marginBottom: 20 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
            4 tools on this page — pick one to get started
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {([
              { dot: '#5a6aff', label: 'Strategy Backtest',       desc: 'Replay the EMA ribbon against 2-4 years of candles. Pick a timeframe and scope above, then hit Run Backtest.' },
              { dot: '#a78bfa', label: 'Strategy Research',       desc: 'Describe any trading strategy in plain English. Grok evaluates its edge, risks, and optimal entry conditions. Scroll down.' },
              { dot: '#fbbf24', label: 'SMC Snapshot',            desc: 'Pick a coin and timeframe. Grok reads live candles and identifies Break of Structure, Fair Value Gaps, Order Blocks, and Liquidity zones.' },
              { dot: '#f87171', label: 'Token Unlock Forecaster', desc: 'Enter any token ticker. Grok assesses 30-day and 90-day sell pressure risk based on vesting schedules and unlock history.' },
            ] as const).map(t => (
              <div key={t.label} style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.02)', border: '0.5px solid var(--bdr)', borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.dot, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt)' }}>{t.label}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--txt3)', lineHeight: 1.55 }}>{t.desc}</div>
              </div>
            ))}
          </div>
        </div>
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
          <div style={{ overflowX: 'auto', marginBottom: 24 }}>
            <table className="frh-table">
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
          </div>

          <div className="mb-title" style={{ fontSize: 15, marginBottom: 8 }}>Per-Coin Breakdown (Anti-Chop ON)</div>
          <div style={{ overflowX: 'auto' }}>
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
          </div>
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
        Also net of the same {ROUND_TRIP_COST_PCT.toFixed(2)}% round-trip fee + slippage estimate.
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
          <div style={{ overflowX: 'auto' }}>
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
          </div>
        </>
      )}

      {/* ── AI Strategy Research ─────────────────────────────────────────────── */}
      <div style={{ borderTop: '1px solid var(--bdr)', margin: '36px 0 20px' }} />

      <div className="mb-header">
        <div className="mb-title">AI Strategy Research</div>
        <div className="mb-subtitle">Describe any trading strategy in plain English — get an honest analysis of its edge, risks, optimal conditions, and crypto-specific parameters.</div>
      </div>

      <p style={{ fontSize: 11, opacity: 0.4, marginBottom: 14, maxWidth: 560 }}>
        Examples: &quot;EMA 9/20 crossover with RSI confirmation on 1h BTC&quot; · &quot;Buy the open interest spike with funding rate reversal&quot; · &quot;Mean reversion after 3 consecutive red 4h candles&quot;
      </p>

      <textarea
        value={srPrompt}
        onChange={e => setSrPrompt(e.target.value)}
        placeholder="Describe a strategy to research…"
        rows={3}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '10px 12px', borderRadius: 8,
          border: '0.5px solid var(--bdr)', background: 'var(--bg1)',
          color: 'var(--txt)', fontSize: 13, resize: 'vertical',
          outline: 'none', marginBottom: 10,
        }}
      />

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
        <button
          onClick={runStrategyResearch}
          disabled={srRunning || !srPrompt.trim()}
          style={{
            background: srRunning || !srPrompt.trim() ? 'rgba(255,255,255,0.06)' : 'rgba(90,106,255,0.12)',
            color: srRunning || !srPrompt.trim() ? 'var(--txt3)' : '#5a6aff',
            border: `1px solid ${srRunning || !srPrompt.trim() ? 'var(--bdr)' : 'rgba(90,106,255,0.35)'}`,
            borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 700,
            cursor: srRunning || !srPrompt.trim() ? 'default' : 'pointer',
          }}
        >
          {srRunning ? 'Researching…' : 'Research Strategy'}
        </button>
        {srResult && (
          <button
            onClick={() => { setSrResult(null); setSrError(null); }}
            style={{
              background: 'transparent', color: 'var(--txt3)',
              border: '0.5px solid var(--bdr)', borderRadius: 6,
              padding: '6px 12px', fontSize: 11, cursor: 'pointer',
            }}
          >
            Clear
          </button>
        )}
      </div>

      {srError && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 14 }}>{srError}</div>}

      {srResult && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
            {STRATEGY_SECTIONS.map(({ key, label, color }) => {
              const content = parseSection(srResult, key);
              if (!content) return null;
              return (
                <div key={key} style={{
                  background: 'var(--bg1)', border: '0.5px solid var(--bdr)',
                  borderRadius: 'var(--radius-card)', padding: '12px 14px',
                }}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                    color: color ?? 'var(--txt3)', marginBottom: 8,
                  }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--txt2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {content}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pine Script Export */}
          <div style={{ borderTop: '0.5px solid var(--bdr)', paddingTop: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 8 }}>
              Export this strategy to TradingView
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
                    borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 700,
                    cursor: psRunning ? 'default' : 'pointer',
                  }}
                >
                  {psRunning ? 'Generating Pine Script…' : 'Generate TradingView Alert'}
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
                      background: psCopied ? 'rgba(52,211,153,0.12)' : 'rgba(90,106,255,0.10)',
                      color: psCopied ? '#34d399' : '#5a6aff',
                      border: `1px solid ${psCopied ? 'rgba(52,211,153,0.3)' : 'rgba(90,106,255,0.3)'}`,
                      borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    {psCopied ? 'Copied!' : 'Copy Pine Script'}
                  </button>
                  <button
                    onClick={() => { setPsResult(null); setPsError(null); }}
                    style={{ background: 'transparent', color: 'var(--txt3)', border: '0.5px solid var(--bdr)', borderRadius: 6, padding: '6px 10px', fontSize: 11, cursor: 'pointer' }}
                  >
                    Regenerate
                  </button>
                </>
              )}
            </div>
            {psError && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 10 }}>{psError}</div>}
            {psResult && (
              <div style={{
                background: 'rgba(0,0,0,0.3)', border: '0.5px solid var(--bdr)',
                borderRadius: 8, padding: '12px 14px', overflowX: 'auto',
              }}>
                <pre style={{
                  margin: 0, fontSize: 11, color: '#34d399',
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
        <div className="mb-title">SMC Snapshot</div>
        <div className="mb-subtitle">Pick an asset and timeframe - Grok analyzes recent price action using Smart Money Concepts: Break of Structure, Fair Value Gaps, Order Blocks, and Liquidity zones.</div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <input
          value={smcAsset}
          onChange={e => setSmcAsset(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
          placeholder="BTC"
          maxLength={10}
          style={{
            width: 80, padding: '8px 10px', borderRadius: 6,
            border: '0.5px solid var(--bdr)', background: 'var(--bg1)',
            color: 'var(--txt)', fontSize: 13, outline: 'none',
            fontFamily: 'var(--font-mono), monospace', fontWeight: 700,
          }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          {SMC_TFS.map(t => (
            <button
              key={t}
              className={`frh-range-btn${smcTf === t ? ' on' : ''}`}
              onClick={() => setSmcTf(t)}
              disabled={smcRunning}
            >
              {t}
            </button>
          ))}
        </div>
        <button
          onClick={runSMCSnapshot}
          disabled={smcRunning || !smcAsset.trim()}
          style={{
            background: smcRunning || !smcAsset.trim() ? 'rgba(255,255,255,0.06)' : 'rgba(90,106,255,0.12)',
            color: smcRunning || !smcAsset.trim() ? 'var(--txt3)' : '#5a6aff',
            border: `1px solid ${smcRunning || !smcAsset.trim() ? 'var(--bdr)' : 'rgba(90,106,255,0.35)'}`,
            borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700,
            cursor: smcRunning || !smcAsset.trim() ? 'default' : 'pointer',
          }}
        >
          {smcRunning ? 'Analyzing…' : 'Run SMC Analysis'}
        </button>
        {smcResult && (
          <button
            onClick={() => { setSmcResult(null); setSmcError(null); }}
            style={{ background: 'transparent', color: 'var(--txt3)', border: '0.5px solid var(--bdr)', borderRadius: 6, padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}
          >
            Clear
          </button>
        )}
      </div>

      {smcError && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 14 }}>{smcError}</div>}

      {smcResult && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
          {SMC_SECTIONS.map(({ key, label, color }) => {
            const content = parseSMCSection(smcResult, key);
            if (!content) return null;
            return (
              <div key={key} style={{
                background: 'var(--bg1)', border: '0.5px solid var(--bdr)',
                borderRadius: 'var(--radius-card)', padding: '12px 14px',
              }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: color ?? 'var(--txt3)', marginBottom: 8,
                }}>
                  {label}
                </div>
                <div style={{ fontSize: 12, color: 'var(--txt2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
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
        <div className="mb-title">Token Unlock Sell Pressure</div>
        <div className="mb-subtitle">Enter a token symbol - Grok analyzes upcoming vesting cliff events and classifies sell pressure impact for the next 30 and 90 days.</div>
      </div>

      <p style={{ fontSize: 11, opacity: 0.4, marginBottom: 14, maxWidth: 560 }}>
        Examples: ARB · OP · PYTH · JUP · STRK · SUI · W · ZK · EIGEN
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
        <input
          value={ulSymbol}
          onChange={e => setUlSymbol(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
          onKeyDown={e => e.key === 'Enter' && runTokenUnlock()}
          placeholder="e.g. ARB"
          maxLength={10}
          style={{
            width: 110, padding: '8px 10px', borderRadius: 6,
            border: '0.5px solid var(--bdr)', background: 'var(--bg1)',
            color: 'var(--txt)', fontSize: 13, outline: 'none',
            fontFamily: 'var(--font-mono), monospace', fontWeight: 700,
          }}
        />
        <button
          onClick={runTokenUnlock}
          disabled={ulRunning || !ulSymbol.trim()}
          style={{
            background: ulRunning || !ulSymbol.trim() ? 'rgba(255,255,255,0.06)' : 'rgba(90,106,255,0.12)',
            color: ulRunning || !ulSymbol.trim() ? 'var(--txt3)' : '#5a6aff',
            border: `1px solid ${ulRunning || !ulSymbol.trim() ? 'var(--bdr)' : 'rgba(90,106,255,0.35)'}`,
            borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700,
            cursor: ulRunning || !ulSymbol.trim() ? 'default' : 'pointer',
          }}
        >
          {ulRunning ? 'Analyzing…' : 'Analyze Unlock Risk'}
        </button>
        {ulResult && (
          <button
            onClick={() => { setUlResult(null); setUlError(null); }}
            style={{ background: 'transparent', color: 'var(--txt3)', border: '0.5px solid var(--bdr)', borderRadius: 6, padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}
          >
            Clear
          </button>
        )}
      </div>

      {ulError && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 14 }}>{ulError}</div>}

      {ulResult && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {UNLOCK_SECTIONS.map(({ key, label, color }) => {
            const content = parseUnlockSection(ulResult, key);
            if (!content) return null;
            return (
              <div key={key} style={{
                background: 'var(--bg1)', border: '0.5px solid var(--bdr)',
                borderRadius: 'var(--radius-card)', padding: '12px 14px',
              }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: color ?? 'var(--txt3)', marginBottom: 8,
                }}>
                  {label}
                </div>
                <div style={{ fontSize: 12, color: 'var(--txt2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
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
