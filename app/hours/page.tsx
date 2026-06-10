'use client';
import { useState, useEffect } from 'react';
import { getPHT, getCurrentWindow, isDead, getUpcomingWindows } from '@/lib/session';
import SessionCountdown from '@/components/SessionCountdown';

/* Typical-weekday session blocks on a 24h PHT axis */
const TIMELINE_SEGS = [
  { start: 0,    end: 2,    bg: 'rgba(96,165,250,0.55)',  label: 'NY' },
  { start: 2,    end: 5,    bg: 'rgba(125,224,164,0.70)', label: 'PRIME' },
  { start: 7,    end: 11,   bg: 'rgba(251,191,36,0.55)',  label: 'ASIA' },
  { start: 12,   end: 15,   bg: 'rgba(248,113,113,0.45)', label: 'DEAD' },
  { start: 15,   end: 18,   bg: 'rgba(122,184,245,0.55)', label: 'LONDON' },
  { start: 20,   end: 21.5, bg: 'rgba(148,163,184,0.45)', label: 'PRE-NY' },
  { start: 21.5, end: 24,   bg: 'rgba(96,165,250,0.55)',  label: 'NY' },
];

const WINDOWS = [
  { cls: 'wp-god', badge: '👑 GOD TIER', time: 'Sunday 11PM – Monday 3AM PHT', desc: 'Lowest volume of the week. Retail asleep globally. Minimum capital needed to move price. Highest probability of violent raids. Maximum priority.' },
  { cls: 'wp-prime', badge: '⚡ PRIME', time: 'Daily 2AM – 5AM PHT', desc: 'Asia/Europe overlap. High institutional activity. Volume picks up. Best daily window for clean setups. 4:00–4:45AM PHT is the single most consistent reversal sub-window.' },
  { cls: 'wp-prime', badge: '🔥 MON EVENING', time: 'Monday 8PM – 11PM PHT', desc: 'Weekly liquidity build-up complete. US session active. Strong trend continuation or violent reversal setups. High probability of 3-5% moves.' },
  { cls: 'wp-london', badge: '🌍 LONDON OPEN', time: '3PM – 6PM PHT (9:30–11AM UTC)', desc: 'European institutions enter. Volume spike. Almost always a fake move first to trap early entries, then real direction emerges. Never trade the first 15 minutes.' },
  { cls: 'wp-dead', badge: '💀 DEAD ZONE', time: '12PM – 3PM PHT', desc: 'Do not trade. US pre-market, Europe lunch, Asia sleeping. Fake moves, tight spreads, no follow-through. Highest probability of stopping out on noise.' },
];

function pad(n: number) { return n < 10 ? '0' + n : '' + n; }

