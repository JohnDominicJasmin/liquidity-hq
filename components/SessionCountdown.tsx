'use client';
import { useState, useEffect, useMemo } from 'react';
import { getCurrentWindow, isDead, getActiveHolidays, type Window as SessionWindow } from '@/lib/session';

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

/* Scan forward (1-min steps) to find next session boundary - fast enough (<1ms).
   Skips the currently-active window so "Next" is never the session already running. */
function findNextSession(nowMs: number, currentName?: string): { win: SessionWindow; startsInMs: number } | null {
  const limit = nowMs + 8 * 24 * 3600_000;
  let leftCurrent = !currentName;
  for (let t = nowMs + 60_000; t < limit; t += 60_000) {
    const w = getCurrentWindow(new Date(t));
    if (!leftCurrent) {
      if (w && w.name !== currentName) return { win: w, startsInMs: t - nowMs };
      if (!w) leftCurrent = true;
      continue;
    }
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
export default function SessionCountdown() {
  // This page is statically prerendered, so "which session is active" in the
  // server HTML reflects whenever the last build ran, not the real current
  // time - sessions change several times a day, so that snapshot is stale
  // almost immediately. Gating the current/dead/next/holiday blocks on
  // `mounted` makes the server render (and the client's first render, before
  // this effect runs) agree on rendering none of them, then swaps in the
  // real, live state right after mount - a client-only update, so there's
  // nothing for hydration to compare. suppressHydrationWarning (used
  // elsewhere in this file) only covers text content, not whether an
  // element exists at all, so it can't fix this class of mismatch.
  const [mounted, setMounted] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setMounted(true);
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const { current, dead, next, endsInMs, nextInMs, holidays } = useMemo(() => {
    const now      = new Date(nowMs);
    const current  = getCurrentWindow(now);
    const dead     = isDead(now);
    const next     = findNextSession(nowMs, current?.name);
    const endsInMs = current ? findSessionEndMs(nowMs, current.name) : 0;
    const nextInMs = next?.startsInMs ?? 0;
    const holidays = getActiveHolidays(now);
    return { current, dead, next, endsInMs, nextInMs, holidays };
  }, [nowMs]);

  /* colours */
  const statusCol = current?.color ?? (dead ? '#f87171' : '#48484a');
  const statusBg  = current?.bg    ?? (dead ? 'rgba(248,113,113,0.08)' : 'transparent');

  return (
    <div className="sc-wrap">

      {/* Row 1 - active session or status */}
      <div className="sc-row-main">
        <div suppressHydrationWarning className="sc-badge" style={{ color: statusCol, background: statusBg, borderColor: statusCol + '44' }}>
          {current
            ? current.name.toUpperCase()
            : dead ? 'DEAD ZONE' : 'OFF-PEAK'}
        </div>

        {mounted && current && (
          <div className="sc-timer-block">
            <span className="sc-timer-label">currently open - closes in</span>
            <span suppressHydrationWarning className="sc-timer" style={{ color: current.color }}>
              {fmtMs(endsInMs)}
            </span>
          </div>
        )}

        {mounted && !current && dead && (
          <span className="sc-note">Stay out - no follow-through</span>
        )}

        {mounted && !current && !dead && (
          <span className="sc-note">No high-probability window active</span>
        )}
      </div>

      {/* Row 2 - next session countdown */}
      {mounted && next && (
        <div className="sc-row-next">
          <span className="sc-next-label">Next</span>
          <span suppressHydrationWarning className="sc-next-name" style={{ color: next.win.color }}>
            {next.win.name}
          </span>
          <span className="sc-next-sep">opens in</span>
          <span suppressHydrationWarning className="sc-next-timer">{fmtMs(nextInMs)}</span>
        </div>
      )}

      {/* Row 3 - active market holidays (NY/London/Asia/China) - reduced liquidity heads-up */}
      {mounted && holidays.length > 0 && (
        <div className="sc-row-next" style={{ marginTop: 4 }}>
          <span className="sc-next-label" style={{ color: '#fbbf24' }}>Holiday</span>
          <span suppressHydrationWarning style={{ fontSize: 11, color: 'var(--txt2)' }}>
            {holidays.map(h => `${h.region} closed - ${h.name}`).join(' · ')}
          </span>
        </div>
      )}

    </div>
  );
}
