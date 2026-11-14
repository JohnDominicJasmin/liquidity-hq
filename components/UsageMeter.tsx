'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useGrokUsage } from '@/components/GrokUsageProvider';
import { useLabels } from '@/lib/labels';
import { UpgradePillLink, useShowFreeUpgrade } from '@/components/UpgradePill';
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
  const showFreeUpgrade = useShowFreeUpgrade();
  const [resetTime, setResetTime] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setResetTime(nextResetLocalTime());
    tick();
    // Just keeps the clock-time string correct if the tab is left open past
    // midnight - not a countdown, so it doesn't need to be frequent.
    const id = setInterval(tick, 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  if (!user) return null;
  /* The slot is sized PER TIER (QA, deployed qa: the Free row is 62 px, the Pro row 43 px, because the Upgrade pill is taller than the numbers). A plan that is not yet known to be Pro is held at the Free height. */
  const slotClass = isPro ? 'usage-meter-slot' : 'usage-meter-slot usage-meter-slot--free';
  /* ONE LINE, FIXED HEIGHT: the row never wraps (the reset text ellipsizes), so the box is the same height in every language and width (PM, #2365). */
  /* THE SLOT IS RESERVED FOR A SIGNED-IN VISITOR FROM FIRST PAINT (arena layout shift, #1263). The meter used to render nothing until the usage numbers arrived (3 to 6 seconds on the real network) and then
     appear above the chart, pushing the whole chart workspace down 43 px on a desktop and 81 px on a phone (QA's node-insert probe, run 43649222730: +0.0254 at 1280, +0.0476 at 390). `.usage-meter-slot`
     keeps that height (globals.css), so the numbers arriving fill the slot and move nothing. */
  /* The Upgrade button does not wait for usage to load (owner, 2026-10-07): a Free visitor sees it as soon as the plan is
     known, even while the Quick/Deep tally is still on its way. */
  if (!usage) {
    return (
      <div className={slotClass} style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start' }}>
        {showFreeUpgrade ? <UpgradePillLink testId="usage-meter-upgrade" /> : null}
      </div>
    );
  }

  const quickPct = usage.quick_limit > 0 ? (usage.quick_used / usage.quick_limit) * 100 : 0;
  const deepPct  = usage.deep_limit  > 0 ? (usage.deep_used  / usage.deep_limit)  * 100 : 0;
  const nearCap  = quickPct >= 80 || deepPct >= 80;

  return (
    <div className={slotClass}>
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'nowrap', overflow: 'hidden',
        margin: 0, padding: '8px 14px',
        borderRadius: 'var(--radius-card)', border: '0.5px solid var(--bdr)', background: 'var(--bg2)',
      }}
    >
      <StatBlock label={t('USAGE_METER_QUICK_LABEL')} used={usage.quick_used} limit={usage.quick_limit} />
      <StatBlock label={t('USAGE_METER_DEEP_LABEL')} used={usage.deep_used} limit={usage.deep_limit} />
      {resetTime != null && (
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: '0 1 auto' }}>
          {t('USAGE_METER_RESET_FACT', { time: resetTime })}
        </span>
      )}
      {/* Free: a real button-style pill, always (was caption text, only near the cap). A trial keeps the old caption link
          near the cap - TrialBanner already carries its pill. */}
      {showFreeUpgrade && <UpgradePillLink testId="usage-meter-upgrade" style={{ marginLeft: 'auto', flexShrink: 0 }} />}
      {!isPro && !showFreeUpgrade && nearCap && (
        <Link href="/upgrade" style={{ marginLeft: 'auto', color: 'var(--accent)', fontWeight: 700, fontSize: 'var(--fs-caption)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
          {t('USAGE_METER_UPGRADE_LINK')}
        </Link>
      )}
    </div>
    </div>
  );
}
