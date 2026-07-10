'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { getCheckoutUrl } from '@/lib/checkout';

const CHECKOUT_CONFIGURED = !!(
  process.env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL &&
  process.env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL !== '#'
);

const FREE_FEATURES = [
  'Dashboard + market overview',
  'Morning briefing',
  'News feed',
  'All 17 coins — squeeze scanner',
  '7 Quick + 5 Deep AI analyses / day',
  '15 AI chat messages / day',
];

const PRO_FEATURES = [
  'Everything in Free',
  'Telegram alerts — all signal types',
  'Unlimited price alerts',
  '50 Quick + 25 Deep AI analyses / day',
  '100 AI chat messages + 25 live searches / day',
  'Priority support',
];

export default function UpgradePage() {
  const { user, loading, isPro } = useAuth();
  const router = useRouter();
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace('/login?signup=1&next=/upgrade'); return; }
    if (isPro) { router.replace('/arena'); return; }
  }, [user, loading, isPro, router]);

  function handleCheckout() {
    if (!user) { router.push('/login?signup=1&next=/upgrade'); return; }
    setRedirecting(true);
    window.location.href = getCheckoutUrl(user);
  }

  if (loading || !user || isPro) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#888', fontSize: 13 }}>
        {isPro ? 'Redirecting…' : 'Loading…'}
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--txt)', fontFamily: 'inherit' }}>

      {/* Nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(10,10,14,0.9)', backdropFilter: 'blur(16px)', borderBottom: '0.5px solid var(--bdr)', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/arena" style={{ fontSize: 13, color: 'var(--txt3)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
          ← Back
        </Link>
        <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--txt)' }}>
          LiquidityHQ
        </span>
        <div style={{ width: 48 }} />
      </nav>

      {/* Page body */}
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '56px 24px 80px' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--accent)', background: 'rgba(90,106,255,.1)', border: '0.5px solid rgba(90,106,255,.3)', borderRadius: 20, padding: '4px 14px', marginBottom: 20 }}>
            Pro Plan
          </div>
          <h1 style={{ fontSize: 'clamp(28px, 5vw, 44px)', fontWeight: 900, letterSpacing: '-.03em', margin: '0 0 14px', lineHeight: 1.1 }}>
            Unlock the full stack
          </h1>
          <p style={{ fontSize: 16, color: 'var(--txt2)', margin: 0, lineHeight: 1.65, maxWidth: 440, marginInline: 'auto' }}>
            More AI calls, Telegram alerts, and price alerts. Everything a serious trader needs in one place.
          </p>
        </div>

        {/* Plan cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 36 }}>

          {/* Free card */}
          <div style={{ borderRadius: 16, padding: '24px 28px', border: '0.5px solid var(--bdr)', background: 'var(--bg1)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 6 }}>Current plan</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--txt)', marginBottom: 2 }}>Free</div>
            <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: '-.04em', marginBottom: 20 }}>$0<span style={{ fontSize: 14, fontWeight: 400, color: 'var(--txt3)' }}>/mo</span></div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
              {FREE_FEATURES.map(f => (
                <li key={f} style={{ fontSize: 13, color: 'var(--txt2)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ color: '#22c55e', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✓</span> {f}
                </li>
              ))}
            </ul>
          </div>

          {/* Pro card */}
          <div style={{ borderRadius: 16, padding: '24px 28px', border: '0.5px solid rgba(90,106,255,.5)', background: 'linear-gradient(160deg, rgba(90,106,255,.1) 0%, var(--bg1) 60%)', position: 'relative' }}>
            <div style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', background: 'var(--accent)', color: '#fff', padding: '3px 14px', borderRadius: 20, whiteSpace: 'nowrap' }}>
              Recommended
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 6 }}>Upgrade to</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--txt)', marginBottom: 2 }}>Pro</div>
            <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: '-.04em', marginBottom: 20 }}>$15<span style={{ fontSize: 14, fontWeight: 400, color: 'var(--txt3)' }}>/mo</span></div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
              {PRO_FEATURES.map(f => (
                <li key={f} style={{ fontSize: 13, color: 'var(--txt2)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ color: '#5a6aff', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✓</span> {f}
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
                style={{ fontSize: 15, fontWeight: 700, color: '#fff', background: 'var(--accent)', padding: '14px 40px', borderRadius: 12, border: 'none', cursor: redirecting ? 'default' : 'pointer', opacity: redirecting ? 0.7 : 1, transition: 'opacity .15s, transform .15s', transform: 'translateY(0)' }}
                onMouseEnter={e => { if (!redirecting) (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; }}
              >
                {redirecting ? 'Redirecting to checkout…' : 'Get Pro — $15/mo →'}
              </button>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
                {['Cancel anytime', 'Instant access', 'Secure checkout'].map(t => (
                  <span key={t} style={{ fontSize: 12, color: 'var(--txt3)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ color: '#22c55e', fontSize: 11 }}>✓</span> {t}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div style={{ borderRadius: 14, padding: '28px 36px', border: '0.5px solid rgba(90,106,255,.3)', background: 'rgba(90,106,255,.06)', maxWidth: 400, width: '100%' }}>
              
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--txt)', marginBottom: 8 }}>
                Pro payments launching soon
              </div>
              <p style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.65, margin: '0 0 16px' }}>
                We&apos;re finalising the payment system. You&apos;ll be notified at{' '}
                <span style={{ color: 'var(--accent)' }}>{user.email}</span>{' '}
                as soon as Pro is available.
              </p>
              <Link href="/arena" style={{ fontSize: 13, color: 'var(--txt3)', textDecoration: 'underline' }}>
                Back to Arena
              </Link>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
