'use client';
import { useState, useEffect } from 'react';

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
  const latest = HALVINGS[HALVINGS.length - 1];
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60 * 60 * 1000); // refresh hourly
    return () => clearInterval(id);
  }, []);
  const day        = Math.floor((now - latest.date.getTime()) / 86_400_000);
  const daysToNext = Math.ceil((NEXT_HALVING_EST.getTime() - now) / 86_400_000);

  const inPeakWindow = day >= PEAK_WINDOW.start && day <= PEAK_WINDOW.end;
  const pastPeak     = day > PEAK_WINDOW.end;
  const prePeak      = day < PEAK_WINDOW.start;

  const dotColor = inPeakWindow ? '#fbbf24' : pastPeak ? '#f87171' : '#34d399';
  const label    = inPeakWindow ? 'In peak zone' : pastPeak ? 'Post-peak zone' : 'Pre-peak zone';
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
            boxShadow: `0 0 6px ${dotColor}88`, flexShrink: 0,
          }} />
          <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.07em', textTransform: 'uppercase' }}>
            Cycle Day
          </span>
        </div>
        <span suppressHydrationWarning style={{
          fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
          color: dotColor, background: dotColor + '18', border: `0.5px solid ${dotColor}44`,
          padding: '2px 7px', borderRadius: 20,
        }}>{label}</span>
      </div>

      {/* Main number */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span suppressHydrationWarning style={{ fontSize: '2.25rem', fontWeight: 800, color: 'var(--txt)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {day.toLocaleString()}
        </span>
        <span style={{ fontSize: '0.8125rem', color: 'var(--txt3)' }}>days since 4th halving</span>
      </div>

      {/* Progress bar toward peak window */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{ fontSize: '0.625rem', color: 'var(--txt3)' }}>Halving · Apr 20, 2024</span>
          <span style={{ fontSize: '0.625rem', color: 'var(--txt3)' }}>Est. peak zone: Day {PEAK_WINDOW.start}-{PEAK_WINDOW.end}</span>
        </div>
        <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 99,
            width: phasePct + '%',
            background: inPeakWindow
              ? 'linear-gradient(90deg, #34d399, #fbbf24)'
              : pastPeak
                ? '#f87171'
                : 'linear-gradient(90deg, #34d399, #34d399cc)',
            transition: 'width .4s',
          }} />
        </div>
        {/* Peak window markers */}
        <div style={{ position: 'relative', height: 12, marginTop: 2 }}>
          <span style={{
            position: 'absolute', fontSize: '0.6875rem', color: '#fbbf24',
            left: `${(PEAK_WINDOW.start / PEAK_WINDOW.end) * 100}%`,
            transform: 'translateX(-50%)',
          }}>▲</span>
        </div>
      </div>

      {/* Footer stats */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', paddingTop: 6, borderTop: '0.5px solid var(--bdr)' }}>
        {prePeak && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: '0.625rem', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>Days to peak zone</span>
            <span suppressHydrationWarning style={{ fontSize: '0.875rem', fontWeight: 700, color: '#34d399', fontVariantNumeric: 'tabular-nums' }}>{PEAK_WINDOW.start - day}</span>
          </div>
        )}
        {inPeakWindow && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: '0.625rem', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>Days in peak zone</span>
            <span suppressHydrationWarning style={{ fontSize: '0.875rem', fontWeight: 700, color: '#fbbf24', fontVariantNumeric: 'tabular-nums' }}>{day - PEAK_WINDOW.start}</span>
          </div>
        )}
        {pastPeak && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: '0.625rem', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>Days past peak zone</span>
            <span suppressHydrationWarning style={{ fontSize: '0.875rem', fontWeight: 700, color: '#f87171', fontVariantNumeric: 'tabular-nums' }}>{day - PEAK_WINDOW.end}</span>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: '0.625rem', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>Est. next halving</span>
          <span suppressHydrationWarning style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--txt2)', fontVariantNumeric: 'tabular-nums' }}>~{daysToNext}d (Mar 2028)</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: '0.625rem', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>Historical context</span>
          <span style={{ fontSize: '0.6875rem', color: 'var(--txt3)' }}>2020: peaked Day 546 · 2016: Day 526</span>
        </div>
      </div>
    </div>
  );
}
