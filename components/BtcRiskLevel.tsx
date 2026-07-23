'use client';
import { useMarket } from '@/lib/marketStore';
import { withAlpha } from '@/lib/color';
import Tip from '@/components/Tip';
import { useLabels } from '@/lib/labels';

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

interface Signal { id: string; label: string; value: string; score: number; max: number; color: string; }

export default function BtcRiskLevel() {
  const { store } = useMarket();
  const { t } = useLabels();
  const fng    = store.fng;
  const btcDom = store.btcDom;
  const btcRsi = store.coins['btc']?.rsiDaily ?? null;
  const btcFr  = store.coins['btc']?.fundingRate ?? null;

  let total = 0, maxPossible = 0;
  const signals: Signal[] = [];

  if (fng != null) {
    const s = (fng / 100) * 33;
    total += s; maxPossible += 33;
    const c = fng > 70 ? '#f87171' : fng < 30 ? '#34d399' : '#fbbf24';
    signals.push({ id: 'fng', label: t('BTC_RISK_LEVEL_FNG_LABEL'), value: String(fng), score: s, max: 33, color: c });
  }

  if (btcRsi != null) {
    const s = clamp((btcRsi - 30) / 50, 0, 1) * 33;
    total += s; maxPossible += 33;
    const c = btcRsi > 70 ? '#f87171' : btcRsi < 30 ? '#34d399' : '#fbbf24';
    signals.push({ id: 'rsi', label: t('BTC_RISK_LEVEL_RSI_LABEL'), value: btcRsi.toFixed(1), score: s, max: 33, color: c });
  }

  if (btcFr != null) {
    const pct = btcFr * 100;
    // Positive funding = longs overcrowded = dump risk. Negative = shorts paying = not dump risk.
    const s = pct > 0 ? clamp(btcFr / 0.001, 0, 1) * 34 : 0;
    total += s; maxPossible += 34;
    const c = pct > 0.05 ? '#f87171' : pct < -0.02 ? '#34d399' : '#fbbf24';
    const sign = pct >= 0 ? '+' : '';
    signals.push({ id: 'funding', label: t('BTC_RISK_LEVEL_FUNDING_LABEL'), value: `${sign}${pct.toFixed(4)}%`, score: s, max: 34, color: c });
  }

  const score = maxPossible > 0 ? Math.round((total / maxPossible) * 100) : null;

  const { label, color } = score == null
    ? { label: t('BTC_RISK_LEVEL_UNKNOWN'), color: 'var(--txt3)' }
    : score <= 30 ? { label: t('BTC_RISK_LEVEL_LOW'),      color: '#34d399' }
    : score <= 55 ? { label: t('BTC_RISK_LEVEL_MODERATE'), color: '#fbbf24' }
    : score <= 75 ? { label: t('BTC_RISK_LEVEL_HIGH'),     color: '#fb923c' }
    :               { label: t('BTC_RISK_LEVEL_EXTREME'),  color: '#f87171' };

  return (
    <div style={{
      background: 'var(--bg1)', border: '0.5px solid var(--bdr)',
      borderRadius: 14, padding: '14px 16px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.07em', textTransform: 'uppercase' }}>
          <Tip width={250} text={t('BTC_RISK_LEVEL_TOOLTIP')}>{t('BTC_RISK_LEVEL_TITLE')}</Tip>
        </span>
        {score != null && (
          <span style={{
            fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
            color, background: withAlpha(color, '18'), border: `0.5px solid ${withAlpha(color, '44')}`,
            padding: '2px 7px', borderRadius: 20,
          }}>{label}</span>
        )}
      </div>

      {/* Score */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: '2.25rem', fontWeight: 800, color: score != null ? color : 'var(--txt3)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {score ?? '-'}
        </span>
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('BTC_RISK_LEVEL_OUT_OF_100')}</span>
        {btcDom != null && (
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginLeft: 'auto' }}>
            {t('BTC_RISK_LEVEL_BTC_DOM', { value: btcDom.toFixed(1) })}
          </span>
        )}
      </div>

      {/* Progress bar */}
      {score != null && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 99, width: score + '%', background: color, transition: 'width .4s' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 'var(--fs-caption)', color: '#34d399' }}>{t('BTC_RISK_LEVEL_BAR_LOW')}</span>
            <span style={{ fontSize: 'var(--fs-caption)', color: '#fbbf24' }}>{t('BTC_RISK_LEVEL_BAR_MODERATE')}</span>
            <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--orange)' }}>{t('BTC_RISK_LEVEL_BAR_HIGH')}</span>
            <span style={{ fontSize: 'var(--fs-caption)', color: '#f87171' }}>{t('BTC_RISK_LEVEL_BAR_EXTREME')}</span>
          </div>
        </div>
      )}

      {/* Signal breakdown */}
      {signals.length > 0 ? (
        <div style={{ borderTop: '0.5px solid var(--bdr)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
          {signals.map(sig => (
            <div key={sig.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', width: 120, flexShrink: 0 }}>{sig.label}</span>
              <div style={{ flex: 1, height: 3, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 99, width: `${(sig.score / sig.max) * 100}%`, background: sig.color }} />
              </div>
              <span style={{ fontSize: 'var(--fs-caption)', color: sig.color, width: 72, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {sig.value}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('BTC_RISK_LEVEL_EMPTY')}</div>
      )}
    </div>
  );
}
