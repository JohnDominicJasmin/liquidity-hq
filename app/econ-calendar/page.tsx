'use client';
import { useState, useEffect } from 'react';

type CalEvent = {
  name: string; type: string; isoDate: string; impact: string;
  previous?: string; estimate?: string; actual?: string;
};

const TYPE_CFG: Record<string, { color: string; bg: string; bdr: string }> = {
  FOMC:   { color: '#f87171', bg: 'rgba(248,113,113,.12)', bdr: 'rgba(248,113,113,.3)'  },
  NFP:    { color: '#fb923c', bg: 'rgba(251,146,60,.1)',   bdr: 'rgba(251,146,60,.28)'  },
  CPI:    { color: '#fbbf24', bg: 'rgba(251,191,36,.1)',   bdr: 'rgba(251,191,36,.28)'  },
  PPI:    { color: '#f59e0b', bg: 'rgba(245,158,11,.1)',   bdr: 'rgba(245,158,11,.28)'  },
  PCE:    { color: '#34d399', bg: 'rgba(52,211,153,.09)',  bdr: 'rgba(52,211,153,.25)'  },
  GDP:    { color: '#86efac', bg: 'rgba(134,239,172,.08)', bdr: 'rgba(134,239,172,.22)' },
  RETAIL: { color: '#60a5fa', bg: 'rgba(96,165,250,.09)',  bdr: 'rgba(96,165,250,.25)'  },
  FED:    { color: '#a78bfa', bg: 'rgba(167,139,250,.1)',  bdr: 'rgba(167,139,250,.28)' },
  MACRO:  { color: '#94a3b8', bg: 'rgba(148,163,184,.08)', bdr: 'rgba(148,163,184,.2)' },
};

function cfgFor(type: string) {
  return TYPE_CFG[type] ?? TYPE_CFG.MACRO;
}

function fmtLocalDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function fmtLocalTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
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

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

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

  const next = sorted.find(e => new Date(e.isoDate).getTime() > now - 3_600_000);

  const grouped: Record<string, CalEvent[]> = {};
  for (const e of sorted) {
    const key = fmtDateKey(e.isoDate);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(e);
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 16px 48px' }}>
      {/* Page header */}
      <div style={{ padding: '20px 0 16px' }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--txt)', letterSpacing: '-.02em', marginBottom: 4 }}>
          Economic Calendar
        </div>
        <div style={{ fontSize: 12, color: 'var(--txt3)' }}>
          High-impact US macro events — FOMC, NFP, CPI, PCE, GDP and more
          {source && <span style={{ marginLeft: 8, opacity: .6 }}>· {source}</span>}
        </div>
      </div>

      {/* Next event banner */}
      {next && (() => {
        const cfg = cfgFor(next.type);
        const ct  = countdown(next.isoDate);
        const released = ct === 'Released';
        return (
          <div style={{
            background: cfg.bg, border: `0.5px solid ${cfg.bdr}`, borderRadius: 14,
            padding: '14px 18px', marginBottom: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: cfg.color, marginBottom: 4 }}>
                {released ? 'Latest Release' : 'Next Event'}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--txt)' }}>{next.name}</div>
              <div style={{ fontSize: 12, color: 'var(--txt3)', marginTop: 2 }}>{fmtLocalTime(next.isoDate)}</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: cfg.color, lineHeight: 1 }}>{ct}</div>
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
        <div style={{ color: 'var(--txt3)', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>
          No upcoming events found.
        </div>
      )}

      {/* Event groups */}
      {Object.entries(grouped).map(([dateKey, dayEvents]) => (
        <div key={dateKey} style={{ marginBottom: 24 }}>
          {/* Date header */}
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase',
            color: 'var(--txt3)', marginBottom: 8, paddingBottom: 6,
            borderBottom: '0.5px solid var(--bdr)',
          }}>
            {fmtLocalDate(dayEvents[0].isoDate)}
          </div>

          {/* Event cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {dayEvents.map((e, i) => {
              const cfg     = cfgFor(e.type);
              const isPast  = new Date(e.isoDate).getTime() < now;
              const isNext  = next?.isoDate === e.isoDate && next?.name === e.name;

              return (
                <div key={i} style={{
                  background: isNext ? cfg.bg : 'var(--bg1)',
                  border: `0.5px solid ${isNext ? cfg.bdr : 'var(--bdr)'}`,
                  borderRadius: 12,
                  padding: '12px 14px',
                  opacity: isPast && !e.actual ? .55 : 1,
                  transition: 'opacity .2s',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    {/* Type badge */}
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
                      padding: '3px 8px', borderRadius: 20,
                      color: cfg.color, background: cfg.bg, border: `0.5px solid ${cfg.bdr}`,
                      whiteSpace: 'nowrap', flexShrink: 0, marginTop: 1,
                    }}>
                      {e.type}
                    </span>

                    {/* Name + time */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)', lineHeight: 1.3 }}>
                        {e.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 3 }}>
                        {fmtLocalTime(e.isoDate)}
                        {!isPast && (
                          <span style={{ marginLeft: 8, color: cfg.color, fontWeight: 600 }}>
                            in {countdown(e.isoDate)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* P / E / A row */}
                  {(e.previous || e.estimate || e.actual) && (
                    <div style={{
                      display: 'flex', gap: 16, flexWrap: 'wrap',
                      marginTop: 10, paddingTop: 10,
                      borderTop: '0.5px solid var(--bdr)',
                    }}>
                      {e.previous && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 10, color: 'var(--txt3)', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>Previous</span>
                          <span style={{ fontSize: 13, color: 'var(--txt2)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{e.previous}</span>
                        </div>
                      )}
                      {e.estimate && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 10, color: 'var(--txt3)', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>Estimate</span>
                          <span style={{ fontSize: 13, color: '#fbbf24', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{e.estimate}</span>
                        </div>
                      )}
                      {e.actual && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 10, color: 'var(--txt3)', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>Actual</span>
                          <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                            color: e.estimate
                              ? (parseFloat(e.actual) > parseFloat(e.estimate) ? '#34d399' : '#f87171')
                              : '#34d399',
                          }}>{e.actual}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
