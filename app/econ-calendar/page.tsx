'use client';
import { useState, useEffect } from 'react';
import { useNow } from '@/lib/useNow';
import LoadingState from '@/components/LoadingState';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';
import { econImpactKey, type EconImpact } from '@/lib/classify';
import { useDesignMode } from '@/components/DesignModeProvider';

type CalEvent = {
  name: string; type: string; isoDate: string; impact: string;
  /* Computed date, not a published one (#245). */
  estimated?: boolean;
  previous?: string; estimate?: string; actual?: string;
};

type TFn = (key: LabelKey, vars?: Record<string, string | number>) => string;

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtHeaderDate(iso: string, t: TFn): string {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return isToday ? t('ECON_CALENDAR_TODAY_PREFIX', { date: label }) : label;
}

function fmtDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

// Stable, non-translated result shape - `released` is the comparison key
// used at call sites (never the translated string), so formatting the
// countdown for display can never break the released/pending check.
type Countdown = { released: true } | { released: false; totalHours: number; hRem: number; m: number };

function countdown(iso: string): Countdown {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return { released: true };
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return { released: false, totalHours: h, hRem: h % 24, m };
}

function formatCountdown(c: Countdown, t: TFn): string {
  if (c.released) return t('ECON_CALENDAR_RELEASED');
  if (c.totalHours >= 48) return t('ECON_CALENDAR_COUNTDOWN_DAYS_HOURS', { d: Math.floor(c.totalHours / 24), h: c.hRem });
  if (c.totalHours >= 1)  return t('ECON_CALENDAR_COUNTDOWN_HOURS_MINUTES', { h: c.totalHours, m: c.m });
  return t('ECON_CALENDAR_COUNTDOWN_MINUTES', { m: c.m });
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

/* Keyed by econImpactKey, never by the raw feed string - the feed says 'high'
   and 'med' in lowercase, so indexing this map directly missed on every row and
   painted the whole calendar in the LOW style. See lib/classify.ts.
   LOW's colour also failed AA on its own (#6b7280 = 3.77:1). */
const IMPACT_CFG: Record<EconImpact, { color: string; bg: string; border: string; accent: string }> = {
  /* #684: tints derive from the tokens instead of rgba() literals, and HIGH's
     foreground takes --red-fg.

     20 of this screen's 23 dark contrast failures were this one badge - --red
     on a wash of itself, worst 4.04, the same arithmetic as .gex-net-chip's
     4.05 on /liq that #688 just answered.

     TWO SEPARATE CAUSES, and tokenising fixes most of the first. The literal
     was rgba(248,113,113,...) - the CURRENT design's --red - so terminal was
     painting a lighter ground than its own palette would, which is why the
     measured 4.04 was worse than the 4.49 the tokenised tint gives. --red IS
     #f87171 at :root, so the current design is byte-identical; only terminal
     moves, and only to its own colour. Amber and the grey follow the same
     rule for the same reason.

     4.49 still misses on --bg1, so HIGH's foreground takes --red-fg - the
     --green-fg counterpart from #688, aliased to --red wherever it passes. */
  HIGH:   { color: 'var(--red-fg)', bg: 'color-mix(in srgb, var(--red) 14%, transparent)', border: 'color-mix(in srgb, var(--red) 35%, transparent)', accent: 'var(--red)' },
  MEDIUM: { color: 'var(--amber)', bg: 'color-mix(in srgb, var(--amber) 12%, transparent)', border: 'color-mix(in srgb, var(--amber) 30%, transparent)', accent: 'var(--amber)' },
  LOW:    { color: 'var(--txt-dim)', bg: 'color-mix(in srgb, var(--txt3) 10%, transparent)', border: 'color-mix(in srgb, var(--txt3) 25%, transparent)', accent: 'color-mix(in srgb, var(--txt3) 40%, transparent)' },
};

const COLS = '68px 72px 1fr 90px 95px 82px 72px 70px';

const COL_LABEL_KEYS: LabelKey[] = [
  'ECON_CALENDAR_COL_TIME', 'ECON_CALENDAR_COL_COUNTRY', 'ECON_CALENDAR_COL_EVENT', 'ECON_CALENDAR_COL_PREVIOUS',
  'ECON_CALENDAR_COL_CONSENSUS', 'ECON_CALENDAR_COL_ACTUAL', 'ECON_CALENDAR_COL_DELTA', 'ECON_CALENDAR_COL_IMPACT',
];

export default function EconCalendarPage() {
  const mode = useDesignMode();
  const { t } = useLabels();
  const [events, setEvents]   = useState<CalEvent[]>([]);
  const [source, setSource]   = useState('');
  const [loading, setLoading] = useState(true);
  // A flag, not a translated string. Building the message inside the effect
  // meant `t` had to be an effect dependency - and including it would have
  // re-fired the fetch every time the label map changed, so it was omitted
  // instead and the effect captured whichever `t` existed on first render.
  // Translating at render time removes the dependency entirely AND means the
  // message follows a language switch, which it previously did not.
  const [failed, setFailed]   = useState(false);
  const now = useNow();

  useEffect(() => {
    fetch('/api/econ-calendar')
      .then(r => r.json())
      .then(d => { setEvents(d.events ?? []); setSource(d.source ?? ''); })
      .catch(() => setFailed(true))
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
    <div className={mode === 'terminal' ? 'econ-term-wrap' : undefined} style={{ maxWidth: 960, margin: '0 auto', padding: '0 16px 48px' }}>

      {/* Page header */}
      <div style={{ padding: '20px 0 16px' }}>
        <div style={{ fontSize: 'var(--fs-section)', fontWeight: 800, color: 'var(--txt)', letterSpacing: '-.02em', marginBottom: 4 }}>
          {t('ECON_CALENDAR_TITLE')}
        </div>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>
          {t('ECON_CALENDAR_SUBTITLE')}
          {source && <span style={{ marginLeft: 8, opacity: .5 }}>· {source}</span>}
        </div>
      </div>

      {/* Next event banner */}
      {next && (() => {
        const ic  = IMPACT_CFG[econImpactKey(next.impact)];
        const ctObj = countdown(next.isoDate);
        const ct  = formatCountdown(ctObj, t);
        const released = ctObj.released;
        return (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            background: 'var(--bg1)', border: `0.5px solid var(--bdr)`,
            borderLeft: `3px solid ${ic.accent}`,
            borderRadius: 10, padding: '12px 16px', marginBottom: 20,
          }}>
            <div>
              <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: ic.color, marginBottom: 3 }}>
                {released ? t('ECON_CALENDAR_LATEST_RELEASE') : t('ECON_CALENDAR_NEXT_EVENT')}
              </div>
              <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--txt)' }}>{next.name}</div>
              {/* The hero date is the most prominent claim on this page, so an
                  estimated one says so in words rather than only a tilde (#245). */}
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 2 }}>
                {next.estimated ? '~' : ''}{fmtTime(next.isoDate)}
                {next.estimated && (
                  <span
                    title="This date is computed from a typical release pattern, not a published schedule. It can be off by several days."
                    style={{ marginLeft: 6, fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.04em',
                             textTransform: 'uppercase', color: 'var(--amber)' }}
                  >
                    estimated
                  </span>
                )}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: ic.color, lineHeight: 1, letterSpacing: '-0.5px' }}>{ct}</div>
              {!released && <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 2 }}>{t('ECON_CALENDAR_COUNTDOWN_AWAY')}</div>}
            </div>
          </div>
        );
      })()}

      {loading && <LoadingState message={t('ECON_CALENDAR_LOADING')} />}
      {failed && (
        <div style={{ color: 'var(--red)', fontSize: 'var(--fs-label)', padding: '20px 0', textAlign: 'center' }}>{t('ECON_CALENDAR_LOAD_ERROR')}</div>
      )}
      {!loading && !failed && sorted.length === 0 && (
        <div style={{ color: 'var(--txt3)', fontSize: 'var(--fs-label)', padding: '40px 0', textAlign: 'center' }}>{t('ECON_CALENDAR_NO_EVENTS')}</div>
      )}

      {/* Day groups */}
      {Object.entries(grouped).map(([dateKey, dayEvents]) => (
        <div key={dateKey} style={{ marginBottom: 28 }}>

          {/* Date header */}
          <div style={{ fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--txt)', marginBottom: 10, letterSpacing: '-.01em' }}>
            {fmtHeaderDate(dayEvents[0].isoDate, t)}
          </div>

          {/* Table */}
          <div style={{ background: 'var(--bg1)', border: '0.5px solid var(--bdr)', borderRadius: 12, overflow: 'hidden' }}>

            {/* Scroll wrapper for narrow screens */}
            <div style={{ overflowX: 'auto' }}>

              {/* Column header */}
              <div className="ec-grid ec-hdr" style={{
                display: 'grid', gridTemplateColumns: COLS,
                padding: '8px 16px', gap: 8,
                borderBottom: '0.5px solid var(--bdr)',
                minWidth: 680,
              }}>
                {COL_LABEL_KEYS.map(h => (
                  <div key={h} style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, letterSpacing: '.07em', color: 'var(--txt3)' }}>
                    {t(h)}
                  </div>
                ))}
              </div>

              {/* Rows */}
              {dayEvents.map((e, i) => {
                const ic      = IMPACT_CFG[econImpactKey(e.impact)];
                const isPast  = new Date(e.isoDate).getTime() < now;
                const isNext  = next?.isoDate === e.isoDate && next?.name === e.name;
                const delta   = calcDelta(e.actual, e.estimate);
                const ctObj   = countdown(e.isoDate);
                const ct      = formatCountdown(ctObj, t);

                return (
                  <div
                    key={i}
                    className="ec-grid ec-row"
                    style={{
                      display: 'grid', gridTemplateColumns: COLS, gap: 8,
                      padding: '11px 16px', alignItems: 'center',
                      borderLeft: `3px solid ${e.impact === 'HIGH' ? ic.accent : 'transparent'}`,
                      borderBottom: i < dayEvents.length - 1 ? '0.5px solid var(--bdr)' : 'none',
                      /* #684: the overlay that composites this row up is what
                         put --txt3 at 4.46 in dark - four cells, dev's
                         predicted 4.45 against QA's measured 4.46. The cells
                         below take --txt-dash on this row for the same reason
                         /liq's marker and /correlation's null cell did. */
                      background: isNext ? 'color-mix(in srgb, var(--txt) 2.5%, transparent)' : 'transparent',
                      /* The cells below read --ec-muted rather than --txt3 directly.
                         A CSS rule could not reach them - they set colour inline, which
                         outranks every selector (#663) - but an inline value that READS a
                         custom property still inherits, so the row can move all four at
                         once without a class toggle per cell. */
                      ['--ec-muted' as string]: isNext ? 'var(--txt-dash)' : 'var(--txt3)',
                      opacity: isPast && !e.actual ? 0.45 : 1,
                      minWidth: 680,
                    }}
                  >
                    {/* TIME */}
                    <div
                      title={e.estimated ? 'Estimated date - computed from a typical release pattern, not a published schedule' : undefined}
                      style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}
                    >
                      {e.estimated ? '~' : ''}{fmtTime(e.isoDate)}
                      {!isPast && !ctObj.released && (
                        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--ec-muted)', marginTop: 1 }}>{t('ECON_CALENDAR_IN_COUNTDOWN', { countdown: ct })}</div>
                      )}
                    </div>

                    {/* COUNTRY */}
                    <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--ec-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontWeight: 600 }}>{t('ECON_CALENDAR_COUNTRY_US')}</span>
                    </div>

                    {/* EVENT */}
                    <div>
                      <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--txt)', lineHeight: 1.3 }}>
                        {e.name}
                      </div>
                    </div>

                    {/* PREVIOUS */}
                    <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', fontVariantNumeric: 'tabular-nums' }}>
                      {e.previous || '-'}
                    </div>

                    {/* CONSENSUS */}
                    <div style={{ fontSize: 'var(--fs-caption)', color: e.estimate ? 'var(--amber)' : 'var(--ec-muted)', fontVariantNumeric: 'tabular-nums', fontWeight: e.estimate ? 500 : 400 }}>
                      {e.estimate || '-'}
                    </div>

                    {/* ACTUAL */}
                    <div style={{
                      fontSize: 'var(--fs-caption)', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                      color: e.actual
                        ? (delta ? (delta.positive ? 'var(--green-2)' : 'var(--red)') : 'var(--green-2)')
                        : 'var(--ec-muted)',
                    }}>
                      {e.actual || '-'}
                    </div>

                    {/* DELTA */}
                    <div style={{
                      fontSize: 'var(--fs-caption)', fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                      color: delta ? (delta.positive ? 'var(--green-fg)' : 'var(--red)') : 'var(--ec-muted)',
                    }}>
                      {delta?.text || '-'}
                    </div>

                    {/* IMPACT */}
                    <div>
                      <span style={{
                        display: 'inline-block',
                        fontSize: 'var(--fs-caption)', fontWeight: 700, padding: '3px 8px', borderRadius: 4,
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
