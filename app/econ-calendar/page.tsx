'use client';
import { useState, useEffect } from 'react';

type CalEvent = {
  name: string; type: string; isoDate: string; impact: string;
  previous?: string; estimate?: string; actual?: string;
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtHeaderDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return isToday ? `Today — ${label}` : label;
}

function fmtDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function countdown(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return 'Released';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h >= 1)  return `${h}h ${m}m`;
  return `${m}m`;
}

function calcDelta(actual?: string, estimate?: string): { text: string; positive: boolean } | null {
  if (!actual || !estimate) return null;
  const strip = (s: string) => parseFloat(s.replace(/[^0-9.\-]/g, ''));
  const a = strip(actual);
  const e = strip(estimate);
  if (isNaN(a) || isNaN(e)) return null;
  const d = a - e;
  const unit = actual.includes('%') ? '%' : actual.match(/[KMB]$/) ? actual.slice(-1) : '';
  return { text: (d >= 0 ? '+' : '') + d.toFixed(2) + unit, positive: d >= 0 };
}

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const IMPACT_CFG = {
  HIGH:   { color: '#f87171', bg: 'rgba(248,113,113,0.14)', border: 'rgba(248,113,113,0.35)', accent: '#f87171' },
  MEDIUM: { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.3)',   accent: '#fbbf24' },
  LOW:    { color: '#6b7280', bg: 'rgba(107,114,128,0.10)', border: 'rgba(107,114,128,0.25)', accent: 'rgba(107,114,128,0.4)' },
};

const COLS = '68px 72px 1fr 90px 95px 82px 72px 70px';

