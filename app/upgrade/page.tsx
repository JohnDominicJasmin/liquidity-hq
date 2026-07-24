'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { getCheckoutUrl } from '@/lib/checkout';
import LoadingState from '@/components/LoadingState';
import { AI_LIMITS } from '@/lib/limits';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';

const CHECKOUT_CONFIGURED = !!(
  process.env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL &&
  process.env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL !== '#'
);

const F = AI_LIMITS.free, P = AI_LIMITS.pro; // limit numbers derived, not hand-typed

// Keep this list in sync with the actual gates: the timeframe clamp and
// locked cards in app/arena/page.tsx, the /backtest paywall, and the
// PRO_REQUIRED checks in /api/onchain and /api/macro-context.
// (AI limit numbers come from lib/limits.ts - they can't drift from the API.)
const FREE_FEATURES: Array<[LabelKey, Record<string, string | number>?]> = [
  ['UPGRADE_FREE_FEATURE_DASHBOARD'],
  ['UPGRADE_FREE_FEATURE_BRIEFING'],
  ['UPGRADE_FREE_FEATURE_NEWS'],
  ['UPGRADE_FREE_FEATURE_SCANNER'],
  ['UPGRADE_FREE_FEATURE_CHARTS'],
  ['UPGRADE_FREE_FEATURE_AI_ANALYSES', { quick: F.quick, deep: F.deep }],
  ['UPGRADE_FREE_FEATURE_AI_CHAT', { chat: F.chat }],
];

const PRO_FEATURES: Array<[LabelKey, Record<string, string | number>?]> = [
  ['UPGRADE_PRO_FEATURE_EVERYTHING_FREE'],
  ['UPGRADE_PRO_FEATURE_FAST_TIMEFRAMES'],
  ['UPGRADE_PRO_FEATURE_CONFLUENCE'],
  ['UPGRADE_PRO_FEATURE_BACKTESTING'],
  ['UPGRADE_PRO_FEATURE_ONCHAIN_MACRO'],
  ['UPGRADE_PRO_FEATURE_TELEGRAM'],
  ['UPGRADE_PRO_FEATURE_UNLIMITED_ALERTS'],
  ['UPGRADE_PRO_FEATURE_AI_ANALYSES', { quick: P.quick, deep: P.deep }],
  ['UPGRADE_PRO_FEATURE_AI_CHAT_SEARCH', { chat: P.chat, search: P.search }],
  ['UPGRADE_PRO_FEATURE_PRIORITY_SUPPORT'],
];

