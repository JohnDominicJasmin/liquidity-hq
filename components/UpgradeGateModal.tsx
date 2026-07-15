'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { getCheckoutUrl } from '@/lib/checkout';

interface Props {
  open: boolean;
  onClose: () => void;
  // Short human-readable name of the thing that was locked, e.g.
  // "5 minute timeframe" or "Absorption Detector" — shown in the headline.
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
          fontSize: 9, fontWeight: 600, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--accent-2)', marginBottom: 6,
        }}>
          Pro Feature
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt)', marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--txt3)', lineHeight: 1.6 }}>{description}</div>
      </div>
      <button
        onClick={onUnlock}
        style={{
          background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer',
          fontSize: 12.5, fontWeight: 700, padding: '9px 16px', borderRadius: 8,
          flexShrink: 0,
        }}
      >
        Unlock with Pro
      </button>
    </div>
  );
}

// Paywall modal shown when a free user taps a Pro-only feature. The CTA goes
// through getCheckoutUrl, which pre-fills the LemonSqueezy checkout with the
// user's email + id (or falls back to /login?signup=1 while checkout is not
// configured yet).
export default function UpgradeGateModal({ open, onClose, feature }: Props) {
  const { user } = useAuth();

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
      aria-label="Upgrade to Pro"
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
          fontSize: 10, fontWeight: 600, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--accent-2)', marginBottom: 14,
        }}>
          Pro Feature
        </div>

        <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--txt)', margin: '0 0 10px', lineHeight: 1.25 }}>
          {feature ? `${feature} is part of Pro.` : 'This is part of Pro.'}
        </h2>

        <p style={{ fontSize: 13.5, color: 'var(--txt2)', lineHeight: 1.7, margin: '0 0 20px' }}>
          Pro unlocks the fast timeframes, the full signal stack, backtesting, and the
          deeper AI research tools. One subscription, everything included.
        </p>

        {/* Value bullets */}
        <ul style={{ listStyle: 'none', margin: '0 0 24px', padding: 0, display: 'grid', gap: 9 }}>
          {[
            'Signals on the 1 minute, 5 minute, and 15 minute charts',
            'Absorption Detector, Order Flow, and Confluence Score',
            'Full backtesting across every coin and timeframe',
            'On-chain and global macro AI analysis',
          ].map(line => (
            <li key={line} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 13, color: 'var(--txt2)', lineHeight: 1.5 }}>
              <span style={{ color: 'var(--green)', fontSize: 12, flexShrink: 0 }}>✓</span>
              {line}
            </li>
          ))}
        </ul>

        {/* CTA */}
        <a
          href={getCheckoutUrl(user)}
          style={{
            display: 'block', textAlign: 'center',
            background: 'var(--accent)', color: '#fff',
            fontSize: 14, fontWeight: 700,
            padding: '12px 16px', borderRadius: 8,
            textDecoration: 'none',
          }}
        >
          Upgrade to Pro
        </a>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <Link href="/upgrade" style={{ fontSize: 12, color: 'var(--txt3)', textDecoration: 'underline', textUnderlineOffset: 2 }}>
            Compare Free and Pro
          </Link>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 12, color: 'var(--txt3)', padding: '4px 2px',
            }}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
