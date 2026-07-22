'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useGrokUsage } from '@/components/GrokUsageProvider';

// Daily AI quotas reset at midnight UTC (server-side fact - see lib/resetTime.ts
// and the /api/grok limits). Live countdown so the "you're running low, it won't
// refill for hours" pressure is visible, not silent.
function msToNextUtcMidnight(now: number): number {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0);
  return next - now;
}
function fmtCountdown(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Visible usage meter under the Arena AI buttons: remaining Quick/Deep for the
// day + a live reset countdown. Visible scarcity converts far better than a
// silently-disabled button (freemium plan, move #3).
export default function UsageMeter() {
  const { user, isPro } = useAuth();
  const { usage } = useGrokUsage();
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setMs(msToNextUtcMidnight(Date.now()));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  if (!user || !usage) return null;

  const quickLeft = Math.max(0, usage.quick_limit - usage.quick_used);
  const deepLeft  = Math.max(0, usage.deep_limit  - usage.deep_used);
  const col = (left: number) => left === 0 ? 'var(--red)' : left <= 1 ? 'var(--amber)' : 'var(--txt)';

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        margin: '2px 0 10px', padding: '7px 12px',
        borderRadius: 10, border: '0.5px solid var(--bdr)', background: 'var(--bg2)',
        fontSize: 'var(--fs-caption)', color: 'var(--txt2)',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <span>
        Quick <b style={{ color: col(quickLeft), fontWeight: 700 }}>{quickLeft}</b>
        <span style={{ color: 'var(--txt3)' }}>/{usage.quick_limit} left</span>
      </span>
      <span style={{ color: 'var(--bdr2)' }}>·</span>
      <span>
        Deep <b style={{ color: col(deepLeft), fontWeight: 700 }}>{deepLeft}</b>
        <span style={{ color: 'var(--txt3)' }}>/{usage.deep_limit} left</span>
      </span>
      {ms != null && (
        <>
          <span style={{ color: 'var(--bdr2)' }}>·</span>
          <span style={{ color: 'var(--txt3)' }}>resets in {fmtCountdown(ms)}</span>
        </>
      )}
      {!isPro && (
        <Link href="/upgrade" style={{ marginLeft: 'auto', color: 'var(--accent)', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          Upgrade →
        </Link>
      )}
    </div>
  );
}
