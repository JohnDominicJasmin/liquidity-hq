'use client';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';

/* Where a Free visitor can find "Upgrade" (owner, 2026-10-07: "it's hard for a Free user to find Upgrade,
   especially on the Arena page; they have to type /upgrade"). Before this the FREE badge was a plain span, the
   account menu and the phone drawer had no entry, and the only link on Arena was caption text in UsageMeter.

   WHO SEES IT. A signed-in account whose plan is KNOWN to be Free: the subscription read has settled and did
   not fail, and it is neither paid Pro nor a trial (a trial has TrialBanner's own "Keep Pro" pill). While the
   read is loading, or if it failed ('unknown'), nothing renders - the same rule PlanBadge follows, because
   offering Pro to someone who may already have it is the wrong thing to be wrong about. */
export function useShowFreeUpgrade(): boolean {
  const { user, loading, isPro, isTrial, entitlementsLoading, entitlementStatus } = useAuth();
  return !loading && !!user && !entitlementsLoading && !isPro && !isTrial && entitlementStatus === 'not_entitled';
}

/* A bordered button with a 44px touch target, in the app's own data radius (not a capsule), reading plain "Upgrade" with no
   arrow: nothing here needs a direction cue. */
export function UpgradePillLink({ labelKey = 'TNAV_UPGRADE_LABEL', testId = 'upgrade-pill', style }: {
  labelKey?: LabelKey; testId?: string; style?: React.CSSProperties;
}) {
  const { t } = useLabels();
  return (
    <Link
      href="/upgrade"
      data-testid={testId}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '0 15px', minHeight: 44, borderRadius: 'var(--radius-data)',
        border: '1px solid var(--accent)', color: 'var(--accent)',
        fontSize: 'var(--fs-label)', fontWeight: 700, lineHeight: 1,
        textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0,
        ...style,
      }}
    >
      {t(labelKey)}
    </Link>
  );
}

/* The pill for a page header: renders only for a Free account (see useShowFreeUpgrade), so a page can mount it
   without a hook of its own. */
export function FreeUpgradePill({ testId = 'header-upgrade', style }: { testId?: string; style?: React.CSSProperties }) {
  const show = useShowFreeUpgrade();
  return show ? <UpgradePillLink labelKey="TNAV_UPGRADE_LABEL" testId={testId} style={style} /> : null;
}
