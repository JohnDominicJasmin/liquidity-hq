'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

type CalEvent = {
  name: string; type: string; isoDate: string; impact: string;
  previous?: string; estimate?: string; actual?: string;
};

const IMPACT_COLOR: Record<string, string> = {
  HIGH: '#f87171', MEDIUM: '#fbbf24', LOW: '#6b7280',
};

const MAX_ROWS = 5;

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtDateHeader(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  return isToday ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/* ── Econ Calendar preview - dashboard rail widget, links out to the full
   /econ-calendar page. Reuses the same /api/econ-calendar feed - no new
   data source, just a compact preview of the next few high-impact events. ── */
export default function EconCalendarWidget() {
  const [events, setEvents]   = useState<CalEvent[] | null>(null);
  const [error, setError]     = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/econ-calendar')
      .then(r => r.json())
      .then(d => { if (!cancelled) setEvents(d.events ?? []); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);

  const upcoming = (events ?? [])
    .filter(e => new Date(e.isoDate).getTime() > Date.now() - 3_600_000)
    .sort((a, b) => new Date(a.isoDate).getTime() - new Date(b.isoDate).getTime())
    .slice(0, MAX_ROWS);

  let lastDateKey = '';

  return (
    <div className="av-rail-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="av-rail-panel-h" style={{ marginBottom: 0 }}>Economic calendar</div>
        <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--txt3)', fontWeight: 600, letterSpacing: '.04em' }}>
          Upcoming
        </span>
      </div>

      {error && (
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', padding: '6px 0' }}>Failed to load calendar</div>
      )}
      {!error && events === null && (
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', padding: '6px 0' }}>Loading…</div>
      )}
      {!error && events !== null && upcoming.length === 0 && (
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', padding: '6px 0' }}>No upcoming high-impact events</div>
      )}

      {upcoming.map((e, i) => {
        const dateKey = fmtDateHeader(e.isoDate);
        const showDateHeader = dateKey !== lastDateKey;
        lastDateKey = dateKey;
        const col = IMPACT_COLOR[e.impact] ?? IMPACT_COLOR.LOW;
        return (
          <div key={i}>
            {showDateHeader && (
              <div style={{
                fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
                color: 'var(--txt3)', marginTop: i === 0 ? 0 : 10, marginBottom: 4,
              }}>
                {dateKey}
              </div>
            )}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 0', borderTop: i === 0 || showDateHeader ? 'none' : '0.5px solid var(--bdr)',
            }}>
              <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, width: 42 }}>
                {fmtTime(e.isoDate)}
              </span>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: col, flexShrink: 0 }} />
              <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt)', fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.name}
              </span>
              <span style={{
                fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.03em', padding: '2px 6px', borderRadius: 4,
                color: col, background: `${col}22`, flexShrink: 0,
              }}>
                {e.impact}
              </span>
            </div>
          </div>
        );
      })}

      <Link href="/econ-calendar" className="av-rail-collapse" style={{ marginTop: 10, textDecoration: 'none' }}>
        <span>See full calendar</span>
        <span className="chev">→</span>
      </Link>
    </div>
  );
}
