'use client';
import { useEffect, useState } from 'react';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';
import { deadlineSignal } from '@/lib/deadlineSignal';
import { readLastGood, writeLastGood } from '@/lib/lastGoodAge';

interface CyclePoint { day: number; ratio: number; }
interface CycleData {
  '2016': CyclePoint[];
  '2020': CyclePoint[];
  '2024': CyclePoint[];
  currentDay: number;
  error?: string;
}

const CYCLES: { key: '2016' | '2020' | '2024'; color: string }[] = [
  { key: '2016', color: 'var(--orange)' },
  { key: '2020', color: 'var(--amber)' },
  { key: '2024', color: 'var(--green-2)' },
];

const CYCLE_LEGEND_KEY: Record<'2016' | '2020' | '2024', LabelKey> = {
  '2016': 'CYCLE_CHART_LEGEND_2016',
  '2020': 'CYCLE_CHART_LEGEND_2020',
  '2024': 'CYCLE_CHART_LEGEND_2024',
};

/* The cycle curves move once a day, so the last good answer is kept (up to 30 days) and drawn when a read fails. */
const LAST_GOOD_KEY = 'lhq_cycle_chart_last_good';
const LAST_GOOD_MAX_AGE_MS = 30 * 86_400_000;
const RETRY_MS = [3_000, 10_000, 30_000];

const W = 560, H = 180, PAD = { t: 8, r: 12, b: 28, l: 44 };
const CW = W - PAD.l - PAD.r;
const CH = H - PAD.t - PAD.b;

const MAX_DAYS = 1100;
// Y axis: log ratio from 0.5x to 50x
const LOG_MIN = Math.log(0.5);
const LOG_MAX = Math.log(50);

function toX(day: number): number {
  return PAD.l + (day / MAX_DAYS) * CW;
}
function toY(ratio: number): number {
  const logR = Math.log(Math.max(0.1, ratio));
  const clamped = Math.max(LOG_MIN, Math.min(LOG_MAX, logR));
  return PAD.t + CH - ((clamped - LOG_MIN) / (LOG_MAX - LOG_MIN)) * CH;
}
function toPoints(pts: CyclePoint[]): string {
  return pts
    .filter(p => p.ratio > 0.01 && p.day <= MAX_DAYS)
    .map(p => `${toX(p.day).toFixed(1)},${toY(p.ratio).toFixed(1)}`)
    .join(' ');
}

const Y_TICKS = [
  { ratio: 0.5, label: '0.5x' },
  { ratio: 1,   label: '1x'   },
  { ratio: 2,   label: '2x'   },
  { ratio: 5,   label: '5x'   },
  { ratio: 10,  label: '10x'  },
  { ratio: 30,  label: '30x'  },
];
const X_TICKS = [0, 200, 400, 600, 800, 1000];

