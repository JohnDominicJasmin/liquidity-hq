'use client';
import { deadlineSignal } from '@/lib/deadlineSignal';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';
import { getAuthToken } from '@/lib/supabase';
import { econImpactKey, econImpactWordKey, type EconImpact } from '@/lib/classify';
import { localZoneAbbr } from '@/lib/resetTime';
import { withAlpha } from '@/lib/color';
import { calendarFromResponse } from '@/lib/econCalendarFeed';
import { useNews } from '@/components/NewsProvider';
import { ageLabel } from '@/lib/ageLabel';

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
/* A failed read is tried again, never left as the answer (#1185 D16): 1 min, then doubling to 10 min. A good read is refreshed every 15 min. The events already on screen stay while a refresh fails. */
const RETRY_MIN_MS = 60_000;
const RETRY_MAX_MS = 10 * 60_000;
const REFRESH_MS = 15 * 60_000;
/* The age is only said once a refresh has been failing for a while; a read a few minutes old needs no label. */
const SHOW_AGE_AFTER_MS = 30 * 60_000;

/* The time is shown in the viewer's own zone and now says which (PM audit A11); hour12:false could print midnight as "24:30" in some engines, so the
   24-hour cycle is requested explicitly. */
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) + ' ' + localZoneAbbr();
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
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [error, setError]     = useState(false);
  /* The shared calendar NewsProvider already holds (Briefing and Confluence read it): shown while this widget's own read has not landed or keeps failing. */
  const { econRaw, econStale, econAgeMs } = useNews();

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
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const load = () => {
      getAuthToken().then(token => fetch('/api/econ-calendar', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        signal: deadlineSignal(20_000),
      }))
        .then(async r => calendarFromResponse<CalEvent>(r.ok, await r.json().catch(() => null)))
        // #1637: a 429, a 500 or a body without events is a failed load, like source 'none' - never "no upcoming events".
        .then(cal => {
          if (cancelled) return;
          if (!cal) throw new Error('no calendar');
          failures = 0;
          setEvents(cal.events); setLoadedAt(Date.now()); setError(false);
          timer = setTimeout(load, REFRESH_MS);
        })
        .catch(() => {
          if (cancelled) return;
          failures += 1;
          setError(true);
          timer = setTimeout(load, Math.min(RETRY_MIN_MS * 2 ** (failures - 1), RETRY_MAX_MS));
        });
    };
    load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  /* Own read first; the shared calendar when this one has nothing yet. */
  const fromShared = events === null && econRaw.length > 0;
  const shown: CalEvent[] | null = events ?? (fromShared ? econRaw : null);
  const ageMs = loadedAt != null ? now - loadedAt : fromShared && econStale && econAgeMs != null ? econAgeMs : null;
  const showAge = error && ageMs != null && ageMs > SHOW_AGE_AFTER_MS;

  const upcoming = (shown ?? [])
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

  /* Nothing to show and nothing on the way: the card is hidden, not a failure line (OWNER-RULES 21: last good value or hide). It comes back by itself when a retry lands.
     A shared calendar that is all in the past and older than a day says nothing about what is coming, so it hides the card too instead of claiming "no events". */
  if ((shown === null && error) || (fromShared && econStale && upcoming.length === 0)) return null;

  return (
    <div className="av-rail-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="av-rail-panel-h" style={{ marginBottom: 0 }}>{t('ECON_CALENDAR_WIDGET_TITLE')}</div>
        <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--txt3)', fontWeight: 600, letterSpacing: '.04em' }}>
          {t('ECON_CALENDAR_WIDGET_UPCOMING')}
          {showAge && ageMs != null && <span data-testid="econ-widget-age">{' · '}{ageLabel(ageMs, t)}</span>}
        </span>
      </div>

      {shown === null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }} role="status" aria-live="polite">
          <span className="sr-only">{t('ECON_CALENDAR_WIDGET_LOADING')}</span>
          {[0, 1, 2, 3].map(i => (
            <SkeletonBar key={i} height={22} radius={6} style={{ opacity: 1 - i * 0.15 }} />
          ))}
        </div>
      )}
      {shown !== null && upcoming.length === 0 && (
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
                title={e.estimated ? t('ECON_ESTIMATED_TIP_WIDGET') : undefined}
                style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, width: 42 }}
              >
                {e.estimated ? '~' : ''}{fmtTime(e.isoDate)}
              </span>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: col, flexShrink: 0 }} />
              <span title={e.name} style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt)', fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.name}
              </span>
              {/* No chip for an impact the classifier does not know, rather than a dash (#1185 D17). */}
              {econImpactWordKey(e.impact) && (
                <span className="ecw-impact-chip" style={{
                  fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.03em', padding: '2px 6px',
                  color: col, background: withAlpha(col, '22'), flexShrink: 0,
                }}>
                  {t(econImpactWordKey(e.impact)!)}
                </span>
              )}
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
