'use client';
import { useState, useEffect, useMemo } from 'react';

function pad(n: number) { return String(n).padStart(2, '0'); }

export default function SessionContext() {
  const [mounted, setMounted] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setMounted(true);
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const { frCountdown, weeklyLabel, isWeeklyToday, monthlyLabel } = useMemo(() => {
    const now = new Date(nowMs);

    // FR Settlement (00:00, 08:00, 16:00 UTC)
    const h = now.getUTCHours();
    let nextH = h < 8 ? 8 : h < 16 ? 16 : 24;
    const nextFR = new Date(now);
    nextFR.setUTCHours(nextH % 24, 0, 0, 0);
    if (nextH === 24) nextFR.setUTCDate(nextFR.getUTCDate() + 1);
    const frDiff = nextFR.getTime() - now.getTime();
    const frH = Math.floor(frDiff / 3_600_000);
    const frM = Math.floor((frDiff % 3_600_000) / 60_000);
    const frS = Math.floor((frDiff % 60_000) / 1_000);
    const frCountdown = `${frH}h ${pad(frM)}m ${pad(frS)}s`;

    // Weekly options expiry (next Friday 08:00 UTC)
    const day = now.getUTCDay();
    let daysUntil = (5 - day + 7) % 7;
    if (daysUntil === 0 && now.getUTCHours() >= 8) daysUntil = 7;
    const nextWeekly = new Date(now);
    nextWeekly.setUTCDate(now.getUTCDate() + daysUntil);
    const weeklyLabel = daysUntil === 0
      ? 'Today'
      : nextWeekly.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const isWeeklyToday = daysUntil === 0;

    // Monthly expiry (last Friday of month)
    const yr = now.getUTCFullYear();
    const mo = now.getUTCMonth();
    const lastDay = new Date(Date.UTC(yr, mo + 1, 0));
    while (lastDay.getUTCDay() !== 5) lastDay.setUTCDate(lastDay.getUTCDate() - 1);
    let monthlyLabel: string;
    if (lastDay.getTime() <= now.getTime()) {
      const nxt = new Date(Date.UTC(yr, mo + 2, 0));
      while (nxt.getUTCDay() !== 5) nxt.setUTCDate(nxt.getUTCDate() - 1);
      monthlyLabel = nxt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    } else {
      monthlyLabel = lastDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    }

    return { frCountdown, weeklyLabel, isWeeklyToday, monthlyLabel };
  }, [nowMs]);

  if (!mounted) return null;

  return (
    <div className="sc-wrap" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
      <div className="sctx-divider" />
      <div className="sctx-events-row">
        <div className="sctx-evt">
          <span className="sctx-evt-label">FR settlement</span>
          <span suppressHydrationWarning className="sctx-evt-value sctx-mono">{frCountdown}</span>
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
