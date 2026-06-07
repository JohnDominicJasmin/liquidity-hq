'use client';
import { useMarket } from '@/lib/marketStore';

/* ── Thresholds ────────────────────────────────────────────────────────────
   Bearish (longs overcrowded):
     • F&G ≥ 75  (Extreme Greed)
     • Funding ≥ +0.04%  (longs paying heavily)
     • Long ratio ≥ 60%  (crowd all on one side)
   Bullish (shorts overcrowded):
     • F&G ≤ 25  (Extreme Fear)
     • Funding ≤ −0.02%  (shorts paying)
     • Long ratio ≤ 40%  (60%+ short — squeeze risk)
   Fires at 2/3 (MODERATE) or 3/3 (HIGH CONVICTION)
──────────────────────────────────────────────────────────────────────────── */

export default function SentimentExtremesAlert() {
  const { store } = useMarket();
  const coin = store.coins[store.selectedCoin];

  if (!coin || store.fng == null || coin.fundingRate == null || coin.longRatio == null) return null;

  const fng      = store.fng;
  const fr       = coin.fundingRate * 100;
  const longPct  = coin.longRatio * 100;
  const shortPct = 100 - longPct;

  /* Bearish checklist */
  const bearFng = fng >= 75;
  const bearFr  = fr  >= 0.04;
  const bearLs  = longPct >= 60;
  const bearN   = [bearFng, bearFr, bearLs].filter(Boolean).length;

  /* Bullish checklist */
  const bullFng = fng     <= 25;
  const bullFr  = fr      <= -0.02;
  const bullLs  = longPct <= 40;
  const bullN   = [bullFng, bullFr, bullLs].filter(Boolean).length;

  /* Need ≥2 signals to show */
  if (bearN < 2 && bullN < 2) return null;

  const isBear  = bearN >= bullN;
  const count   = isBear ? bearN : bullN;
  const col     = isBear ? '#f87171' : '#34d399';
  const bg      = isBear ? 'rgba(248,113,113,0.06)' : 'rgba(52,211,153,0.06)';
  const bdr     = isBear ? 'rgba(248,113,113,0.22)' : 'rgba(52,211,153,0.22)';
  const label   = isBear ? 'Bearish Setup' : 'Contrarian Bullish';
  const conviction = count >= 3 ? 'HIGH CONVICTION' : 'MODERATE';
  const icon    = isBear ? '🚨' : '🟢';

  const signals = isBear
    ? [
        { label: 'Fear & Greed', value: `${fng} (${store.fngLabel})`,     hit: bearFng, hint: 'Extreme Greed — longs overcrowded'  },
        { label: 'Funding Rate', value: `+${fr.toFixed(3)}%`,             hit: bearFr,  hint: 'Longs paying heavily — flush risk'  },
        { label: 'Long Ratio',   value: `${longPct.toFixed(0)}% Long`,    hit: bearLs,  hint: 'Overleveraged longs — cascade risk' },
      ]
    : [
        { label: 'Fear & Greed', value: `${fng} (${store.fngLabel})`,     hit: bullFng, hint: 'Extreme Fear — shorts overcrowded'  },
        { label: 'Funding Rate', value: `${fr.toFixed(3)}%`,              hit: bullFr,  hint: 'Shorts paying — squeeze risk'       },
        { label: 'Short Ratio',  value: `${shortPct.toFixed(0)}% Short`,  hit: bullLs,  hint: 'Overleveraged shorts — squeeze risk' },
      ];

  const desc = isBear
    ? count >= 3
      ? 'All 3 signals confirm longs are overcrowded. High flush risk — tighten stops, reduce size, or wait for a cascade trigger before entering new longs.'
      : 'Two sentiment signals lean bearish. Longs at elevated risk. Avoid chasing — wait for confirmation before new long entries.'
    : count >= 3
      ? 'All 3 signals confirm shorts are overcrowded. High squeeze potential — watch for a sharp reversal candle on the next funding cycle.'
      : 'Two sentiment signals lean contrarian bullish. Shorts at elevated risk. Watch for a reversal setup — not a buy signal yet, wait for confirmation.';

  return (
    <div className="sent-banner" style={{ borderColor: bdr, background: bg }}>

      {/* ── Header ── */}
      <div className="sent-banner-header">
        <div className="sent-banner-left">
          <span className="sent-icon">{icon}</span>
          <div>
            <div className="sent-banner-title" style={{ color: col }}>
              Sentiment Extremes — {label}
            </div>
            <div className="sent-banner-sub">
              {count}/3 signals aligned ·{' '}
              <span style={{ color: col, fontWeight: 700 }}>{conviction}</span>
            </div>
          </div>
        </div>
        {/* 3-dot conviction meter */}
        <div className="sent-score-dots">
          {[0, 1, 2].map(i => (
            <span
              key={i}
              className="sent-dot"
              style={{
                background: i < count ? col : 'rgba(255,255,255,0.08)',
                boxShadow:  i < count ? `0 0 6px ${col}88` : 'none',
              }}
            />
          ))}
        </div>
      </div>

      {/* ── Signal rows ── */}
      <div className="sent-signals">
        {signals.map(({ label: sl, value, hit, hint }) => (
          <div key={sl} className="sent-signal-row">
            <span className="sent-signal-icon" style={{ color: hit ? col : 'var(--txt3)' }}>
              {hit ? '⚠' : '·'}
            </span>
            <span className="sent-signal-label">{sl}</span>
            <span className="sent-signal-value" style={{ color: hit ? col : 'var(--txt2)' }}>{value}</span>
            {hit && <span className="sent-signal-hint">{hint}</span>}
          </div>
        ))}
      </div>

      {/* ── Description ── */}
      <div className="sent-desc">{desc}</div>
    </div>
  );
}
