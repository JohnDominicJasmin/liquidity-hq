'use client';
import { useState, useEffect } from 'react';
import { getLocalNow, getCurrentWindow, isDead, getUpcomingWindows } from '@/lib/session';
import { utcWindowToLocalRange, localZoneAbbr } from '@/lib/resetTime';
import SessionCountdown from '@/components/SessionCountdown';
import Tip from '@/components/Tip';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';
import { useDesignMode } from '@/components/DesignModeProvider';
import { readableOn } from '@/lib/readableOn';

/* Typical-weekday session blocks, as UTC hour ranges - the same windows
   lib/session.ts enforces. These used to be PHT hours on a fixed PHT axis
   while the needle below was positioned from the VIEWER'S local clock, so
   for anyone outside UTC+8 the blocks and the "you are here" marker
   disagreed: a London trader saw the needle sitting in "DEAD" during their
   own London open. Anchored to UTC here and shifted to the viewer's offset
   at render time, so both agree for everyone.
   Asia runs 23:00-03:00 UTC, written as 23->27 so the range stays ordered. */
const TIMELINE_SEGS_UTC = [
  { start: 4,    end: 7,    bg: 'rgba(248,113,113,0.45)', labelKey: 'HOURS_SEG_DEAD' as LabelKey },
  { start: 7,    end: 10,   bg: 'rgba(122,184,245,0.55)', labelKey: 'HOURS_SEG_LONDON' as LabelKey },
  { start: 12,   end: 13.5, bg: 'rgba(148,163,184,0.45)', labelKey: 'HOURS_SEG_PRE_NY' as LabelKey },
  { start: 13.5, end: 18,   bg: 'rgba(96,165,250,0.55)',  labelKey: 'HOURS_SEG_NY' as LabelKey },
  { start: 18,   end: 21,   bg: 'rgba(125,224,164,0.70)', labelKey: 'HOURS_SEG_PRIME' as LabelKey },
  { start: 23,   end: 27,   bg: 'rgba(251,191,36,0.55)',  labelKey: 'HOURS_SEG_ASIA' as LabelKey },
];

/* Shift the UTC blocks onto the viewer's own 0-24 local axis. A block pushed
   past local midnight is split in two so it renders at both ends of the bar
   instead of overflowing off it. */
function localSegments(offsetHours: number) {
  const out: { start: number; end: number; bg: string; labelKey: LabelKey }[] = [];
  for (const seg of TIMELINE_SEGS_UTC) {
    let s = seg.start + offsetHours;
    let e = seg.end + offsetHours;
    while (s < 0)   { s += 24; e += 24; }
    while (s >= 24) { s -= 24; e -= 24; }
    if (e <= 24) out.push({ ...seg, start: s, end: e });
    else {
      out.push({ ...seg, start: s, end: 24 });
      out.push({ ...seg, start: 0, end: e - 24 });
    }
  }
  return out;
}

/* Each window's hours are DERIVED from the UTC anchors in lib/session.ts and
   formatted in the viewer's own timezone, instead of the pre-baked PHT strings
   these used to read out of the labels table ("Daily 2AM - 5AM PHT"). Those
   made every non-PHT trader read someone else's clock, and had drifted from
   the enforced logic besides - the London label claimed "9:30-11AM UTC" while
   isLondon() actually uses 07:00-10:00 UTC.
   utc: [startHour, startMin, endHour, endMin, utcDay?] matching session.ts. */
const WINDOWS: { cls: string; badgeKey: LabelKey; descKey: LabelKey; utc: [number, number, number, number, number?] }[] = [
  { cls: 'wp-god',    badgeKey: 'HOURS_WIN_GOD_BADGE'     as LabelKey, descKey: 'HOURS_WIN_GOD_DESC'     as LabelKey, utc: [15, 0, 19, 0, 0] },
  { cls: 'wp-prime',  badgeKey: 'HOURS_WIN_PRIME_BADGE'   as LabelKey, descKey: 'HOURS_WIN_PRIME_DESC'   as LabelKey, utc: [18, 0, 21, 0] },
  { cls: 'wp-prime',  badgeKey: 'HOURS_WIN_MON_EVE_BADGE' as LabelKey, descKey: 'HOURS_WIN_MON_EVE_DESC' as LabelKey, utc: [12, 0, 15, 0, 1] },
  { cls: 'wp-london', badgeKey: 'HOURS_WIN_LONDON_BADGE'  as LabelKey, descKey: 'HOURS_WIN_LONDON_DESC'  as LabelKey, utc: [7, 0, 10, 0] },
  { cls: 'wp-dead',   badgeKey: 'HOURS_WIN_DEAD_BADGE'    as LabelKey, descKey: 'HOURS_WIN_DEAD_DESC'    as LabelKey, utc: [4, 0, 7, 0] },
];