export default function EconCalendarPage() {
  const [events, setEvents]   = useState<CalEvent[]>([]);
  const [source, setSource]   = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const now = useNow();

  useEffect(() => {
    fetch('/api/econ-calendar')
      .then(r => r.json())
      .then(d => { setEvents(d.events ?? []); setSource(d.source ?? ''); })
      .catch(() => setError('Failed to load calendar'))
      .finally(() => setLoading(false));
  }, []);

  const sorted = [...events].sort((a, b) => new Date(a.isoDate).getTime() - new Date(b.isoDate).getTime());
  const next   = sorted.find(e => new Date(e.isoDate).getTime() > now - 3_600_000);

  const grouped: Record<string, CalEvent[]> = {};
  for (const e of sorted) {
    const key = fmtDateKey(e.isoDate);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(e);
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 16px 48px' }}>

      {/* Page header */}
      <div style={{ padding: '20px 0 16px' }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--txt)', letterSpacing: '-.02em', marginBottom: 4 }}>
          Economic Calendar
        </div>
        <div style={{ fontSize: 12, color: 'var(--txt3)' }}>
          High-impact US macro events — FOMC, NFP, CPI, PCE, GDP and more
          {source && <span style={{ marginLeft: 8, opacity: .5 }}>· {source}</span>}
        </div>
      </div>

      {/* Next event banner */}
      {next && (() => {
        const ic  = IMPACT_CFG[next.impact as keyof typeof IMPACT_CFG] ?? IMPACT_CFG.LOW;
        const ct  = countdown(next.isoDate);
        const released = ct === 'Released';
        return (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            background: 'var(--bg1)', border: `0.5px solid var(--bdr)`,
            borderLeft: `3px solid ${ic.accent}`,
            borderRadius: 10, padding: '12px 16px', marginBottom: 20,
          }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: ic.color, marginBottom: 3 }}>
                {released ? 'Latest Release' : 'Next High-Impact Event'}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt)' }}>{next.name}</div>
              <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>{fmtTime(next.isoDate)}</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: ic.color, lineHeight: 1, letterSpacing: '-0.5px' }}>{ct}</div>
              {!released && <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>away</div>}
            </div>
          </div>
        );
      })()}

      {loading && (
        <div style={{ color: 'var(--txt3)', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>Loading…</div>
      )}
      {error && (
        <div style={{ color: '#f87171', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>{error}</div>
      )}
      {!loading && !error && sorted.length === 0 && (
        <div style={{ color: 'var(--txt3)', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>No upcoming events found.</div>
      )}

      {/* Day groups */}
      {Object.entries(grouped).map(([dateKey, dayEvents]) => (
        <div key={dateKey} style={{ marginBottom: 28 }}>

          {/* Date header */}
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt)', marginBottom: 10, letterSpacing: '-.01em' }}>
            {fmtHeaderDate(dayEvents[0].isoDate)}
          </div>

          {/* Table */}
          <div style={{ background: 'var(--bg1)', border: '0.5px solid var(--bdr)', borderRadius: 12, overflow: 'hidden' }}>

            {/* Scroll wrapper for narrow screens */}
            <div style={{ overflowX: 'auto' }}>

              {/* Column header */}
              <div style={{
                display: 'grid', gridTemplateColumns: COLS,
                padding: '8px 16px', gap: 8,
                borderBottom: '0.5px solid var(--bdr)',
                minWidth: 680,
              }}>
                {['TIME','COUNTRY','EVENT','PREVIOUS','CONSENSUS','ACTUAL','DELTA','IMPACT'].map(h => (
                  <div key={h} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.07em', color: 'var(--txt3)' }}>
                    {h}
                  </div>
                ))}
              </div>

              {/* Rows */}
              {dayEvents.map((e, i) => {
                const ic      = IMPACT_CFG[e.impact as keyof typeof IMPACT_CFG] ?? IMPACT_CFG.LOW;
                const isPast  = new Date(e.isoDate).getTime() < now;
                const isNext  = next?.isoDate === e.isoDate && next?.name === e.name;
                const delta   = calcDelta(e.actual, e.estimate);
                const ct      = countdown(e.isoDate);

                return (
                  <div
                    key={i}
                    style={{
                      display: 'grid', gridTemplateColumns: COLS, gap: 8,
                      padding: '11px 16px', alignItems: 'center',
                      borderLeft: `3px solid ${e.impact === 'HIGH' ? ic.accent : 'transparent'}`,
                      borderBottom: i < dayEvents.length - 1 ? '0.5px solid var(--bdr)' : 'none',
                      background: isNext ? 'rgba(255,255,255,0.025)' : 'transparent',
                      opacity: isPast && !e.actual ? 0.45 : 1,
                      minWidth: 680,
                    }}
                  >
                    {/* TIME */}
                    <div style={{ fontSize: 12, color: 'var(--txt2)', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                      {fmtTime(e.isoDate)}
                      {!isPast && ct !== 'Released' && (
                        <div style={{ fontSize: 9, color: 'var(--txt3)', marginTop: 1 }}>in {ct}</div>
                      )}
                    </div>

                    {/* COUNTRY */}
                    <div style={{ fontSize: 11, color: 'var(--txt3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>🇺🇸</span>
                      <span style={{ fontWeight: 600 }}>US</span>
                    </div>

                    {/* EVENT */}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)', lineHeight: 1.3 }}>
                        {e.name}
                      </div>
                    </div>

                    {/* PREVIOUS */}
                    <div style={{ fontSize: 12, color: 'var(--txt2)', fontVariantNumeric: 'tabular-nums' }}>
                      {e.previous || '—'}
                    </div>

                    {/* CONSENSUS */}
                    <div style={{ fontSize: 12, color: e.estimate ? '#fbbf24' : 'var(--txt3)', fontVariantNumeric: 'tabular-nums', fontWeight: e.estimate ? 500 : 400 }}>
                      {e.estimate || '—'}
                    </div>

                    {/* ACTUAL */}
                    <div style={{
                      fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                      color: e.actual
                        ? (delta ? (delta.positive ? '#34d399' : '#f87171') : '#34d399')
                        : 'var(--txt3)',
                    }}>
                      {e.actual || '—'}
                    </div>

                    {/* DELTA */}
                    <div style={{
                      fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                      color: delta ? (delta.positive ? '#34d399' : '#f87171') : 'var(--txt3)',
                    }}>
                      {delta?.text || '—'}
                    </div>

                    {/* IMPACT */}
                    <div>
                      <span style={{
                        display: 'inline-block',
                        fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
                        letterSpacing: '.04em',
                        color: ic.color, background: ic.bg, border: `0.5px solid ${ic.border}`,
                      }}>
                        {e.impact}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
