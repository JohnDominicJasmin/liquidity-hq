'use client';
import { useMarket } from '@/lib/marketStore';
import Tip from '@/components/Tip';
import { useLabels } from '@/lib/labels';

type Bias = 'bullish' | 'bearish' | 'neutral';

function getBias(rsi: number | null): Bias {
  if (rsi == null) return 'neutral';
  if (rsi > 57) return 'bullish';
  if (rsi < 43) return 'bearish';
  return 'neutral';
}

function barFill(bias: Bias): string {
  if (bias === 'bullish') return '#34d399';
  if (bias === 'bearish') return '#f87171';
  return 'rgba(255,255,255,0.18)';
}

function valColor(bias: Bias): string {
  if (bias === 'bullish') return '#34d399';
  if (bias === 'bearish') return '#f87171';
  return 'var(--txt2)';
}

function BiasBadge({ bias }: { bias: Bias }) {
  const { t } = useLabels();
  const icon = bias === 'bullish' ? '▲' : bias === 'bearish' ? '▼' : '→';
  const label = bias === 'bullish' ? t('MULTI_TF_ALIGNMENT_BIAS_BULLISH') : bias === 'bearish' ? t('MULTI_TF_ALIGNMENT_BIAS_BEARISH') : t('MULTI_TF_ALIGNMENT_BIAS_NEUTRAL');
  const color = bias === 'bullish' ? '#34d399' : bias === 'bearish' ? '#f87171' : 'var(--txt3)';
  const border = bias === 'bullish' ? 'rgba(52,211,153,0.4)' : bias === 'bearish' ? 'rgba(248,113,113,0.4)' : 'rgba(255,255,255,0.15)';
  const bg = bias === 'bullish' ? 'rgba(52,211,153,0.12)' : bias === 'bearish' ? 'rgba(248,113,113,0.12)' : 'transparent';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 6,
      border: `1px solid ${border}`, background: bg,
      fontSize: 'var(--fs-caption)', fontWeight: 600, color, whiteSpace: 'nowrap',
    }}>
      {icon} {label}
    </span>
  );
}

function RsiRow({ tf, rsi, bias, last }: { tf: string; rsi: number | null; bias: Bias; last?: boolean }) {
  const pct = rsi != null ? Math.min(100, Math.max(0, rsi)) : 0;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '28px 1fr 34px 84px',
      gap: 8,
      alignItems: 'center',
      padding: '9px 0',
      borderBottom: last ? 'none' : '1px solid rgba(255,255,255,0.05)',
    }}>
      <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--txt2)' }}>{tf}</span>
      <div style={{ position: 'relative', height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.08)' }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${pct}%`, borderRadius: 3,
          background: rsi == null ? 'transparent' : barFill(bias),
          transition: 'width 0.5s ease',
        }} />
        <div style={{
          position: 'absolute', left: '50%', top: -2, bottom: -2,
          width: 1, background: 'rgba(255,255,255,0.2)',
        }} />
      </div>
      <span style={{
        fontSize: 'var(--fs-label)', fontWeight: 700, textAlign: 'right',
        color: rsi == null ? 'var(--txt3)' : valColor(bias),
        fontFamily: 'var(--font-mono), monospace',
      }}>
        {rsi != null ? rsi.toFixed(0) : '-'}
      </span>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <BiasBadge bias={bias} />
      </div>
    </div>
  );
}

