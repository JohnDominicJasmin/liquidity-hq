'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';
import { getAuthToken } from '@/lib/supabase';
import { econImpactKey, type EconImpact } from '@/lib/classify';
import { withAlpha } from '@/lib/color';

type CalEvent = {
  name: string; type: string; isoDate: string; impact: string;
  /* Computed date, not a published one (#245). */
  estimated?: boolean;
  previous?: string; estimate?: string; actual?: string;
};

type TFn = (key: LabelKey, vars?: Record<string, string | number>) => string;

/* LOW was #6b7280 = 3.77:1 on the rail card - and since econImpactKey did not
   exist, EVERY row used it regardless of real impact. See lib/classify.ts. */
// --txt2, not --txt-dim (#546 C9): --txt-dim isn't in terminal's 16-token
// palette; --txt2 is the correctly-governed "quiet" text token used for the
// same role elsewhere in the terminal design.
const IMPACT_COLOR: Record<EconImpact, string> = {
  HIGH: 'var(--red)', MEDIUM: 'var(--amber)', LOW: 'var(--txt2)',
};

const MAX_ROWS = 5;

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtDateHeader(iso: string, t: TFn, now: number): string {
  const d = new Date(iso);
  const today = new Date(now);
  const isToday = d.toDateString() === today.toDateString();
  return isToday ? t('ECON_CALENDAR_WIDGET_TODAY') : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/* ── Econ Calendar preview - dashboard rail widget, links out to the full
   /econ-calendar page. Reuses the same /api/econ-calendar feed - no new
   data source, just a compact preview of the next few high-impact events. ── */
export default function EconCalendarWidget() {
  const { t } = useLabels();
  const [events, setEvents]   = useState<CalEvent[] | null>(null);
  const [error, setError]     = useState(false);

  // "Now" is state, not a Date.now() call in the render body. Calling the clock
  // during render makes render impure - two renders with identical props can
  // disagree - which is what react-hooks/purity objects to. It was also a real
  // bug: the cutoff below only re-evaluated when something else happened to
  // re-render the widget, so an event that had already started could sit in the
  // list indefinitely. The minute tick matches the granularity the rows are
  // displayed at.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getAuthToken().then(token => fetch('/api/econ-calendar', {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }))
      .then(r => r.json())
      .then(d => { if (!cancelled) setEvents(d.events ?? []); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);

  const upcoming = (events ?? [])
    .filter(e => new Date(e.isoDate).getTime() > now - 3_600_000)
    .sort((a, b) => new Date(a.isoDate).getTime() - new Date(b.isoDate).getTime())
    .slice(0, MAX_ROWS);

  // Date-header flags are computed up front rather than tracked with a mutable
  // `let` that the .map() below reassigned while rendering. That only worked
  // because map happens to run synchronously during render; it is precisely
  // what react-hooks/immutability flags, and it goes wrong the moment rendering
  // is interrupted and restarted. Each row now says whether it starts a new
  // date by comparing against its predecessor, which needs no shared state.
  const rows = upcoming
    .map(e => ({ e, dateKey: fmtDateHeader(e.isoDate, t, now) }))
    .map((row, i, all) => ({ ...row, showDateHeader: i === 0 || row.dateKey !== all[i - 1].dateKey }));

  return (
    <div className="av-rail-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="av-rail-panel-h" style={{ marginBottom: 0 }}>{t('ECON_CALENDAR_WIDGET_TITLE')}</div>
        <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--txt3)', fontWeight: 600, letterSpacing: '.04em' }}>
          {t('ECON_CALENDAR_WIDGET_UPCOMING')}
        </span>
      </div>

      {error && (
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', padding: '6px 0' }}>{t('ECON_CALENDAR_WIDGET_LOAD_ERROR')}</div>
      )}
      {!error && events === null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }} role="status" aria-live="polite">
          <span className="sr-only">{t('ECON_CALENDAR_WIDGET_LOADING')}</span>
          {[0, 1, 2, 3].map(i => (
            <SkeletonBar key={i} height={22} radius={6} style={{ opacity: 1 - i * 0.15 }} />
          ))}
        </div>
      )}
      {!error && events !== null && upcoming.length === 0 && (
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', padding: '6px 0' }}>{t('ECON_CALENDAR_WIDGET_NO_EVENTS')}</div>
      )}

      {rows.map(({ e, dateKey, showDateHeader }, i) => {
        const col = IMPACT_COLOR[econImpactKey(e.impact)];
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
              {/* A leading ~ on an estimated row (#245). The date came from a
                  pattern, not a published schedule, and until now nothing on
                  screen said so - a computed entry looked identical to a real
                  one, and carried a real FRED `actual` besides. The tooltip
                  says it in words for anyone who does not read the tilde. */}
              <span
                title={e.estimated ? 'Estimated date - approximate, not a published release schedule' : undefined}
                style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, width: 42 }}
              >
                {e.estimated ? '~' : ''}{fmtTime(e.isoDate)}
              </span>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: col, flexShrink: 0 }} />
              <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt)', fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.name}
              </span>
              <span className="ecw-impact-chip" style={{
                fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.03em', padding: '2px 6px',
                color: col, background: withAlpha(col, '22'), flexShrink: 0,
              }}>
                {e.impact}
              </span>
            </div>
          </div>
        );
      })}

      <Link href="/econ-calendar" className="av-rail-collapse" style={{ marginTop: 10, textDecoration: 'none' }}>
        <span>{t('ECON_CALENDAR_WIDGET_SEE_FULL')}</span>
        <span className="chev">→</span>
      </Link>
    </div>
  );
}
