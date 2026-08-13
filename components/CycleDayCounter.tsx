'use client';
import { useNow } from '@/lib/useNow';
import { withAlpha } from '@/lib/color';
import { useLabels } from '@/lib/labels';

// Bitcoin halving dates (block timestamps)
const HALVINGS = [
  { label: '1st halving', date: new Date('2012-11-28') },
  { label: '2nd halving', date: new Date('2016-07-09') },
  { label: '3rd halving', date: new Date('2020-05-11') },
  { label: '4th halving', date: new Date('2024-04-20') },
];

// Approximate peak days since halving for each cycle (rough historical reference)
// 2012: ~369d, 2016: ~526d, 2020: ~546d
const PEAK_WINDOW = { start: 350, end: 560 };
const NEXT_HALVING_EST = new Date('2028-03-01'); // estimated

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

function daysUntil(date: Date): number {
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

export default function CycleDayCounter() {
  const { t } = useLabels();
  const latest = HALVINGS[HALVINGS.length - 1];
  const now = useNow(60 * 60 * 1000); // day counter - hourly is plenty
  const day        = Math.floor((now - latest.date.getTime()) / 86_400_000);
  const daysToNext = Math.ceil((NEXT_HALVING_EST.getTime() - now) / 86_400_000);

  const inPeakWindow = day >= PEAK_WINDOW.start && day <= PEAK_WINDOW.end;
  const pastPeak     = day > PEAK_WINDOW.end;
  const prePeak      = day < PEAK_WINDOW.start;

  const dotColor = inPeakWindow ? 'var(--amber)' : pastPeak ? 'var(--red)' : 'var(--green-2)';
  const label    = inPeakWindow ? t('CYCLE_DAY_COUNTER_ZONE_IN_PEAK') : pastPeak ? t('CYCLE_DAY_COUNTER_ZONE_POST_PEAK') : t('CYCLE_DAY_COUNTER_ZONE_PRE_PEAK');
  const phasePct = Math.min(Math.max((day / PEAK_WINDOW.end) * 100, 0), 100);

  return (
    <div style={{
      background: 'var(--bg1)',
      border: '0.5px solid var(--bdr)',
      borderRadius: 14, padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%', background: dotColor,
            boxShadow: `0 0 6px ${withAlpha(dotColor, '88')}`, flexShrink: 0,
          }} />
          <span style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.07em', textTransform: 'uppercase' }}>
            {t('CYCLE_DAY_COUNTER_HEADER')}
          </span>
        </div>
        <span suppressHydrationWarning style={{
          fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
          color: dotColor, background: withAlpha(dotColor, '18'), border: `0.5px solid ${withAlpha(dotColor, '44')}`,
          padding: '2px 7px', borderRadius: 20,
        }}>{label}</span>
      </div>

      {/* Main number */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span suppressHydrationWarning style={{ fontSize: '2.25rem', fontWeight: 800, color: 'var(--txt)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {day.toLocaleString()}
        </span>
        <span style={{ fontSize: 'var(--fs-label)', color: 'var(--txt3)' }}>{t('CYCLE_DAY_COUNTER_DAYS_SINCE_LABEL')}</span>
      </div>

      {/* Progress bar toward peak window */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('CYCLE_DAY_COUNTER_HALVING_DATE_LABEL')}</span>
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('CYCLE_DAY_COUNTER_PEAK_ZONE_RANGE', { start: PEAK_WINDOW.start, end: PEAK_WINDOW.end })}</span>
        </div>
        <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 99,
            width: phasePct + '%',
            background: inPeakWindow
              ? 'linear-gradient(90deg, #34d399, #fbbf24)'
              : pastPeak
                ? 'var(--red)'
                : 'linear-gradient(90deg, #34d399, #34d399cc)',
            transition: 'width .4s',
          }} />
        </div>
        {/* Peak window markers */}
        {/* dir="ltr": a QUANTITATIVE AXIS DOES NOT MIRROR (#353).
             Arabic text reads right-to-left; a cycle-window ratio does not. Flipping
             this puts every marker at a position meaning a different value -
             rendering perfectly and lying. Explicit rather than inherited, so
             it stays true when the document direction changes. */}
        <div dir="ltr" style={{ position: 'relative', height: 12, marginTop: 2 }}>
          <span style={{
            position: 'absolute', fontSize: '0.6875rem', color: 'var(--amber)',
            left: `${(PEAK_WINDOW.start / PEAK_WINDOW.end) * 100}%`,
            transform: 'translateX(-50%)',
          }}>▲</span>
        </div>
      </div>

      {/* Footer stats */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', paddingTop: 6, borderTop: '0.5px solid var(--bdr)' }}>
        {prePeak && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>{t('CYCLE_DAY_COUNTER_DAYS_TO_PEAK_LABEL')}</span>
            <span suppressHydrationWarning style={{ fontSize: 'var(--fs-data)', fontWeight: 700, color: 'var(--green-2)', fontVariantNumeric: 'tabular-nums' }}>{PEAK_WINDOW.start - day}</span>
          </div>
        )}
        {inPeakWindow && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>{t('CYCLE_DAY_COUNTER_DAYS_IN_PEAK_LABEL')}</span>
            <span suppressHydrationWarning style={{ fontSize: 'var(--fs-data)', fontWeight: 700, color: 'var(--amber)', fontVariantNumeric: 'tabular-nums' }}>{day - PEAK_WINDOW.start}</span>
          </div>
        )}
        {pastPeak && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>{t('CYCLE_DAY_COUNTER_DAYS_PAST_PEAK_LABEL')}</span>
            <span suppressHydrationWarning style={{ fontSize: 'var(--fs-data)', fontWeight: 700, color: 'var(--red)', fontVariantNumeric: 'tabular-nums' }}>{day - PEAK_WINDOW.end}</span>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>{t('CYCLE_DAY_COUNTER_NEXT_HALVING_LABEL')}</span>
          <span suppressHydrationWarning style={{ fontSize: 'var(--fs-data)', fontWeight: 700, color: 'var(--txt2)', fontVariantNumeric: 'tabular-nums' }}>{t('CYCLE_DAY_COUNTER_NEXT_HALVING_VALUE', { days: daysToNext })}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>{t('CYCLE_DAY_COUNTER_HISTORICAL_CONTEXT_LABEL')}</span>
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('CYCLE_DAY_COUNTER_HISTORICAL_CONTEXT_DESC')}</span>
        </div>
      </div>
    </div>
  );
}
