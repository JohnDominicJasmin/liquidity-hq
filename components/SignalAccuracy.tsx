'use client';
import { useEffect, useState } from 'react';
import Tip from '@/components/Tip';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';

interface SignalStat {
  name:       string;
  label:      string;
  timeframe:  string;
  direction:  'long' | 'short';
  count:      number;
  accuracy3:  number;
  accuracy6:  number;
  avgReturn3: number;
  avgReturn6: number;
}

interface ApiResponse {
  stats:   SignalStat[];
  candles: number;
  error?:  string;
}

function accColor(pct: number): string {
  if (pct >= 70) return '#34d399';
  if (pct >= 55) return '#fbbf24';
  return '#f87171';
}

function retColor(r: number): string {
  if (r > 0.5)  return '#34d399';
  if (r > 0)    return '#6ee7b7';
  if (r > -0.5) return '#fca5a5';
  return '#f87171';
}

function accBar(pct: number, color: string) {
  return (
    <div style={{ height: 3, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginTop: 3 }}>
      <div style={{ height: '100%', borderRadius: 99, width: `${pct}%`, background: color }} />
    </div>
  );
}

const COLS: { labelKey: LabelKey; align: 'left' | 'right'; tipKey: LabelKey | null }[] = [
  { labelKey: 'SIGNAL_ACCURACY_COL_SIGNAL',       align: 'left',  tipKey: null },
  { labelKey: 'SIGNAL_ACCURACY_COL_TF',           align: 'right', tipKey: null },
  { labelKey: 'SIGNAL_ACCURACY_COL_WIN_RATE_12H', align: 'right', tipKey: 'SIGNAL_ACCURACY_TIP_WIN_RATE_12H' },
  { labelKey: 'SIGNAL_ACCURACY_COL_WIN_RATE_24H', align: 'right', tipKey: 'SIGNAL_ACCURACY_TIP_WIN_RATE_24H' },
  { labelKey: 'SIGNAL_ACCURACY_COL_COUNT',        align: 'right', tipKey: 'SIGNAL_ACCURACY_TIP_COUNT' },
];

export default function SignalAccuracy() {
  const { t } = useLabels();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [err,  setErr]  = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/signal-accuracy')
      .then(r => r.ok ? r.json() : Promise.reject(`${r.status}`))
      .then((d: ApiResponse) => {
        if (d.error) setErr(d.error);
        else setData(d);
      })
      .catch(e => setErr(String(e)));
  }, []);

  return (
    <div style={{
      background: 'var(--bg1)', border: '0.5px solid var(--bdr)',
      borderRadius: 14, overflow: 'hidden', marginBottom: 12,
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px 10px', borderBottom: '0.5px solid var(--bdr)',
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.07em', textTransform: 'uppercase', flex: 1 }}>
          <Tip width={260} text={t('SIGNAL_ACCURACY_TOOLTIP')}>{t('SIGNAL_ACCURACY_TITLE')}</Tip>
        </span>
        {data?.candles && (
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)' }}>{t('SIGNAL_ACCURACY_CANDLES_INFO', { candles: data.candles })}</span>
        )}
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)' }}>{t('SIGNAL_ACCURACY_CACHE_NOTE')}</span>
      </div>

      {/* Loading / error */}
      {!data && !err && (
        /* Four thin bars reserved ~90px where the loaded card needs ~420, so it
           grew by 270px on arrival and pushed everything below it. Taller bars
           at the real row count reserve roughly the right space instead. */
        <div style={{ padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 9 }} role="status" aria-live="polite">
          <span className="sr-only">{t('SIGNAL_ACCURACY_SR_COMPUTING')}</span>
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonBar key={i} height={36} radius={6} style={{ opacity: Math.max(0.25, 1 - i * 0.09) }} />
          ))}
        </div>
      )}
      {err && (
        <div style={{ padding: '16px 14px', fontSize: 'var(--fs-caption)', color: '#f87171' }}>{t('SIGNAL_ACCURACY_LOAD_ERROR')} {err}</div>
      )}

      {/* Column headers */}
      {data?.stats && data.stats.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 52px 80px 80px 64px',
            minWidth: 340,
            padding: '5px 14px',
            borderBottom: '0.5px solid rgba(255,255,255,0.05)',
            background: 'rgba(255,255,255,0.02)',
          }}>
            {COLS.map(
              ({ labelKey, align, tipKey }) => (
                <span key={labelKey} style={{
                  fontSize: 'var(--fs-micro)', fontWeight: 600, letterSpacing: '.07em',
                  textTransform: 'uppercase', color: 'var(--txt-dim)', textAlign: align,
                }}>
                  {tipKey ? <Tip width={200} text={t(tipKey)}>{t(labelKey)}</Tip> : t(labelKey)}
                </span>
              )
            )}
          </div>

          {data.stats.map(sig => {
            const col3 = accColor(sig.accuracy3);
            const col6 = accColor(sig.accuracy6);
            const dirIcon = sig.direction === 'long' ? '↑' : '↓';
            const dirColor = sig.direction === 'long' ? '#34d399' : '#f87171';
            return (
              <div
                key={sig.name}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 52px 80px 80px 64px',
                  minWidth: 340,
                  alignItems: 'center',
                  padding: '8px 14px',
                  borderBottom: '0.5px solid rgba(255,255,255,0.04)',
                }}
              >
                {/* Signal name */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: dirColor }}>{dirIcon}</span>
                    <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--txt)' }}>{sig.label}</span>
                  </div>
                  <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)' }}>
                    {t('SIGNAL_ACCURACY_AVG_RETURN', { sign: sig.direction === 'long' ? '+' : '', value: sig.avgReturn6.toFixed(2) })}
                  </span>
                </div>

                {/* Timeframe */}
                <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--txt-dim)', textAlign: 'right' }}>
                  {sig.timeframe}
                </span>

                {/* Accuracy +3 candles */}
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: col3 }}>{sig.accuracy3}%</span>
                  {accBar(sig.accuracy3, col3)}
                </div>

                {/* Accuracy +6 candles */}
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: col6 }}>{sig.accuracy6}%</span>
                  {accBar(sig.accuracy6, col6)}
                </div>

                {/* Signal count */}
                <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {sig.count}×
                </span>
              </div>
            );
          })}

          {/* Footer */}
          <div style={{ padding: '6px 14px 8px', borderTop: '0.5px solid rgba(255,255,255,0.05)' }}>
            <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)' }}>
              {t('SIGNAL_ACCURACY_FOOTER_NOTE')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
