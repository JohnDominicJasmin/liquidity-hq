'use client';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useMarket, COINS, CoinId, CoinData } from '@/lib/marketStore';

type Dir = 'LONG' | 'SHORT';

interface Signal {
  label:  string;
  detail: string;
  hit:    boolean;
  weight: number; // 1 = normal, 2 = strong signal
}

function buildSignals(coin: CoinData | undefined, dir: Dir): Signal[] {
  if (!coin) return [];
  const p  = coin.price;
  const fr = coin.fundingRate != null ? coin.fundingRate * 100 : null;

  if (dir === 'LONG') {
    return [
      {
        label:  'RSI 15m oversold',
        detail: coin.rsi14 != null ? `${coin.rsi14.toFixed(0)} ≤ 35` : 'No data',
        hit:    coin.rsi14 != null && coin.rsi14 <= 35,
        weight: 1,
      },
      {
        label:  'RSI 1h oversold',
        detail: coin.rsi1h != null ? `${coin.rsi1h.toFixed(0)} ≤ 40` : 'No data',
        hit:    coin.rsi1h != null && coin.rsi1h <= 40,
        weight: 1,
      },
      {
        label:  'RSI 4h oversold',
        detail: coin.rsi4h != null ? `${coin.rsi4h.toFixed(0)} ≤ 45` : 'No data',
        hit:    coin.rsi4h != null && coin.rsi4h <= 45,
        weight: 2,
      },
      {
        label:  'Price below MA20',
        detail: coin.ma20 != null && p != null
          ? `$${p.toLocaleString()} < $${coin.ma20.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
          : 'No data',
        hit:    coin.ma20 != null && p != null && p < coin.ma20,
        weight: 1,
      },
      {
        label:  'Price below VWAP',
        detail: coin.vwap != null && p != null
          ? `$${p.toLocaleString()} < $${coin.vwap.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
          : 'No data',
        hit:    coin.vwap != null && p != null && p < coin.vwap,
        weight: 1,
      },
      {
        label:  'CVD net buying',
        detail: coin.cvd != null
          ? (coin.cvd >= 0 ? '+' : '') + (coin.cvd / 1000).toFixed(1) + 'K'
          : 'No data',
        hit:    coin.cvd != null && coin.cvd > 0,
        weight: 1,
      },
      {
        label:  'OI trending up',
        detail: coin.oiTrend ?? 'No data',
        hit:    coin.oiTrend === 'strong_up' || coin.oiTrend === 'weak_up',
        weight: 1,
      },
      {
        label:  'Buyers aggressive (taker)',
        detail: coin.takerBuyRatio != null
          ? `Buy ${(coin.takerBuyRatio * 100).toFixed(0)}% ≥ 55%`
          : 'No data',
        hit:    coin.takerBuyRatio != null && coin.takerBuyRatio >= 0.55,
        weight: 1,
      },
      {
        label:  'Funding negative (longs paid)',
        detail: fr != null ? `${fr.toFixed(4)}% ≤ −0.01%` : 'No data',
        hit:    fr != null && fr <= -0.01,
        weight: 2,
      },
      {
        label:  'Shorts overcrowded',
        detail: coin.shortRatio != null
          ? `Short ${(coin.shortRatio * 100).toFixed(0)}% ≥ 55%`
          : 'No data',
        hit:    coin.shortRatio != null && coin.shortRatio >= 0.55,
        weight: 2,
      },
    ];
  }

  /* SHORT signals */
  return [
    {
      label:  'RSI 15m overbought',
      detail: coin.rsi14 != null ? `${coin.rsi14.toFixed(0)} ≥ 65` : 'No data',
      hit:    coin.rsi14 != null && coin.rsi14 >= 65,
      weight: 1,
    },
    {
      label:  'RSI 1h overbought',
      detail: coin.rsi1h != null ? `${coin.rsi1h.toFixed(0)} ≥ 60` : 'No data',
      hit:    coin.rsi1h != null && coin.rsi1h >= 60,
      weight: 1,
    },
    {
      label:  'RSI 4h overbought',
      detail: coin.rsi4h != null ? `${coin.rsi4h.toFixed(0)} ≥ 55` : 'No data',
      hit:    coin.rsi4h != null && coin.rsi4h >= 55,
      weight: 2,
    },
    {
      label:  'Price above MA20',
      detail: coin.ma20 != null && p != null
        ? `$${p.toLocaleString()} > $${coin.ma20.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
        : 'No data',
      hit:    coin.ma20 != null && p != null && p > coin.ma20,
      weight: 1,
    },
    {
      label:  'Price above VWAP',
      detail: coin.vwap != null && p != null
        ? `$${p.toLocaleString()} > $${coin.vwap.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
        : 'No data',
      hit:    coin.vwap != null && p != null && p > coin.vwap,
      weight: 1,
    },
    {
      label:  'CVD net selling',
      detail: coin.cvd != null
        ? (coin.cvd >= 0 ? '+' : '') + (coin.cvd / 1000).toFixed(1) + 'K'
        : 'No data',
      hit:    coin.cvd != null && coin.cvd < 0,
      weight: 1,
    },
    {
      label:  'OI trending down',
      detail: coin.oiTrend ?? 'No data',
      hit:    coin.oiTrend === 'strong_down' || coin.oiTrend === 'weak_down',
      weight: 1,
    },
    {
      label:  'Sellers aggressive (taker)',
      detail: coin.takerBuyRatio != null
        ? `Buy ${(coin.takerBuyRatio * 100).toFixed(0)}% ≤ 45%`
        : 'No data',
      hit:    coin.takerBuyRatio != null && coin.takerBuyRatio <= 0.45,
      weight: 1,
    },
    {
      label:  'Funding positive (shorts paid)',
      detail: fr != null ? `${fr.toFixed(4)}% ≥ +0.01%` : 'No data',
      hit:    fr != null && fr >= 0.01,
      weight: 2,
    },
    {
      label:  'Longs overcrowded',
      detail: coin.longRatio != null
        ? `Long ${(coin.longRatio * 100).toFixed(0)}% ≥ 55%`
        : 'No data',
      hit:    coin.longRatio != null && coin.longRatio >= 0.55,
      weight: 2,
    },
  ];
}

function getVerdict(score: number, max: number): { label: string; color: string; bg: string; bdr: string } {
  const pct = max > 0 ? score / max : 0;
  if (pct >= 0.8) return { label: 'Strong confluence',   color: '#34d399', bg: 'rgba(52,211,153,.08)',  bdr: 'rgba(52,211,153,.22)' };
  if (pct >= 0.6) return { label: 'Good confluence',     color: '#86efac', bg: 'rgba(134,239,172,.07)', bdr: 'rgba(134,239,172,.2)'  };
  if (pct >= 0.4) return { label: 'Moderate — wait',     color: '#f59e0b', bg: 'rgba(245,158,11,.08)',  bdr: 'rgba(245,158,11,.25)'  };
  if (pct >= 0.2) return { label: 'Weak — don\'t force', color: '#f87171', bg: 'rgba(248,113,113,.07)', bdr: 'rgba(248,113,113,.2)'  };
  return             { label: 'No confluence — skip',  color: '#606060', bg: 'rgba(255,255,255,.03)', bdr: 'rgba(255,255,255,.07)' };
}

interface Props {
  onRunSignal?: (coin: CoinId) => void;
  coin?: CoinId; // when set, locks scorer to this coin (hides selector)
}

export default function ConfluenceScorer({ onRunSignal, coin: coinProp }: Props) {
  const { store } = useMarket();
  const router    = useRouter();
  const [coinState, setCoinState] = useState<CoinId>('btc');
  const coin = coinProp ?? coinState;
  const [dir,  setDir]  = useState<Dir>('LONG');

  const coinData = store.coins[coin];
  const signals  = useMemo(() => buildSignals(coinData, dir), [coinData, dir]);

  const hits    = signals.filter(s => s.hit);
  const score   = hits.reduce((s, x) => s + x.weight, 0);
  const maxScore = signals.reduce((s, x) => s + x.weight, 0);
  const count   = hits.length;
  const total   = signals.length;
  const verdict = getVerdict(score, maxScore);
  const pct     = maxScore > 0 ? (score / maxScore) * 100 : 0;

  const dirColor  = dir === 'LONG' ? '#f87171' : '#34d399';
  const dirBg     = dir === 'LONG' ? 'rgba(248,113,113,.08)' : 'rgba(52,211,153,.08)';
  const dirBdr    = dir === 'LONG' ? 'rgba(248,113,113,.22)' : 'rgba(52,211,153,.22)';

  return (
    <div>
      {/* Header */}
      <div style={{ padding: '1rem 0 0.5rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#e8e8e8', marginBottom: 2 }}>📊 Confluence Scorer</div>
        <div style={{ fontSize: 12, color: '#606060', marginBottom: 14 }}>
          10 signals checked — technicals · derivatives · structure · flow
        </div>
      </div>

      {/* Coin selector — hidden when coin is controlled by parent */}
      {!coinProp && (
        <div className="cf-coins">
          {COINS.map(c => (
            <button
              key={c}
              className={`cf-coin${c === coin ? ' on' : ''}`}
              onClick={() => setCoinState(c)}
            >
              {c.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      {/* Direction toggle */}
      <div className="cf-dir-row">
        <button
          className={`cf-dir-btn${dir === 'LONG' ? ' on' : ''}`}
          style={dir === 'LONG' ? { background: dirBg, borderColor: dirBdr, color: dirColor } : {}}
          onClick={() => setDir('LONG')}
        >▲ LONG</button>
        <button
          className={`cf-dir-btn${dir === 'SHORT' ? ' on' : ''}`}
          style={dir === 'SHORT' ? { background: dirBg, borderColor: dirBdr, color: dirColor } : {}}
          onClick={() => setDir('SHORT')}
        >▼ SHORT</button>
      </div>

      {/* Score card */}
      <div className="cf-score-card" style={{ borderColor: verdict.bdr, background: verdict.bg }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: '#606060', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 3 }}>
              {coin.toUpperCase()} · {dir}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: verdict.color }}>{verdict.label}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: verdict.color, lineHeight: 1 }}>{count}</div>
            <div style={{ fontSize: 11, color: '#606060' }}>/ {total} signals</div>
          </div>
        </div>
        {/* Progress bar */}
        <div style={{ height: 6, background: 'rgba(255,255,255,.06)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: pct + '%', background: verdict.color, borderRadius: 3, transition: 'width .5s ease' }} />
        </div>
      </div>

      {/* Signal list */}
      <div className="cf-signals">
        {signals.map((s, i) => (
          <div key={i} className={`cf-signal${s.hit ? ' cf-hit' : ''}`}>
            <span className={`cf-signal-icon${s.hit ? ' cf-icon-hit' : ''}`}>
              {s.hit ? '✓' : '✗'}
            </span>
            <div className="cf-signal-body">
              <span className="cf-signal-label">{s.label}</span>
              {s.weight === 2 && <span className="cf-signal-strong">strong</span>}
            </div>
            <span className={`cf-signal-detail${s.hit ? ' cf-detail-hit' : ''}`}>{s.detail}</span>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="cf-actions">
        {onRunSignal && (
          <button
            className="cf-action-btn cf-action-grok"
            onClick={() => onRunSignal(coin)}
          >
            ⚡ Run Grok Signal
          </button>
        )}
        <button
          className="cf-action-btn cf-action-journal"
          onClick={() => router.push(`/journal?coin=${coin}&dir=${dir}`)}
        >
          📓 Log Trade
        </button>
      </div>
    </div>
  );
}
