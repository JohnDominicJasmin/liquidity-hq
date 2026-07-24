'use client';
import { useState, useEffect } from 'react';
import { getLocalNow, getCurrentWindow, isDead, getUpcomingWindows } from '@/lib/session';
import SessionCountdown from '@/components/SessionCountdown';
import Tip from '@/components/Tip';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';

/* Typical-weekday session blocks on a 24h PHT axis */
const TIMELINE_SEGS = [
  { start: 0,    end: 2,    bg: 'rgba(96,165,250,0.55)',  labelKey: 'HOURS_SEG_NY' as LabelKey },
  { start: 2,    end: 5,    bg: 'rgba(125,224,164,0.70)', labelKey: 'HOURS_SEG_PRIME' as LabelKey },
  { start: 7,    end: 11,   bg: 'rgba(251,191,36,0.55)',  labelKey: 'HOURS_SEG_ASIA' as LabelKey },
  { start: 12,   end: 15,   bg: 'rgba(248,113,113,0.45)', labelKey: 'HOURS_SEG_DEAD' as LabelKey },
  { start: 15,   end: 18,   bg: 'rgba(122,184,245,0.55)', labelKey: 'HOURS_SEG_LONDON' as LabelKey },
  { start: 20,   end: 21.5, bg: 'rgba(148,163,184,0.45)', labelKey: 'HOURS_SEG_PRE_NY' as LabelKey },
  { start: 21.5, end: 24,   bg: 'rgba(96,165,250,0.55)',  labelKey: 'HOURS_SEG_NY' as LabelKey },
];

const WINDOWS = [
  { cls: 'wp-god', badgeKey: 'HOURS_WIN_GOD_BADGE' as LabelKey, timeKey: 'HOURS_WIN_GOD_TIME' as LabelKey, descKey: 'HOURS_WIN_GOD_DESC' as LabelKey },
  { cls: 'wp-prime', badgeKey: 'HOURS_WIN_PRIME_BADGE' as LabelKey, timeKey: 'HOURS_WIN_PRIME_TIME' as LabelKey, descKey: 'HOURS_WIN_PRIME_DESC' as LabelKey },
  { cls: 'wp-prime', badgeKey: 'HOURS_WIN_MON_EVE_BADGE' as LabelKey, timeKey: 'HOURS_WIN_MON_EVE_TIME' as LabelKey, descKey: 'HOURS_WIN_MON_EVE_DESC' as LabelKey },
  { cls: 'wp-london', badgeKey: 'HOURS_WIN_LONDON_BADGE' as LabelKey, timeKey: 'HOURS_WIN_LONDON_TIME' as LabelKey, descKey: 'HOURS_WIN_LONDON_DESC' as LabelKey },
  { cls: 'wp-dead', badgeKey: 'HOURS_WIN_DEAD_BADGE' as LabelKey, timeKey: 'HOURS_WIN_DEAD_TIME' as LabelKey, descKey: 'HOURS_WIN_DEAD_DESC' as LabelKey },
];

function pad(n: number) { return n < 10 ? '0' + n : '' + n; }

export default function BestHours() {
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
    <div>
      <div style={{ padding: '1rem 0 0.5rem' }}>
        <h1 style={{ fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>{t('HOURS_TITLE')}</h1>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 14 }}>{t('HOURS_SUBTITLE')}</div>
      </div>

      <SessionCountdown />

      <div className="card" style={{ textAlign: 'center', marginBottom: 14 }}>
        <div suppressHydrationWarning style={{ fontSize: '2.25rem', fontWeight: 700, fontFamily: 'monospace', color: 'var(--txt)', letterSpacing: -1 }}>
          {pad(h12)}:{pad(m)}:{pad(s)}
          <span style={{ fontSize: 'var(--fs-body)', color: 'var(--txt3)', marginLeft: 8 }}>{t('HOURS_AMPM_PHT', { ampm })}</span>
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
        <div style={{ position: 'relative', marginBottom: 6 }}>
          {/* Segment strips */}
          <div style={{ position: 'relative', height: 44, borderRadius: 8, background: 'var(--bg3)', overflow: 'hidden' }}>
            {TIMELINE_SEGS.map((seg, i) => {
              const left  = (seg.start / 24) * 100;
              const width = ((seg.end - seg.start) / 24) * 100;
              return (
                <div key={i} style={{
                  position: 'absolute', top: 0, bottom: 0,
                  left: `${left}%`, width: `${width}%`,
                  background: seg.bg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {width > 7 && (
                    <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: '#fff', letterSpacing: '.04em', opacity: 0.9 }}>
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
                  background: 'var(--accent)',
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
          {t('HOURS_NOW_PREFIX')}<span style={{ color: 'var(--txt2)', fontWeight: 600 }}>{t('HOURS_NOW_TIME', { time: `${pad(h12)}:${pad(m)}`, ampm })}</span>
          {mounted && win && <span style={{ marginLeft: 8, color: win.color, fontWeight: 600 }}>{t('HOURS_DOT_SEPARATOR')} {win.name}</span>}
          {mounted && dead && <span style={{ marginLeft: 8, color: '#f87171', fontWeight: 600 }}>{t('HOURS_DOT_DEAD_ZONE')}</span>}
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
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t(w.timeKey)}</div>
          </div>
          <div style={{ fontSize: 'var(--fs-label)', color: 'var(--txt2)', lineHeight: 1.6 }}>{t(w.descKey)}</div>
        </div>
      ))}
    </div>
  );
}
