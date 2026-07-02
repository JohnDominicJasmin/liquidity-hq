'use client';
import { useState, useEffect, useMemo } from 'react';
import { getCurrentWindow, isDead } from '@/lib/session';

/* ── helpers ── */
function pad(n: number) { return String(n).padStart(2, '0'); }

function fmtMs(ms: number): string {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(sec)}s`;
  if (m > 0) return `${m}m ${pad(sec)}s`;
  return `${sec}s`;
}

function findNextSession(nowMs: number) {
  const limit = nowMs + 8 * 24 * 3600_000;
  for (let t = nowMs + 60_000; t < limit; t += 60_000) {
    const w = getCurrentWindow(new Date(t));
    if (w) return { win: w, startsInMs: t - nowMs };
  }
  return null;
}

function findSessionEndMs(nowMs: number, name: string): number {
  for (let t = nowMs + 60_000; t < nowMs + 6 * 3600_000; t += 60_000) {
    const w = getCurrentWindow(new Date(t));
    if (!w || w.name !== name) return t - nowMs;
  }
  return 6 * 3600_000;
}

/* ── component ── */
export default function SessionContext() {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Session ──────────────────────────────────────────────────
  const { current, dead, next, endsInMs, nextInMs } = useMemo(() => {
    const now     = new Date(nowMs);
    const current = getCurrentWindow(now);
    const dead    = isDead(now);
    const next    = findNextSession(nowMs);
    const endsInMs = current ? findSessionEndMs(nowMs, current.name) : 0;
    const nextInMs = next?.startsInMs ?? 0;
    return { current, dead, next, endsInMs, nextInMs };
  }, [nowMs]);

  const statusCol = current?.color ?? (dead ? '#f87171' : '#48484a');
  const statusBg  = current?.bg    ?? (dead ? 'rgba(248,113,113,0.08)' : 'transparent');

  // ── FR Settlement countdown ───────────────────────────────────
  const frCountdown = (() => {
    const now = new Date(nowMs);
    const h   = now.getUTCHours();
    let nextH = h < 8 ? 8 : h < 16 ? 16 : 24;
    const next = new Date(now);
    next.setUTCHours(nextH % 24, 0, 0, 0);
    if (nextH === 24) next.setUTCDate(next.getUTCDate() + 1);
    const diff = next.getTime() - now.getTime();
    const hh = Math.floor(diff / 3_600_000);
    const mm = Math.floor((diff % 3_600_000) / 60_000);
    const ss = Math.floor((diff % 60_000) / 1_000);
    return `${hh}h ${pad(mm)}m ${pad(ss)}s`;
  })();

  // ── Weekly options expiry (next Friday 08:00 UTC) ─────────────
  const { weeklyLabel, isWeeklyToday } = (() => {
    const now = new Date(nowMs);
    const day = now.getUTCDay();
    let daysUntil = (5 - day + 7) % 7;
    if (daysUntil === 0 && now.getUTCHours() >= 8) daysUntil = 7;
    const next = new Date(now);
    next.setUTCDate(now.getUTCDate() + daysUntil);
    return {
      weeklyLabel: daysUntil === 0
        ? 'Today'
        : next.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      isWeeklyToday: daysUntil === 0,
    };
  })();

  // ── Monthly expiry (last Friday of month) ────────────────────
  const monthlyLabel = (() => {
    const now = new Date(nowMs);
    const yr  = now.getUTCFullYear();
    const mo  = now.getUTCMonth();
    const lastDay = new Date(Date.UTC(yr, mo + 1, 0));
    while (lastDay.getUTCDay() !== 5) lastDay.setUTCDate(lastDay.getUTCDate() - 1);
    if (lastDay.getTime() <= now.getTime()) {
      const nxt = new Date(Date.UTC(yr, mo + 2, 0));
      while (nxt.getUTCDay() !== 5) nxt.setUTCDate(nxt.getUTCDate() - 1);
      return nxt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    }
    return lastDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  })();

  return (
    <div className="sctx-wrap">

      {/* Row 1 — session window status */}
      <div className="sctx-session-row">
        <div
          className="sc-badge"
          style={{ color: statusCol, background: statusBg, borderColor: statusCol + '44' }}
        >
          {current
            ? current.name.toUpperCase()
            : dead ? 'Dead zone' : 'Off-peak'}
        </div>

        {current ? (
          <span suppressHydrationWarning className="sctx-timing">
            Ends in{' '}
            <strong style={{ color: current.color }}>{fmtMs(endsInMs)}</strong>
          </span>
        ) : dead ? (
          <span className="sctx-note">Stay out — no follow-through</span>
        ) : (
          <span className="sctx-note">No high-probability window active</span>
        )}

        {next && (
          <>
            <span className="sctx-dot">·</span>
            <span suppressHydrationWarning className="sctx-timing">
              Next{' '}
              <strong style={{ color: next.win.color }}>{next.win.name}</strong>
              {' '}in {fmtMs(nextInMs)}
            </span>
          </>
        )}
      </div>

      {/* Divider */}
      <div className="sctx-divider" />

      {/* Row 2 — settlement & expiry clocks */}
      <div className="sctx-events-row">
        <div className="sctx-evt">
          <span className="sctx-evt-label">FR settlement</span>
          <span className="sctx-evt-value sctx-mono" suppressHydrationWarning>{frCountdown}</span>
        </div>
        <div className="sctx-evt-sep" />
        <div className="sctx-evt">
          <span className="sctx-evt-label">Weekly expiry</span>
          <span suppressHydrationWarning className={`sctx-evt-value${isWeeklyToday ? ' sctx-hot' : ''}`}>
            {weeklyLabel}
          </span>
        </div>
        <div className="sctx-evt-sep" />
        <div className="sctx-evt">
          <span className="sctx-evt-label">Monthly expiry</span>
          <span suppressHydrationWarning className="sctx-evt-value">{monthlyLabel}</span>
        </div>
      </div>

    </div>
  );
}
