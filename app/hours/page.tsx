'use client';
import { useState, useEffect } from 'react';
import { getPHT, getCurrentWindow, isDead, getUpcomingWindows } from '@/lib/session';
import SessionCountdown from '@/components/SessionCountdown';

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
