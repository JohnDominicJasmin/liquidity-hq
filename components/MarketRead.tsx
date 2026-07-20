'use client';
import { useState, useEffect, useMemo } from 'react';
import { useMarket } from '@/lib/marketStore';
import { computeMarketRead, type FundingSide } from '@/lib/marketRead';
import Tip from '@/components/Tip';

// The dashboard's answer-first hero. Replaces the RaidMeter + Smart Money Score
// + Sentiment Extremes stack with one plain-language verdict (see lib/marketRead
// for the merged math). Score bands drive colour: good >=70 / mid 45-69 / weak.
export default function MarketRead() {
  const { store } = useMarket();
  const [manualFund, setManualFund] = useState<FundingSide | null>(null);
  const [showOverride, setShowOverride] = useState(false);
  const [, setTick] = useState(0);

  // Re-derive every 60s so the time-of-day factor stays current without a reload.
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const read = useMemo(
    () => computeMarketRead(store, manualFund),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.fng, store.selectedCoin, store.cbPremiumPct, store.btcExchangeNetFlow,
     store.coins[store.selectedCoin], manualFund],
  );

  // Ambient urgency glow, preserved from RaidMeter (body[data-rpm-level] drives
  // a global CSS accent when conditions are strong).
  useEffect(() => {
    document.body.dataset.rpmLevel = read.score >= 80 ? 'extreme' : read.score >= 65 ? 'high' : '';
    return () => { delete document.body.dataset.rpmLevel; };
  }, [read.score]);

  const c = read.contrarian;

  return (
    <section className="mr" data-band={read.band}>
      <div className="mr-eyebrow">
        <Tip width={280} text="A plain read on whether now is a good time to trade this coin. Blends session timing, day of week, Fear &amp; Greed, funding, order-wall proximity and a 6-signal smart-money composite into one 0-100 score.">
          Market Read
        </Tip>
        <span className="mr-eyebrow-q"> · is now a good time to trade?</span>
      </div>

      <div className="mr-top">
        <div className="mr-lead">
          <div suppressHydrationWarning className="mr-verdict">{read.verdict}</div>
          <p suppressHydrationWarning className="mr-sub">{read.sub}</p>
        </div>
        <div className="mr-score-block">
          <div className="mr-score-label">Conditions</div>
          <div suppressHydrationWarning className="mr-score">{read.score}<small>/100</small></div>
        </div>
      </div>

      <div className="mr-track"><div suppressHydrationWarning className="mr-fill" style={{ width: read.score + '%' }} /></div>

      <div className="mr-factors">
        {read.factors.map(f => (
          <div key={f.key} className="mr-factor">
            <div className="mr-factor-k">{f.label}</div>
            <div suppressHydrationWarning className="mr-factor-v">{f.value}</div>
            {f.sub && <div suppressHydrationWarning className="mr-factor-s">{f.sub}</div>}
          </div>
        ))}
      </div>

      {c && (
        <div suppressHydrationWarning className={`mr-flag mr-flag-${c.dir}`}>
          <span className="mr-flag-tag">{c.dir === 'bull' ? 'Contrarian bullish' : 'Caution'}</span>
          <span className="mr-flag-body"><b>{c.label}</b> · {c.count}/3 · {c.desc}</span>
        </div>
      )}

      <div className="mr-override">
        <button className="mr-override-btn" onClick={() => setShowOverride(v => !v)}
          style={{ color: manualFund ? 'var(--amber)' : 'var(--txt3)' }}>
          {manualFund ? `funding overridden: ${manualFund === 'pos' ? 'long-heavy' : manualFund === 'neg' ? 'short-heavy' : 'neutral'}` : 'override funding'}
          {showOverride ? ' ▲' : ' ▼'}
        </button>
        {showOverride && (
          <div className="mr-override-opts">
            {(['pos', 'neg', 'neu'] as const).map(opt => (
              <button key={opt}
                className={`mr-fopt${read.fundingSide === opt ? ' on' : ''}`}
                onClick={() => setManualFund(f => (f === opt ? null : opt))}>
                {opt === 'pos' ? 'Long-heavy' : opt === 'neg' ? 'Short-heavy' : 'Neutral'}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
