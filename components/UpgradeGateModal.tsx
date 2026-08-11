'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { getCheckoutUrl, isCheckoutConfigured } from '@/lib/checkout';
import { useLabels } from '@/lib/labels';

interface Props {
  open: boolean;
  onClose: () => void;
  // Short human-readable name of the thing that was locked, e.g.
  // "5 minute timeframe" or "Absorption Detector" - shown in the headline.
  feature?: string;
}

// In-place stand-in rendered where a Pro-only card would normally sit, so the
// page layout keeps its rhythm instead of sections silently vanishing for
// free users. Clicking it opens the full UpgradeGateModal via onUnlock.
export function LockedFeatureCard({ title, description, onUnlock }: {
  title: string;
  description: string;
  onUnlock: () => void;
}) {
  const { t } = useLabels();
  return (
    <div style={{
      background: 'linear-gradient(180deg, var(--bg2), var(--bg1))',
      border: '0.5px solid var(--bdr)',
      borderRadius: 'var(--radius-card, 12px)',
      padding: '18px 20px',
      display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
    }}>
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 'var(--fs-micro)', fontWeight: 600, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--accent-2)', marginBottom: 6,
        }}>
          {t('UPGRADE_GATE_PRO_FEATURE_LABEL')}
        </div>
        <div style={{ fontSize: 'var(--fs-card-title)', fontWeight: 700, color: 'var(--txt)', marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', lineHeight: 1.6 }}>{description}</div>
      </div>
      <button
        onClick={onUnlock}
        style={{
          background: 'var(--accent-solid)', color: '#fff', border: 'none', cursor: 'pointer',
          fontSize: 'var(--fs-label)', fontWeight: 700, padding: '9px 16px', borderRadius: 8,
          flexShrink: 0,
        }}
      >
        {t('UPGRADE_GATE_UNLOCK_BUTTON')}
      </button>
    </div>
  );
}

// Shared by the modal below and FullPageUpgradeGate - while LemonSqueezy
// checkout is not configured, getCheckoutUrl falls back to the signup page,
// a dead end for someone already signed in. Send signed-in users to /upgrade
// instead (it explains payments are launching soon), signed-out users to
// signup with /upgrade as the destination.
function useCheckoutHref() {
  const { user } = useAuth();
  const checkoutConfigured = isCheckoutConfigured();
  return checkoutConfigured
    ? getCheckoutUrl(user)
    : user ? '/upgrade' : '/login?signup=1&next=/upgrade';
}

// Full-page stand-in for when an entire route is Pro-only (e.g. /backtest),
// as opposed to a single card (LockedFeatureCard) or an interrupting paywall
// (UpgradeGateModal). Same copy conventions as both - one "Pro Feature"
// eyebrow + CTA pattern instead of three hand-rolled versions drifting apart.
export function FullPageUpgradeGate({ title, description }: { title: string; description: string }) {
  const ctaHref = useCheckoutHref();
  const { t } = useLabels();
  return (
    <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'linear-gradient(180deg, var(--bg2), var(--bg1))',
        border: '0.5px solid var(--bdr2)',
        borderRadius: 'var(--radius-card, 12px)',
        padding: '34px 34px 30px',
      }}>
        <div style={{
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 'var(--fs-micro)', fontWeight: 600, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--accent-2)', marginBottom: 14,
        }}>
          {t('UPGRADE_GATE_PRO_FEATURE_LABEL')}
        </div>
        <h1 style={{ fontSize: 'var(--fs-section)', fontWeight: 800, color: 'var(--txt)', margin: '0 0 10px', lineHeight: 1.25 }}>
          {title}
        </h1>
        <p style={{ fontSize: 'var(--fs-body)', color: 'var(--txt2)', lineHeight: 1.7, margin: '0 0 22px' }}>
          {description}
        </p>
        <a
          href={ctaHref}
          style={{
            display: 'block', textAlign: 'center',
            background: 'var(--accent-solid)', color: '#fff',
            fontSize: 'var(--fs-body)', fontWeight: 700,
            padding: '12px 16px', borderRadius: 8,
            textDecoration: 'none',
          }}
        >
          {t('UPGRADE_GATE_CTA')}
        </a>
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <Link href="/upgrade" style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', textDecoration: 'underline', textUnderlineOffset: 2, display: 'inline-flex', alignItems: 'center', minHeight: 24 }}>
            {t('UPGRADE_GATE_COMPARE_LINK')}
          </Link>
        </div>
      </div>
    </div>
  );
}

