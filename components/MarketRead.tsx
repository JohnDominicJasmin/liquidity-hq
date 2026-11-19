'use client';
import { useState, useEffect, useMemo } from 'react';
import { useMarket } from '@/lib/marketStore';
import { computeMarketRead, type FundingSide, type MarketRead as MarketReadResult } from '@/lib/marketRead';
import Tip from '@/components/Tip';
import { useLabels } from '@/lib/labels';
import { trText } from '@/lib/marketReadText';
import { useGraceElapsed } from '@/lib/useGrace';
import { useNow } from '@/lib/useNow';
import { ageLabel } from '@/lib/ageLabel';

// The dashboard's answer-first hero. Replaces the RaidMeter + Smart Money Score
// + Sentiment Extremes stack with one plain-language verdict (see lib/marketRead
// for the merged math). Score bands drive colour: good >=70 / mid 45-69 / weak.
export default function MarketRead() {
  const { t } = useLabels();
  const { store } = useMarket();
  const [manualFund, setManualFund] = useState<FundingSide | null>(null);
  const [showOverride, setShowOverride] = useState(false);
  const [, setTick] = useState(0);
  /* The wait for an input restarts on every coin switch (#1185 D1): a switch after the first 15 s used to show the failure at once. */
  const graceOver = useGraceElapsed(15_000, store.selectedCoin);
  const now = useNow(60_000);
  // The dashboard is prerendered, so the Day factor in the server HTML is the
  // BUILD day, and suppressHydrationWarning keeps that text on screen rather
  // than correcting it - it read "Saturday" on other days. Shown after mount
  // only, the same `mounted` gate SessionCountdown and /hours use.
  const [mounted, setMounted] = useState(false);

  // Re-derive every 60s so the time-of-day factor stays current without a reload.
  useEffect(() => {
    setMounted(true);
    const timer = setInterval(() => setTick(n => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Hoisted out of the dependency list below: a computed member expression
  // (store.coins[store.selectedCoin]) is not something React can compare
  // reliably, and react-hooks/use-memo rejects it. Same value, same identity,
  // now expressed as a plain reference.
  const selectedCoinData = store.coins[store.selectedCoin];

  /* Once the wait is over, a coin that has no funding rate (no perpetual) is scored without it instead of reading "unavailable" for ever (#1185 D1). */
  const liveRead = useMemo(
    () => computeMarketRead(store, manualFund, { partial: graceOver }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.fng, store.selectedCoin, store.cbPremiumPct, store.btcExchangeNetFlow,
     selectedCoinData, manualFund, graceOver],
  );

  /* The last read that had everything it needs, kept with its time: if Fear & Greed never arrives, this stays on screen with its age instead of failure text. */
  const [last, setLast] = useState<{ read: MarketReadResult; at: number } | null>(null);
  useEffect(() => {
    if (!liveRead.pending && liveRead.score != null) setLast({ read: liveRead, at: Date.now() });
  }, [liveRead]);

  /* An input that never arrives ends in the last good read with its age, or no card at all - never a read that says Reading for ever (OWNER-RULES 21). */
  const gaveUp = liveRead.pending && graceOver;
  const read = gaveUp && last ? last.read : liveRead;

  // Ambient urgency glow, preserved from RaidMeter (body[data-rpm-level] drives
  // a global CSS accent when conditions are strong).
  // No score yet (#1494: an input is still loading) means no glow either.
  useEffect(() => {
    const s = read.score;
    document.body.dataset.rpmLevel = s == null ? '' : s >= 80 ? 'extreme' : s >= 65 ? 'high' : '';
    return () => { delete document.body.dataset.rpmLevel; };
  }, [read.score]);

  const c = read.contrarian;
  const rsis = [selectedCoinData?.rsi14, selectedCoinData?.rsi1h, selectedCoinData?.rsi4h];
  const dirKey: 'MARKET_READ_DIR_BULL' | 'MARKET_READ_DIR_BEAR' | 'MARKET_READ_DIR_MIXED' | 'MARKET_READ_DIR_MIXED_BULL' | 'MARKET_READ_DIR_MIXED_BEAR' | null = rsis.some(r => r == null) ? null : (() => {
    const bull = rsis.filter(r => (r as number) > 57).length, bear = rsis.filter(r => (r as number) < 43).length;
    return bull === 3 ? 'MARKET_READ_DIR_BULL' : bear === 3 ? 'MARKET_READ_DIR_BEAR' : bull > bear ? 'MARKET_READ_DIR_MIXED_BULL' : bear > bull ? 'MARKET_READ_DIR_MIXED_BEAR' : 'MARKET_READ_DIR_MIXED';
  })();
  const showingLast = gaveUp && last != null;
  if (gaveUp && !last) return null;

  return (
    <section className="mr" data-band={read.band ?? 'pending'} aria-busy={read.pending || undefined}>
      <div className="mr-eyebrow">
        <Tip width={280} text={t('MARKET_READ_TIP')}>
          {t('MARKET_READ_TITLE')}
        </Tip>
        <span className="mr-eyebrow-q">{t('MARKET_READ_EYEBROW_Q')}</span>
      </div>

      <div className="mr-top">
        <div className="mr-lead">
          <div suppressHydrationWarning className="mr-verdict">{trText(t, read.verdict)}</div>
          <p suppressHydrationWarning className="mr-sub">{trText(t, read.sub)}{showingLast && last && <span data-testid="mr-age">{' · '}{ageLabel(now - last.at, t)}</span>}</p>
        </div>
        <div className="mr-score-block">
          <div className="mr-score-label">{t('MARKET_READ_CONDITIONS_LABEL')}</div>
          {/* A dash, not a number, until the read has its inputs (#1494). */}
          <div suppressHydrationWarning className="mr-score">{read.score ?? '-'}<small>/100</small></div>
          {/* THE SCORE SAYS HOW GOOD THE CONDITIONS ARE, NOT WHICH WAY (#1185, PM 2026-11-17): a direction line beside it from the selected coin's own RSI on three timeframes (the same 57 / 43 lean the Arena's Multi-timeframe card uses). Omitted while a reading is missing. */}
          {dirKey && <div suppressHydrationWarning className="mr-score-label" title={t('MARKET_READ_DIR_LABEL')} data-testid="mr-direction">{t(dirKey)}</div>}
        </div>
      </div>

      {/* Scale anchor: 0/100 endpoints plus a tick at 70, the "good" cutoff
          (lib/marketRead.ts band thresholds) - the number alone gave no sense
          of where 78 sits on the range or what counts as good. Plain "≥70" is
          numerals + a symbol, not prose, so it skips the label/i18n system. */}
      <div className="mr-track-wrap">
        {/* dir="ltr": a QUANTITATIVE AXIS DOES NOT MIRROR (#353).
             A 0-100 score track with a fixed "Good >= 70" tick. Mirrored, the
             tick marks 30 and the fill grows from the wrong end - both render
             perfectly and mean the opposite.
             Found by sweeping ALL percentage positions, static and computed.
             The original survey filtered for computed offsets and missed this
             and MultiTFAlignment; a hardcoded percentage on an axis mirrors
             exactly as wrongly as a calculated one. */}
        <div dir="ltr" className="mr-track">
          <div suppressHydrationWarning className="mr-fill" style={{ width: (read.score ?? 0) + '%' }} />
          <div className="mr-track-good-tick" style={{ left: '70%' }} title={t('MARKET_READ_GOOD_TICK_TITLE')} />
        </div>
        <div className="mr-scale">
          <span>0</span>
          <span className="mr-scale-good">{t('MARKET_READ_SCALE_GOOD')}</span>
          <span>100</span>
        </div>
      </div>

      <div className="mr-factors">
        {read.factors.map(f => (
          <div key={f.key} className="mr-factor">
            <div className="mr-factor-k">{trText(t, f.label)}</div>
            <div suppressHydrationWarning className="mr-factor-v">{f.key === 'day' && !mounted ? '-' : trText(t, f.value)}</div>
            {f.sub && <div suppressHydrationWarning className="mr-factor-s">{trText(t, f.sub)}</div>}
          </div>
        ))}
      </div>

      {c && (
        <div suppressHydrationWarning className={`mr-flag mr-flag-${c.dir}`}>
          <span className="mr-flag-tag">{c.dir === 'bull' ? t('MARKET_READ_FLAG_BULLISH') : t('MARKET_READ_FLAG_CAUTION')}</span>
          <span className="mr-flag-body"><b>{trText(t, c.label)}</b> · {c.count}/3 · {trText(t, c.desc)}</span>
        </div>
      )}

      <div className="mr-override">
        <button className="mr-override-btn" onClick={() => setShowOverride(v => !v)}
          aria-expanded={showOverride}
          style={{ color: manualFund ? 'var(--amber)' : 'var(--txt3)' }}>
          {manualFund
            ? t('MARKET_READ_OVERRIDE_ACTIVE', { value: manualFund === 'pos' ? t('MARKET_READ_FUND_LONG_LC') : manualFund === 'neg' ? t('MARKET_READ_FUND_SHORT_LC') : t('MARKET_READ_FUND_NEUTRAL_LC') })
            : t('MARKET_READ_OVERRIDE_DEFAULT')}
          {/* aria-hidden (#939 second sweep): aria-expanded on the button
              already says open or closed. Missed by the first sweep because
              the literal carries a LEADING SPACE - ' ▼' - and the search
              string was an exact quote rather than the pattern. */}
          <span aria-hidden="true">{showOverride ? ' ▲' : ' ▼'}</span>
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