export default function CycleChart() {
  const { t } = useLabels();
  const [data, setData] = useState<CycleData | null>(null);
  /* True once every retry failed and there is nothing saved to draw: the card is hidden instead of printing a failure. */
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const saved = readLastGood<CycleData>(LAST_GOOD_KEY);
    let haveSaved = false;
    if (saved && Date.now() - saved.ts < LAST_GOOD_MAX_AGE_MS && saved.v['2024'] && saved.v['2016'] && saved.v['2020']) {
      /* The day counter moves on without the curves: advance it by the whole days since the answer was saved. */
      const daysSince = Math.floor((Date.now() - saved.ts) / 86_400_000);
      setData({ ...saved.v, currentDay: saved.v.currentDay + daysSince });
      haveSaved = true;
    }

    function failed() {
      if (cancelled) return;
      if (attempt < RETRY_MS.length) { timer = setTimeout(load, RETRY_MS[attempt]); attempt += 1; return; }
      if (!haveSaved) setGaveUp(true);
    }
    function load() {
      fetch('/api/cycle', { signal: deadlineSignal(15_000) })
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`cycle ${r.status}`)))
        .then((d: CycleData) => {
          if (cancelled) return;
          if (d.error || !d['2016'] || !d['2020'] || !d['2024']) { failed(); return; }
          setData(d); setGaveUp(false);
          writeLastGood(LAST_GOOD_KEY, d);
        })
        .catch(failed);
    }
    load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  const currentDay = data?.currentDay ?? 0;

  /* Nothing saved and every retry failed: hide the card. */
  if (gaveUp && !data) return null;

  return (
    <div style={{
      background: 'var(--bg1)', border: '0.5px solid var(--bdr)',
      borderRadius: 14, overflow: 'hidden', marginBottom: 12,
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px 10px', borderBottom: '0.5px solid var(--bdr)',
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.07em', textTransform: 'uppercase' }}>
            {t('CYCLE_CHART_TITLE')}
          </span>
          {currentDay > 0 && (
            <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)', marginLeft: 8 }}>
              {t('CYCLE_CHART_CURRENT_DAY', { day: currentDay })}
            </span>
          )}
        </div>
        {/* Legend */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {CYCLES.map(({ key, color }) => (
            <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-caption)', color }}>
              <span style={{ width: 16, height: 2, background: color, display: 'inline-block', borderRadius: 1 }} />
              {t(CYCLE_LEGEND_KEY[key])}
            </span>
          ))}
        </div>
      </div>

      {/* Loading / error */}
      {!data && (
        <div style={{ padding: '8px 14px 4px' }} role="status" aria-live="polite">
          <span className="sr-only">{t('CYCLE_CHART_LOADING_SR')}</span>
          <SkeletonBar width="100%" height={150} radius={8} />
        </div>
      )}

      {/* SVG chart */}
      {data && (
        <div style={{ padding: '8px 14px 4px' }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
            {/* Y grid lines + labels */}
            {Y_TICKS.map(({ ratio, label }) => {
              const y = toY(ratio);
              if (y < PAD.t || y > PAD.t + CH) return null;
              return (
                <g key={label}>
                  <line x1={PAD.l} y1={y} x2={PAD.l + CW} y2={y}
                    stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} />
                  <text x={PAD.l - 4} y={y + 3.5} textAnchor="end"
                    fontSize={8} fill="rgba(255,255,255,0.25)">{label}</text>
                </g>
              );
            })}

            {/* X grid lines + labels */}
            {X_TICKS.map(day => {
              const x = toX(day);
              return (
                <g key={day}>
                  <line x1={x} y1={PAD.t} x2={x} y2={PAD.t + CH}
                    stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} />
                  <text x={x} y={H - 6} textAnchor="middle"
                    fontSize={8} fill="rgba(255,255,255,0.25)">{day}d</text>
                </g>
              );
            })}

            {/* 1x baseline */}
            <line
              x1={PAD.l} y1={toY(1)} x2={PAD.l + CW} y2={toY(1)}
              stroke="rgba(255,255,255,0.12)" strokeWidth={0.5} strokeDasharray="3,3"
            />

            {/* Cycle lines */}
            {CYCLES.map(({ key, color }) => {
              const pts = data[key];
              if (!pts || pts.length === 0) return null;
              return (
                <polyline
                  key={key}
                  points={toPoints(pts)}
                  fill="none"
                  stroke={color}
                  strokeWidth={key === '2024' ? 1.5 : 1}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity={key === '2024' ? 1 : 0.6}
                />
              );
            })}

            {/* Current day marker on 2024 line */}
            {currentDay > 0 && currentDay <= MAX_DAYS && (() => {
              const cur24 = data['2024'].find(p => p.day === currentDay)
                ?? data['2024'].at(-1);
              if (!cur24) return null;
              const cx = toX(cur24.day);
              const cy = toY(cur24.ratio);
              return (
                <g>
                  <line x1={cx} y1={PAD.t} x2={cx} y2={PAD.t + CH}
                    stroke="#34d39944" strokeWidth={0.5} strokeDasharray="3,2" />
                  <circle cx={cx} cy={cy} r={3} fill="#34d399" />
                  <text x={cx + 4} y={cy - 4} fontSize={7.5} fill="#34d399">
                    {currentDay}d
                  </text>
                </g>
              );
            })()}
          </svg>
        </div>
      )}

      {/* Footer */}
      <div style={{ padding: '4px 14px 8px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)' }}>{t('CYCLE_CHART_FOOTER_YAXIS')}</span>
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)' }}>{t('CYCLE_CHART_FOOTER_SOURCE')}</span>
      </div>
    </div>
  );
}
