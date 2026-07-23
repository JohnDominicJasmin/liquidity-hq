'use client';
import { useState, useEffect, useMemo } from 'react';
import { useMarket } from '@/lib/marketStore';
import { computeMarketRead, type FundingSide } from '@/lib/marketRead';
import Tip from '@/components/Tip';
import { useLabels } from '@/lib/labels';

// The dashboard's answer-first hero. Replaces the RaidMeter + Smart Money Score
// + Sentiment Extremes stack with one plain-language verdict (see lib/marketRead
// for the merged math). Score bands drive colour: good >=70 / mid 45-69 / weak.
export default function MarketRead() {
  const { t } = useLabels();
  const { store } = useMarket();
  const [manualFund, setManualFund] = useState<FundingSide | null>(null);
  const [showOverride, setShowOverride] = useState(false);
  const [, setTick] = useState(0);

  // Re-derive every 60s so the time-of-day factor stays current without a reload.
  useEffect(() => {
    const timer = setInterval(() => setTick(n => n + 1), 60_000);
    return () => clearInterval(timer);
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
        <Tip width={280} text={t('MARKET_READ_TIP')}>
          {t('MARKET_READ_TITLE')}
        </Tip>
        <span className="mr-eyebrow-q">{t('MARKET_READ_EYEBROW_Q')}</span>
      </div>

      <div className="mr-top">
        <div className="mr-lead">
          <div suppressHydrationWarning className="mr-verdict">{read.verdict}</div>
          <p suppressHydrationWarning className="mr-sub">{read.sub}</p>
        </div>
        <div className="mr-score-block">
          <div className="mr-score-label">{t('MARKET_READ_CONDITIONS_LABEL')}</div>
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
          <span className="mr-flag-tag">{c.dir === 'bull' ? t('MARKET_READ_FLAG_BULLISH') : t('MARKET_READ_FLAG_CAUTION')}</span>
          <span className="mr-flag-body"><b>{c.label}</b> · {c.count}/3 · {c.desc}</span>
        </div>
      )}

      <div className="mr-override">
        <button className="mr-override-btn" onClick={() => setShowOverride(v => !v)}
          style={{ color: manualFund ? 'var(--amber)' : 'var(--txt3)' }}>
          {manualFund
            ? t('MARKET_READ_OVERRIDE_ACTIVE', { value: manualFund === 'pos' ? t('MARKET_READ_FUND_LONG_LC') : manualFund === 'neg' ? t('MARKET_READ_FUND_SHORT_LC') : t('MARKET_READ_FUND_NEUTRAL_LC') })
            : t('MARKET_READ_OVERRIDE_DEFAULT')}
          {showOverride ? ' ▲' : ' ▼'}
        </button>
        {showOverride && (
          <div className="mr-override-opts">
            {(['pos', 'neg', 'neu'] as const).map(opt => (
              <button key={opt}
                className={`mr-fopt${read.fundingSide === opt ? ' on' : ''}`}
                onClick={() => setManualFund(f => (f === opt ? null : opt))}>
                {opt === 'pos' ? t('MARKET_READ_FUND_LONG') : opt === 'neg' ? t('MARKET_READ_FUND_SHORT') : t('MARKET_READ_FUND_NEUTRAL')}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
