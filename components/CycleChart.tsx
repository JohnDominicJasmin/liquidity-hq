'use client';
import { useEffect, useState } from 'react';

interface CyclePoint { day: number; ratio: number; }
interface CycleData {
  '2016': CyclePoint[];
  '2020': CyclePoint[];
  '2024': CyclePoint[];
  currentDay: number;
  error?: string;
}

const CYCLES: { key: '2016' | '2020' | '2024'; color: string; label: string }[] = [
  { key: '2016', color: '#fb923c', label: '2016 Cycle' },
  { key: '2020', color: '#fbbf24', label: '2020 Cycle' },
  { key: '2024', color: '#34d399', label: '2024 Cycle (current)' },
];

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
  const [data, setData] = useState<CycleData | null>(null);
  const [err, setErr]   = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/cycle')
      .then(r => r.ok ? r.json() : Promise.reject(`${r.status}`))
      .then((d: CycleData) => {
        if (d.error) setErr(d.error);
        else setData(d);
      })
      .catch(e => setErr(String(e)));
  }, []);

  const currentDay = data?.currentDay ?? 0;

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
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.07em', textTransform: 'uppercase' }}>
            Cycle Comparison · Days Since Halving
          </span>
          {currentDay > 0 && (
            <span style={{ fontSize: 11, color: '#555', marginLeft: 8 }}>
              Day {currentDay} of 2024 cycle
            </span>
          )}
        </div>
        {/* Legend */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {CYCLES.map(({ key, color, label }) => (
            <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color }}>
              <span style={{ width: 16, height: 2, background: color, display: 'inline-block', borderRadius: 1 }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Loading / error */}
      {!data && !err && (
        <div style={{ padding: '28px 14px', fontSize: 12, color: '#444' }}>Loading cycle data…</div>
      )}
      {err && (
        <div style={{ padding: '20px 14px', fontSize: 12, color: '#f87171' }}>Failed to load: {err}</div>
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
        <span style={{ fontSize: 11, color: '#444' }}>Y axis: price multiple from halving day (log scale)</span>
        <span style={{ fontSize: 11, color: '#444' }}>2024 via Bybit · 1h cache</span>
      </div>
    </div>
  );
}