export default function MultiTFAlignment({ coin: coinProp }: { coin?: string }) {
  const { t } = useLabels();
  const { store } = useMarket();
  const coin = (coinProp ?? store.selectedCoin) as ReturnType<typeof useMarket>['store']['selectedCoin'];
  const d = store.coins[coin];

  const rsi5m     = d?.rsi5m ?? null;
  const rsi14     = d?.rsi14 ?? null;
  const rsi1h     = d?.rsi1h ?? null;
  const rsi4h     = d?.rsi4h ?? null;
  const rsiDaily  = d?.rsiDaily ?? null;
  const rsiWeekly = d?.rsiWeekly ?? null;
  const rsiMonthly = d?.rsiMonthly ?? null;

  const bias5m     = getBias(rsi5m);
  const bias14     = getBias(rsi14);
  const bias1h     = getBias(rsi1h);
  const bias4h     = getBias(rsi4h);
  const biasDaily  = getBias(rsiDaily);
  const biasWeekly = getBias(rsiWeekly);
  const biasMonthly = getBias(rsiMonthly);

  const biases = [bias5m, bias14, bias1h, bias4h, biasDaily, biasWeekly, biasMonthly];
  const bullCount = biases.filter(b => b === 'bullish').length;
  const bearCount = biases.filter(b => b === 'bearish').length;
  // Majority of however many timeframes are wired in - scales automatically
  // rather than a count hardcoded to a 3-timeframe assumption.
  const majority = Math.floor(biases.length / 2) + 1;

  const verdict: 'bullish' | 'bearish' | 'conflicting' | 'mixed' =
    bullCount >= majority ? 'bullish'
    : bearCount >= majority ? 'bearish'
    : (bullCount > 0 && bearCount > 0) ? 'conflicting'
    : 'mixed';

  const verdictLabel = verdict === 'bullish' ? t('MULTI_TF_ALIGNMENT_VERDICT_BULLISH') : verdict === 'bearish' ? t('MULTI_TF_ALIGNMENT_VERDICT_BEARISH') : verdict === 'conflicting' ? t('MULTI_TF_ALIGNMENT_VERDICT_CONFLICTING') : t('MULTI_TF_ALIGNMENT_VERDICT_MIXED');
  const verdictColor = verdict === 'bullish' ? '#34d399' : verdict === 'bearish' ? '#f87171' : verdict === 'conflicting' ? '#fbbf24' : 'var(--txt3)';
  const verdictBorder = verdict === 'bullish' ? 'rgba(52,211,153,0.4)' : verdict === 'bearish' ? 'rgba(248,113,113,0.4)' : verdict === 'conflicting' ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.18)';
  const verdictBg = verdict === 'bullish' ? 'rgba(52,211,153,0.1)' : verdict === 'bearish' ? 'rgba(248,113,113,0.1)' : verdict === 'conflicting' ? 'rgba(251,191,36,0.1)' : 'transparent';

  const footerText = verdict === 'bullish'
    ? t('MULTI_TF_ALIGNMENT_FOOTER_BULLISH')
    : verdict === 'bearish'
    ? t('MULTI_TF_ALIGNMENT_FOOTER_BEARISH')
    : verdict === 'conflicting'
    ? t('MULTI_TF_ALIGNMENT_FOOTER_CONFLICTING')
    : t('MULTI_TF_ALIGNMENT_FOOTER_MIXED');

  return (
    <div className="edge-card" style={{ marginBottom: 10 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div className="edge-card-label" style={{ marginBottom: 2 }}>
            <Tip width={240} text={t('MULTI_TF_ALIGNMENT_TOOLTIP')}>
              {t('MULTI_TF_ALIGNMENT_TITLE')}
            </Tip>
          </div>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>
            {t('MULTI_TF_ALIGNMENT_SUBTITLE', { coin: coin.toUpperCase() })}
          </div>
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center',
          padding: '3px 10px', borderRadius: 6,
          border: `1px solid ${verdictBorder}`, background: verdictBg,
          fontSize: 'var(--fs-caption)', fontWeight: 700, color: verdictColor,
          whiteSpace: 'nowrap', flexShrink: 0, marginTop: 1,
        }}>
          {verdictLabel}
        </span>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid', gridTemplateColumns: '28px 1fr 34px 84px', gap: 8,
        marginTop: 12, marginBottom: 0,
      }}>
        <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--txt3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('MULTI_TF_ALIGNMENT_COL_TF')}</span>
        <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--txt3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('MULTI_TF_ALIGNMENT_COL_RSI')}</span>
        <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--txt3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right' }}>{t('MULTI_TF_ALIGNMENT_COL_VAL')}</span>
        <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--txt3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right' }}>{t('MULTI_TF_ALIGNMENT_COL_BIAS')}</span>
      </div>

      <RsiRow tf="5m"  rsi={rsi5m} bias={bias5m} />
      <RsiRow tf="15m" rsi={rsi14} bias={bias14} />
      <RsiRow tf="1h"  rsi={rsi1h} bias={bias1h} />
      <RsiRow tf="4h"  rsi={rsi4h} bias={bias4h} />
      <RsiRow tf="1D"  rsi={rsiDaily} bias={biasDaily} />
      <RsiRow tf="1W"  rsi={rsiWeekly} bias={biasWeekly} />
      <RsiRow tf="1M"  rsi={rsiMonthly} bias={biasMonthly} last />

      {/* Footer */}
      <div style={{
        marginTop: 10, padding: '8px 10px', borderRadius: 8,
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
        fontSize: 'var(--fs-caption)', color: 'var(--txt2)',
      }}>
        {footerText}
      </div>
    </div>
  );
}