function pad(n: number) { return n < 10 ? '0' + n : '' + n; }

export default function BestHours() {
  const mode = useDesignMode();
  // This page is statically prerendered, so which session window is "active"
  // in the server HTML reflects whenever the last build ran, not real time.
  // Gate the win/dead-driven blocks below on `mounted` so the server render
  // and the client's first render agree on showing none of them, then swap
  // in the live state right after mount (client-only, nothing for hydration
  // to compare against).
  const { t } = useLabels();
  const [mounted, setMounted] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setMounted(true);
    const timer = setInterval(() => setTick(v => v + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  /* THE GROUND THE BANDS SIT ON, READ FROM THE LIVE STYLESHEET (#707).
     The band colours are translucent, so what the label has to contrast
     against is the band flattened onto the strip's own background - which is
     `--bg3`, and which has four different values across theme x design.

     Read rather than restated. Hardcoding those four values here would put the
     same fact in globals.css and in this file, and the two would part company
     the first time a palette moved - which is #736 and #663, both of which
     cost a public retraction this week. getComputedStyle sees whatever the
     cascade actually resolved, including any design mode added later.

     WATCHED, NOT SAMPLED ONCE. The first version read on mount and re-ran on
     `mode`, and it was WRONG in terminal - measured live, ASIA rendered white
     where the palette says black. React runs child effects before parent
     effects, so this page's effect fires BEFORE DesignModeProvider has put
     `data-design` on <html>: the read happens while the document is still
     current-design and returns #0f1115 instead of #111416. Close enough that
     it renders plausibly, wrong enough to pick the other colour on a band
     that is a 0.12 tie.

     So watch the attributes rather than guess when they settle - the same
     MutationObserver pattern GrokSignalChart uses, plus the `theme-change`
     event lib/theme.ts dispatches on an explicit toggle or a system change. */
  const [ground, setGround] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--bg3').trim();
      setGround(prev => (v && v !== prev ? v : prev));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true, attributeFilter: ['data-theme', 'data-design'],
    });
    window.addEventListener('theme-change', read);
    return () => {
      observer.disconnect();
      window.removeEventListener('theme-change', read);
    };
  }, []);

  const now = new Date();
  const pht = getLocalNow();
  const win = getCurrentWindow(pht);
  const dead = isDead(pht);
  const days = [t('HOURS_DAY_SUN'), t('HOURS_DAY_MON'), t('HOURS_DAY_TUE'), t('HOURS_DAY_WED'), t('HOURS_DAY_THU'), t('HOURS_DAY_FRI'), t('HOURS_DAY_SAT')];
  const months = [t('HOURS_MONTH_JAN'), t('HOURS_MONTH_FEB'), t('HOURS_MONTH_MAR'), t('HOURS_MONTH_APR'), t('HOURS_MONTH_MAY'), t('HOURS_MONTH_JUN'), t('HOURS_MONTH_JUL'), t('HOURS_MONTH_AUG'), t('HOURS_MONTH_SEP'), t('HOURS_MONTH_OCT'), t('HOURS_MONTH_NOV'), t('HOURS_MONTH_DEC')];
  const h = pht.getHours(), m = pht.getMinutes(), s = pht.getSeconds();
  const ampm = h >= 12 ? t('HOURS_PM') : t('HOURS_AM');
  const h12 = h % 12 || 12;

  const upcoming = (!win && !dead) ? getUpcomingWindows(now, 3) : [];

  return (
    <div className={mode === 'terminal' ? 'hours-term-wrap' : undefined}>
      <div style={{ padding: '1rem 0 0.5rem' }}>
        <h1 style={{ fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>{t('HOURS_TITLE')}</h1>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 14 }}>{t('HOURS_SUBTITLE')}</div>
      </div>

      <SessionCountdown />

      <div className="card" style={{ textAlign: 'center', marginBottom: 14 }}>
        <div suppressHydrationWarning style={{ fontSize: '2.25rem', fontWeight: 700, fontFamily: 'monospace', color: 'var(--txt)', letterSpacing: -1 }}>
          {pad(h12)}:{pad(m)}:{pad(s)}
          {/* The clock has always shown the VIEWER'S own time (getLocalNow() is
              just new Date()), but the label said "PHT" - so a trader in London
              read "09:00 AM PHT" for their 9am. Show the real zone instead. */}
          <span suppressHydrationWarning style={{ fontSize: 'var(--fs-body)', color: 'var(--txt3)', marginLeft: 8 }}>{ampm} {localZoneAbbr()}</span>
        </div>
        <div suppressHydrationWarning style={{ fontSize: 'var(--fs-label)', color: 'var(--txt3)', marginTop: 4 }}>
          {days[pht.getDay()]}, {months[pht.getMonth()]} {pht.getDate()} {pht.getFullYear()}
        </div>

        <div style={{ marginTop: 12 }}>
          {mounted && (win ? (
            <div className="window-pill" style={{ background: win.bg, color: win.color, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 1.5C10.4 5.2 11.8 6.6 15.5 7 11.8 7.4 10.4 8.8 10 12.5 9.6 8.8 8.2 7.4 4.5 7 8.2 6.6 9.6 5.2 10 1.5Z" fill="currentColor" /></svg>
              {t('HOURS_WINDOW_ACTIVE_NOW', { name: win.name })}
            </div>
          ) : dead ? (
            <div className="window-pill wp-dead" style={{ display: 'inline-block' }}>{t('HOURS_DEAD_ZONE_MSG')}</div>
          ) : (
            <div className="window-pill wp-other" style={{ display: 'inline-block' }}>{t('HOURS_OUTSIDE_PRIME')}</div>
          ))}
        </div>
      </div>

      {/* 24h timeline */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="lbl" style={{ marginBottom: 10 }}>
          <Tip width={260} text={t('HOURS_SESSION_MAP_TIP')}>{t('HOURS_SESSION_MAP_TITLE')}</Tip>
          <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 400, color: 'var(--txt3)', marginLeft: 6 }}>{t('HOURS_SESSION_MAP_SUBTITLE')}</span>
        </div>

        {/* Bar + needle wrapper - overflow visible so needle tip shows */}
        {/* dir="ltr": a QUANTITATIVE AXIS DOES NOT MIRROR (#353).
             Arabic text reads right-to-left; a 24-hour TIME axis does not.
             Flipping it puts every session bar at an hour it does not mean -
             rendering perfectly and lying. Covers the bar, its marker and its
             label together: they are three layers of one axis and any
             treatment applied to fewer than all three separates them. */}
        <div dir="ltr" style={{ position: 'relative', marginBottom: 6 }}>
          {/* Segment strips */}
          <div style={{ position: 'relative', height: 44, borderRadius: 8, background: 'var(--bg3)', overflow: 'hidden' }}>
            {/* Client-only: the viewer's UTC offset both shifts the blocks and can
                split one in two, so the server (always UTC) and the client would
                render a different NUMBER of children - a structural hydration
                mismatch, not just a differing attribute. Gate on `mounted` and
                let the bar's background show for the first paint. */}
            {mounted && localSegments(-new Date().getTimezoneOffset() / 60).map((seg, i) => {
              const left  = (seg.start / 24) * 100;
              const width = ((seg.end - seg.start) / 24) * 100;
              /* Derived, never tabulated - see lib/readableOn.ts. `ground` is
                 null only on the first client frame, before the effect has
                 read it; --txt for that one frame is the pre-#707 behaviour,
                 which is legible in light and imperfect in dark rather than
                 wrong in both. */
              const pick = ground ? readableOn(seg.bg, ground) : null;
              return (
                <div key={i} style={{
                  position: 'absolute', top: 0, bottom: 0,
                  left: `${left}%`, width: `${width}%`,
                  background: seg.bg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {/* PER BAND, DERIVED (#707, owner ruling). Two single-colour
                      answers were tried here and both failed on one theme:

                        '#fff'      fails all six bands in light  1.43 - 1.78
                        var(--txt)  fails three bands in dark     2.33 - 4.42

                      My own note in this spot claimed --txt was "measured" -
                      the five numbers it quoted were light theme only, and it
                      read as covering both. That is what shipped the dark
                      regression, so the numbers below name their ground.

                      Black or white, whichever wins on the flattened band.
                      Every band clears 4.5 in all four theme x design
                      combinations:

                        band     cur dark      cur light   term dark     term light
                        DEAD     white 8.34    black 11.57 white 8.17    black 11.28
                        LONDON   white 5.42    black 12.66 white 5.33    black 12.37
                        PRE_NY   white 7.81    black 12.43 white 7.63    black 12.10
                        NY       white 6.23    black 11.43 white 6.12    black 11.15
                        PRIME    black 6.89    black 13.97 black 6.96    black 13.77
                        ASIA     white 4.60    black 14.10 black 4.64    black 13.84

                      ASIA is a near-tie in dark - 4.57 black against 4.60
                      white in the current design, and the other way round in
                      terminal - so the derived answer differs by design on
                      that one band. Both clear, and forcing agreement would
                      mean a tiebreak rule that is a table by another name.

                      THE 0.9 FADE IS GONE, and that is required rather than
                      tidying: with it, ASIA in dark fails BOTH ways (black
                      4.27, white 4.07). No colour clears that band through
                      the fade, so the fade had to be the thing that moved. */}
                  {width > 7 && (
                    <span style={{
                      fontSize: 'var(--fs-caption)', fontWeight: 700, letterSpacing: '.04em',
                      color: pick ? pick.color : 'var(--txt)',
                    }}>
                      {t(seg.labelKey)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* "You are here" needle - outside overflow:hidden so the arrow tip shows */}
          {(() => {
            const pct = ((h + m / 60) / 24) * 100;
            return (
              <>
                <div style={{
                  position: 'absolute', top: -6, height: 56,
                  left: `${pct}%`, width: 2,
                  background: 'var(--accent-solid)',
                  borderRadius: 2,
                  transform: 'translateX(-1px)',
                  boxShadow: '0 0 6px var(--accent)',
                  zIndex: 10,
                  pointerEvents: 'none',
                }} />
                <div style={{
                  position: 'absolute', top: -16,
                  left: `${pct}%`,
                  transform: 'translateX(-50%)',
                  fontSize: '0.625rem', color: 'var(--accent)', lineHeight: 1,
                  pointerEvents: 'none',
                }}>▼</div>
              </>
            );
          })()}
        </div>

        {/* Hour ticks */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          {[0, 3, 6, 9, 12, 15, 18, 21, 24].map(hr => (
            <span key={hr} style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', fontVariantNumeric: 'tabular-nums' }}>
              {hr === 0 || hr === 24 ? t('HOURS_TICK_MIDNIGHT') : hr === 12 ? t('HOURS_TICK_NOON') : hr < 12 ? t('HOURS_TICK_AM', { hr }) : t('HOURS_TICK_PM', { hr: hr - 12 })}
            </span>
          ))}
        </div>

        {/* Current position label */}
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', textAlign: 'center' }}>
          {t('HOURS_NOW_PREFIX')}<span suppressHydrationWarning style={{ color: 'var(--txt2)', fontWeight: 600 }}>{pad(h12)}:{pad(m)} {ampm} {localZoneAbbr()}</span>
          {mounted && win && <span className="hours-now-win" style={{ marginLeft: 8, color: win.color, fontWeight: 600 }}>{t('HOURS_DOT_SEPARATOR')} {win.name}</span>}
          {mounted && dead && <span style={{ marginLeft: 8, color: 'var(--red)', fontWeight: 600 }}>{t('HOURS_DOT_DEAD_ZONE')}</span>}
        </div>
      </div>

      {/* Active or upcoming */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="lbl">{t('HOURS_NEXT_WINDOWS')}</div>
        {mounted && (win ? (
          <div className="nw-row" style={{ marginBottom: 0 }}>
            <div>
              <div className="nw-name" style={{ color: win.color, display: 'flex', alignItems: 'center', gap: 5 }}>
                <svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 1.5C10.4 5.2 11.8 6.6 15.5 7 11.8 7.4 10.4 8.8 10 12.5 9.6 8.8 8.2 7.4 4.5 7 8.2 6.6 9.6 5.2 10 1.5Z" fill="currentColor" /></svg>
                {t('HOURS_WINDOW_ACTIVE_RIGHT_NOW', { name: win.name })}
              </div>
              <div className="nw-time">{win.label}</div>
            </div>
            <div className="nw-countdown" style={{ color: win.color }}>{t('HOURS_GO_HUNT')}</div>
          </div>
        ) : upcoming.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {upcoming.map((u, i) => (
              <div key={i} className="nw-row">
                <div>
                  <div className="nw-name" style={{ color: u.win.color }}>{u.win.name}</div>
                  <div className="nw-time">{u.win.label}</div>
                </div>
                <div className="nw-countdown" style={{ color: u.win.color }}>{u.countdown}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('HOURS_NO_WINDOWS')}</div>
        ))}
      </div>

      {/* Window descriptions */}
      <div className="dash-section">{t('HOURS_ALL_WINDOWS')}</div>
      {WINDOWS.map((w, i) => (
        <div key={i} className="card" style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div className={`window-pill ${w.cls}`}>{t(w.badgeKey)}</div>
            {/* Client-only: formatting depends on the viewer's timezone, which the
                prerendered HTML (always UTC) would get wrong. */}
            <div suppressHydrationWarning style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>
              {mounted ? utcWindowToLocalRange(...w.utc) : ''}
            </div>
          </div>
          <div style={{ fontSize: 'var(--fs-label)', color: 'var(--txt2)', lineHeight: 1.6 }}>{t(w.descKey)}</div>
        </div>
      ))}
    </div>
  );
}