export default function UpgradePage() {
  const { user, loading, isPro } = useAuth();
  const router = useRouter();
  const [redirecting, setRedirecting] = useState(false);
  const { t } = useLabels();

  useEffect(() => {
    if (loading) return;
    // Pro users already have everything this page sells - send them
    // onward. Logged-out visitors see the pricing itself (no redirect);
    // login is only required at the actual "Get Pro" click, in
    // handleCheckout below - a pricing page that bounces anonymous
    // visitors before they've seen a price is pure conversion friction.
    if (isPro) { router.replace('/arena'); return; }
  }, [isPro, router]);

  function handleCheckout() {
    if (!user) { router.push('/login?signup=1&next=/upgrade'); return; }
    setRedirecting(true);
    window.location.href = getCheckoutUrl(user);
  }

  if (loading || isPro) {
    return <LoadingState message={isPro ? t('UPGRADE_LOADING_REDIRECTING') : t('UPGRADE_LOADING')} fullPage />;
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--txt)', fontFamily: 'inherit' }}>

      {/* Nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'var(--bg)', borderBottom: '0.5px solid var(--bdr)', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/arena" style={{ fontSize: 'var(--fs-label)', color: 'var(--txt3)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
          {t('UPGRADE_BACK_LABEL')}
        </Link>
        <span style={{ fontSize: 'var(--fs-card-title)', fontWeight: 800, letterSpacing: '-.02em', color: 'var(--txt)' }}>
          LiquidityHQ
        </span>
        <div style={{ width: 48 }} />
      </nav>

      {/* Page body */}
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '56px 24px 80px' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--accent)', background: 'var(--accent-bg)', border: '0.5px solid var(--accent-bdr)', borderRadius: 20, padding: '4px 14px', marginBottom: 20 }}>
            {t('UPGRADE_EYEBROW')}
          </div>
          <h1 style={{ fontSize: 'clamp(1.75rem, 5vw, 2.75rem)', fontWeight: 900, letterSpacing: '-.03em', margin: '0 0 14px', lineHeight: 1.1 }}>
            {t('UPGRADE_HERO_TITLE')}
          </h1>
          <p style={{ fontSize: 'var(--fs-body)', color: 'var(--txt2)', margin: 0, lineHeight: 1.65, maxWidth: 440, marginInline: 'auto' }}>
            {t('UPGRADE_HERO_SUBTITLE')}
          </p>
        </div>

        {/* Plan cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 36 }}>

          {/* Free card */}
          <div style={{ borderRadius: 16, padding: '24px 28px', border: '0.5px solid var(--bdr)', background: 'var(--bg1)' }}>
            <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 6 }}>{t('UPGRADE_FREE_CARD_EYEBROW')}</div>
            <div style={{ fontSize: 'var(--fs-label)', fontWeight: 800, color: 'var(--txt)', marginBottom: 2 }}>{t('UPGRADE_FREE_CARD_NAME')}</div>
            <div style={{ fontSize: '2rem', fontWeight: 900, letterSpacing: '-.04em', marginBottom: 20 }}>$0<span style={{ fontSize: 'var(--fs-body)', fontWeight: 400, color: 'var(--txt3)' }}>{t('UPGRADE_PRICE_SUFFIX_MONTHLY')}</span></div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
              {FREE_FEATURES.map(([k, vars]) => (
                <li key={k} style={{ fontSize: 'var(--fs-label)', color: 'var(--txt2)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ color: '#22c55e', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✓</span> {t(k, vars)}
                </li>
              ))}
            </ul>
          </div>

          {/* Pro card */}
          <div style={{ borderRadius: 16, padding: '24px 28px', border: '0.5px solid var(--accent-bdr)', background: 'linear-gradient(160deg, var(--accent-bg) 0%, var(--bg1) 60%)', position: 'relative' }}>
            <div style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', background: 'var(--accent)', color: '#fff', padding: '3px 14px', borderRadius: 20, whiteSpace: 'nowrap' }}>
              {t('UPGRADE_PRO_CARD_BADGE')}
            </div>
            <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 6 }}>{t('UPGRADE_PRO_CARD_EYEBROW')}</div>
            <div style={{ fontSize: 'var(--fs-label)', fontWeight: 800, color: 'var(--txt)', marginBottom: 2 }}>{t('UPGRADE_PRO_CARD_NAME')}</div>
            <div style={{ fontSize: '2rem', fontWeight: 900, letterSpacing: '-.04em', marginBottom: 20 }}>$25<span style={{ fontSize: 'var(--fs-body)', fontWeight: 400, color: 'var(--txt3)' }}>{t('UPGRADE_PRICE_SUFFIX_MONTHLY')}</span></div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
              {PRO_FEATURES.map(([k, vars]) => (
                <li key={k} style={{ fontSize: 'var(--fs-label)', color: 'var(--txt2)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ color: 'var(--accent)', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✓</span> {t(k, vars)}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* CTA */}
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          {CHECKOUT_CONFIGURED ? (
            <>
              <button
                onClick={handleCheckout}
                disabled={redirecting}
                style={{ fontSize: 'var(--fs-data)', fontWeight: 700, color: '#fff', background: 'var(--accent)', padding: '14px 40px', borderRadius: 12, border: 'none', cursor: redirecting ? 'default' : 'pointer', opacity: redirecting ? 0.7 : 1, transition: 'opacity .15s, transform .15s', transform: 'translateY(0)' }}
                onMouseEnter={e => { if (!redirecting) (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; }}
              >
                {redirecting ? t('UPGRADE_CHECKOUT_BUTTON_REDIRECTING') : t('UPGRADE_CHECKOUT_BUTTON_CTA')}
              </button>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
                {(['UPGRADE_TRUST_CANCEL_ANYTIME', 'UPGRADE_TRUST_INSTANT_ACCESS', 'UPGRADE_TRUST_SECURE_CHECKOUT'] as const).map(label => (
                  <span key={label} style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ color: '#22c55e', fontSize: '0.6875rem' }}>✓</span> {t(label)}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div style={{ borderRadius: 14, padding: '28px 36px', border: '0.5px solid var(--accent-bdr)', background: 'var(--accent-bg)', maxWidth: 400, width: '100%' }}>
              
              <div style={{ fontSize: 'var(--fs-data)', fontWeight: 700, color: 'var(--txt)', marginBottom: 8 }}>
                {t('UPGRADE_COMING_SOON_TITLE')}
              </div>
              <p style={{ fontSize: 'var(--fs-label)', color: 'var(--txt2)', lineHeight: 1.65, margin: '0 0 16px' }}>
                {user ? (
                  <>{t('UPGRADE_COMING_SOON_SIGNED_IN_PRE')}{' '}
                  <span style={{ color: 'var(--accent)' }}>{user.email}</span>{' '}
                  {t('UPGRADE_COMING_SOON_SIGNED_IN_POST')}</>
                ) : (
                  <>{t('UPGRADE_COMING_SOON_SIGNED_OUT_PRE')}{' '}
                  <a href="/login?signup=1&next=/upgrade" style={{ color: 'var(--accent)' }}>{t('UPGRADE_COMING_SOON_SIGNUP_LINK')}</a>{' '}
                  {t('UPGRADE_COMING_SOON_SIGNED_OUT_POST')}</>
                )}
              </p>
              <Link href="/arena" style={{ fontSize: 'var(--fs-label)', color: 'var(--txt3)', textDecoration: 'underline' }}>
                {t('UPGRADE_BACK_TO_ARENA_LINK')}
              </Link>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
