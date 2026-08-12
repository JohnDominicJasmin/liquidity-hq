'use client';
import { useMarket } from '@/lib/marketStore';
import Tip from '@/components/Tip';
import { useLabels } from '@/lib/labels';
import { useAuth } from '@/components/AuthProvider';
import { isGatedTf } from '@/lib/limits';

type Bias = 'bullish' | 'bearish' | 'neutral';

function getBias(rsi: number | null): Bias {
  if (rsi == null) return 'neutral';
  if (rsi > 57) return 'bullish';
  if (rsi < 43) return 'bearish';
  return 'neutral';
}

function barFill(bias: Bias): string {
  if (bias === 'bullish') return 'var(--green-2)';
  if (bias === 'bearish') return 'var(--red)';
  return 'rgba(255,255,255,0.18)';
}

function valColor(bias: Bias): string {
  if (bias === 'bullish') return 'var(--green-2)';
  if (bias === 'bearish') return 'var(--red)';
  return 'var(--txt2)';
}

function BiasBadge({ bias }: { bias: Bias }) {
  const { t } = useLabels();
  const icon = bias === 'bullish' ? '▲' : bias === 'bearish' ? '▼' : '→';
  const label = bias === 'bullish' ? t('MULTI_TF_ALIGNMENT_BIAS_BULLISH') : bias === 'bearish' ? t('MULTI_TF_ALIGNMENT_BIAS_BEARISH') : t('MULTI_TF_ALIGNMENT_BIAS_NEUTRAL');
  const color = bias === 'bullish' ? 'var(--green-2)' : bias === 'bearish' ? 'var(--red)' : 'var(--txt3)';
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

/* `locked` strips the SIGNAL, then blurs what is left (#310).
 *
 * Order matters and it is the whole point. A blur that leaves the red/green
 * showing still leaks the call: someone who cannot read "62" can still read
 * bullish-or-bearish from the colour, and the badge carries it on its own. So
 * the bias is forced to 'neutral' BEFORE render - an absent colour is a fact,
 * whereas a blur radius is a guess about how much is unreadable.
 *
 * Same shape as #273, where backtesting was gated and still advertised: the
 * feature was blocked and the information was not. */
function RsiRow({ tf, rsi, bias, last, locked }: { tf: string; rsi: number | null; bias: Bias; last?: boolean; locked?: boolean }) {
  if (locked) { rsi = null; bias = 'neutral'; }
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
      {/* Only the SIGNAL is obscured - the timeframe label above stays sharp, so a
          free user can see that 5m and 15m exist and are Pro rather than facing
          an unexplained smear. aria-hidden on each blurred part keeps a screen
          reader from reading out a value the screen is deliberately hiding. */}
      <div aria-hidden={locked || undefined} style={{ position: 'relative', height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.08)', ...(locked ? { filter: 'blur(5px)' } : {}) }}>
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
      <span aria-hidden={locked || undefined} style={{
        fontSize: 'var(--fs-label)', fontWeight: 700, textAlign: 'right',
        color: rsi == null ? 'var(--txt3)' : valColor(bias),
        fontFamily: 'var(--font-mono), monospace',
        ...(locked ? { filter: 'blur(5px)', userSelect: 'none' as const } : {}),
      }}>
        {rsi != null ? rsi.toFixed(0) : '-'}
      </span>
      <div aria-hidden={locked || undefined} style={{ display: 'flex', justifyContent: 'flex-end', ...(locked ? { filter: 'blur(5px)', userSelect: 'none' as const } : {}) }}>
        <BiasBadge bias={bias} />
      </div>
    </div>
  );
}

export default function MultiTFAlignment({ coin: coinProp }: { coin?: string }) {
  const { t } = useLabels();
  const { store } = useMarket();
  /* Same `entitled` the rest of the app gates on - Pro OR active trial - so this
     card and the timeframe switcher in Arena can never disagree about who is a
     paying user (#310). */
  const { entitled, loading: authLoading } = useAuth();
  /* Locked only once we KNOW the user is not entitled. While auth resolves,
     nothing is blurred: a Pro user briefly seeing their own paid signal smeared
     is a worse error than a free user seeing it a moment longer, and the row is
     re-rendered the instant the role lands. */
  const locked = (tf: string) => !authLoading && !entitled && isGatedTf(tf);
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

  /* GATED ROWS ARE EXCLUDED FROM THE VERDICT (#310).
   *
   * Blurring 5m and 15m while still counting them would leak them straight back
   * out: the headline verdict is derived from the same biases, so a free user
   * could read the hidden signal off the aggregate. The majority threshold below
   * already scales to however many timeframes are wired in, so dropping two
   * needs no other change - it becomes a 5-timeframe majority instead of 7. */
  const biases = [
    ...(locked('5m')  ? [] : [bias5m]),
    ...(locked('15m') ? [] : [bias14]),
    bias1h, bias4h, biasDaily, biasWeekly, biasMonthly,
  ];
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
  const verdictColor = verdict === 'bullish' ? 'var(--green-2)' : verdict === 'bearish' ? 'var(--red)' : verdict === 'conflicting' ? 'var(--amber)' : 'var(--txt3)';
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

      <RsiRow tf="5m"  rsi={rsi5m} bias={bias5m} locked={locked('5m')} />
      <RsiRow tf="15m" rsi={rsi14} bias={bias14} locked={locked('15m')} />
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
