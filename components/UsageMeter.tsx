'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useGrokUsage } from '@/components/GrokUsageProvider';
import { useLabels } from '@/lib/labels';
import { nextResetLocalTime } from '@/lib/resetTime';

// Visible usage tracker under the Arena AI buttons: today's Quick/Deep tally
// + when it resets. Deliberately framed as "X of Y used" with a calm fill
// bar, not "X left" with a ticking countdown - the old copy (see git history)
// was built as a scarcity/urgency conversion tactic, which reads as "burn
// through it before it resets" instead of "here's your daily budget." Color
// only escalates near the real cap (80%/100%, same threshold used for the
// AI-spend spike banner in app/ops), so most of the day this is a quiet,
// ambient fact - not a pressure signal.
function StatBlock({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const color = pct >= 100 ? 'var(--red)' : pct >= 80 ? 'var(--amber)' : 'var(--txt2)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 96 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 'var(--fs-caption)' }}>
        <span style={{ color: 'var(--txt2)' }}>{label}</span>
        <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>{used}/{limit}</span>
      </div>
      <div style={{ height: 3, borderRadius: 2, background: 'var(--bdr2)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

export default function UsageMeter() {
  const { user, isPro } = useAuth();
  const { usage } = useGrokUsage();
  const { t } = useLabels();
  const [resetTime, setResetTime] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setResetTime(nextResetLocalTime());
    tick();
    // Just keeps the clock-time string correct if the tab is left open past
    // midnight - not a countdown, so it doesn't need to be frequent.
    const id = setInterval(tick, 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  if (!user || !usage) return null;

  const quickPct = usage.quick_limit > 0 ? (usage.quick_used / usage.quick_limit) * 100 : 0;
  const deepPct  = usage.deep_limit  > 0 ? (usage.deep_used  / usage.deep_limit)  * 100 : 0;
  const nearCap  = quickPct >= 80 || deepPct >= 80;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
        margin: '2px 0 10px', padding: '8px 14px',
        borderRadius: 'var(--radius-card)', border: '0.5px solid var(--bdr)', background: 'var(--bg2)',
      }}
    >
      <StatBlock label={t('USAGE_METER_QUICK_LABEL')} used={usage.quick_used} limit={usage.quick_limit} />
      <StatBlock label={t('USAGE_METER_DEEP_LABEL')} used={usage.deep_used} limit={usage.deep_limit} />
      {resetTime != null && (
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>
          {t('USAGE_METER_RESET_FACT', { time: resetTime })}
        </span>
      )}
      {!isPro && nearCap && (
        <Link href="/upgrade" style={{ marginLeft: 'auto', color: 'var(--accent)', fontWeight: 700, fontSize: 'var(--fs-caption)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
          {t('USAGE_METER_UPGRADE_LINK')}
        </Link>
      )}
    </div>
  );
}