// Paywall modal shown when a free user taps a Pro-only feature. The CTA goes
// through getCheckoutUrl, which pre-fills the LemonSqueezy checkout with the
// user's email + id (or falls back to /login?signup=1 while checkout is not
// configured yet).
export default function UpgradeGateModal({ open, onClose, feature }: Props) {
  const ctaHref = useCheckoutHref();
  const { t } = useLabels();

  // Escape closes; body scroll locks while open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('UPGRADE_GATE_CTA')}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(4, 6, 12, 0.72)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 440,
          background: 'linear-gradient(180deg, var(--bg2), var(--bg1))',
          border: '0.5px solid var(--bdr2)',
          borderRadius: 'var(--radius-card, 12px)',
          padding: '30px 30px 26px',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}
      >
        {/* Micro-label */}
        <div style={{
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 'var(--fs-micro)', fontWeight: 600, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--accent-2)', marginBottom: 14,
        }}>
          {t('UPGRADE_GATE_PRO_FEATURE_LABEL')}
        </div>

        <h2 style={{ fontSize: 'var(--fs-section)', fontWeight: 800, color: 'var(--txt)', margin: '0 0 10px', lineHeight: 1.25 }}>
          {feature ? t('UPGRADE_GATE_HEADLINE_FEATURE', { feature }) : t('UPGRADE_GATE_HEADLINE_DEFAULT')}
        </h2>

        <p style={{ fontSize: 'var(--fs-body)', color: 'var(--txt2)', lineHeight: 1.7, margin: '0 0 20px' }}>
          {t('UPGRADE_GATE_BODY')}
        </p>

        {/* Value bullets */}
        <ul style={{ listStyle: 'none', margin: '0 0 24px', padding: 0, display: 'grid', gap: 9 }}>
          {([
            'UPGRADE_GATE_BULLET_1',
            'UPGRADE_GATE_BULLET_2',
            /* BULLET_3 is "Full backtesting across every coin and timeframe" and is
               omitted while /backtest is hidden (#273) - same reason as the
               /upgrade Pro list. Key and default kept so restoring it is this one
               line. Must come back in step with the redirect in proxy.ts. */
            'UPGRADE_GATE_BULLET_4',
          ] as const).map(k => (
            <li key={k} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 'var(--fs-label)', color: 'var(--txt2)', lineHeight: 1.5 }}>
              <span style={{ color: 'var(--green)', fontSize: '0.75rem', flexShrink: 0 }}>✓</span>
              {t(k)}
            </li>
          ))}
        </ul>

        {/* CTA */}
        <a
          href={ctaHref}
          style={{
            display: 'block', textAlign: 'center',
            background: 'var(--accent-solid)', color: '#fff',
            fontSize: 'var(--fs-body)', fontWeight: 700,
            padding: '12px 16px', borderRadius: 8,
            textDecoration: 'none',
          }}
        >
          {t('UPGRADE_GATE_CTA')}
        </a>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <Link href="/upgrade" style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', textDecoration: 'underline', textUnderlineOffset: 2, display: 'inline-flex', alignItems: 'center', minHeight: 24 }}>
            {t('UPGRADE_GATE_COMPARE_LINK')}
          </Link>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 'var(--fs-caption)', color: 'var(--txt3)', padding: '4px 2px',
            }}
          >
            {t('UPGRADE_GATE_NOT_NOW')}
          </button>
        </div>
      </div>
    </div>
  );
}