export default function BestHours() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(v => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const now = new Date();
  const pht = getPHT();
  const win = getCurrentWindow(pht);
  const dead = isDead(pht);
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const h = pht.getHours(), m = pht.getMinutes(), s = pht.getSeconds();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;

  const upcoming = (!win && !dead) ? getUpcomingWindows(now, 3) : [];

  return (
    <div>
      <div style={{ padding: '1rem 0 0.5rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#e8e8e8', marginBottom: 2 }}>Best Hours</div>
        <div style={{ fontSize: 12, color: '#606060', marginBottom: 14 }}>Live PHT clock + session window detector</div>
      </div>

      <SessionCountdown />

      <div className="card" style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 36, fontWeight: 700, fontFamily: 'monospace', color: '#e8e8e8', letterSpacing: -1 }}>
          {pad(h12)}:{pad(m)}:{pad(s)}
          <span style={{ fontSize: 14, color: '#606060', marginLeft: 8 }}>{ampm} PHT</span>
        </div>
        <div style={{ fontSize: 13, color: '#606060', marginTop: 4 }}>
          {days[pht.getDay()]}, {months[pht.getMonth()]} {pht.getDate()} {pht.getFullYear()}
        </div>

        <div style={{ marginTop: 12 }}>
          {win ? (
            <div className="window-pill" style={{ background: win.bg, color: win.color, display: 'inline-block' }}>
              ✦ {win.name} — Active now
            </div>
          ) : dead ? (
            <div className="window-pill wp-dead" style={{ display: 'inline-block' }}>⚠ Dead zone — do not trade</div>
          ) : (
            <div className="window-pill wp-other" style={{ display: 'inline-block' }}>◆ Outside prime windows</div>
          )}
        </div>
      </div>

      {/* 24h timeline */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="lbl" style={{ marginBottom: 10 }}>
          24h Session Map
          <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--txt3)', marginLeft: 6 }}>PHT · typical weekday</span>
        </div>

        {/* Bar + needle wrapper — overflow visible so needle tip shows */}
        <div style={{ position: 'relative', marginBottom: 6 }}>
          {/* Segment strips */}
          <div style={{ position: 'relative', height: 44, borderRadius: 8, background: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}>
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
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#fff', letterSpacing: '.04em', opacity: 0.9 }}>
                      {seg.label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* "You are here" needle — outside overflow:hidden so the arrow tip shows */}
          {(() => {
            const pct = ((h + m / 60) / 24) * 100;
            return (
              <>
                <div style={{
                  position: 'absolute', top: -6, height: 56,
                  left: `${pct}%`, width: 2,
                  background: 'rgba(255,255,255,0.95)',
                  borderRadius: 2,
                  transform: 'translateX(-1px)',
                  boxShadow: '0 0 8px rgba(255,255,255,0.6)',
                  zIndex: 10,
                  pointerEvents: 'none',
                }} />
                <div style={{
                  position: 'absolute', top: -16,
                  left: `${pct}%`,
                  transform: 'translateX(-50%)',
                  fontSize: 10, color: '#fff', lineHeight: 1,
                  pointerEvents: 'none',
                }}>▼</div>
              </>
            );
          })()}
        </div>

        {/* Hour ticks */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          {[0, 3, 6, 9, 12, 15, 18, 21, 24].map(hr => (
            <span key={hr} style={{ fontSize: 9, color: 'var(--txt3)', fontVariantNumeric: 'tabular-nums' }}>
              {hr === 0 || hr === 24 ? '12A' : hr === 12 ? '12P' : hr < 12 ? `${hr}A` : `${hr - 12}P`}
            </span>
          ))}
        </div>

        {/* Current position label */}
        <div style={{ fontSize: 11, color: 'var(--txt3)', textAlign: 'center' }}>
          ▲ now: <span style={{ color: 'var(--txt2)', fontWeight: 600 }}>{pad(h12)}:{pad(m)} {ampm} PHT</span>
          {win && <span style={{ marginLeft: 8, color: win.color, fontWeight: 600 }}>· {win.name}</span>}
          {dead && <span style={{ marginLeft: 8, color: '#f87171', fontWeight: 600 }}>· Dead Zone</span>}
        </div>
      </div>

      {/* Active or upcoming */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="lbl">Next windows</div>
        {win ? (
          <div className="nw-row" style={{ marginBottom: 0 }}>
            <div>
              <div className="nw-name" style={{ color: win.color }}>✦ {win.name} is active RIGHT NOW</div>
              <div className="nw-time">{win.label}</div>
            </div>
            <div className="nw-countdown" style={{ color: win.color }}>Go hunt.</div>
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
          <div style={{ fontSize: 12, color: '#606060' }}>No windows detected in next 7 days</div>
        )}
      </div>

      {/* Window descriptions */}
      <div className="dash-section">All windows</div>
      {WINDOWS.map((w, i) => (
        <div key={i} className="card" style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div className={`window-pill ${w.cls}`}>{w.badge}</div>
            <div style={{ fontSize: 11, color: '#606060' }}>{w.time}</div>
          </div>
          <div style={{ fontSize: 13, color: '#a0a0a0', lineHeight: 1.6 }}>{w.desc}</div>
        </div>
      ))}
    </div>
  );
}
