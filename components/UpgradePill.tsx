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
export function UpgradePillLink({ labelKey = 'TNAV_UPGRADE_LABEL', testId = 'upgrade-pill', style, tap = false }: {
  labelKey?: LabelKey; testId?: string; style?: React.CSSProperties;
  /** A COMPACT PILL WITH A REAL 44 PX TOUCH TARGET (QA, qa e359faca: the pseudo-element version measured 41 px). The link itself is the 44 px target (transparent), pulled back with negative
   *  margins so it takes only 28 px of layout, and the visible bordered pill is a 28 px child. No pseudo-element and nothing to clip. */
  tap?: boolean;
}) {
  const { t } = useLabels();
  if (tap) {
    return (
      <Link
        href="/upgrade"
        data-testid={testId}
        style={{
          display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 4px', margin: '-8px -4px',
          color: 'var(--accent)', textDecoration: 'none', flexShrink: 0,
          ...style,
        }}
      >
        <span data-testid={`${testId}-visual`} style={{ display: 'inline-flex', alignItems: 'center', minHeight: 28, padding: '0 11px', borderRadius: 'var(--radius-data)', border: '1px solid var(--accent)', fontSize: 'var(--fs-label)', fontWeight: 700, lineHeight: 1, whiteSpace: 'nowrap' }}>
          {t(labelKey)}
        </span>
      </Link>
    );
  }
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
export function FreeUpgradePill({ testId = 'header-upgrade', style, tap = false }: { testId?: string; style?: React.CSSProperties; tap?: boolean }) {
  const show = useShowFreeUpgrade();
  return show ? <UpgradePillLink labelKey="TNAV_UPGRADE_LABEL" testId={testId} style={style} tap={tap} /> : null;
}
