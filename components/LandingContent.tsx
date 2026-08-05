'use client';
import { Fragment, useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import type { LandingDict, Locale } from '@/lib/i18n/dictionaries';
import { BeamsBackground } from '@/components/BeamsBackground';
import BrandMark from '@/components/BrandMark';

interface Props {
  dict: LandingDict;
  locale: Locale;
  dir: 'ltr' | 'rtl';
}

/* One icon + link target per features.cards[i] - structural, not translated,
   since the app itself stays English-only past the landing page (see
   dictionaries.ts header comment). */
const FEATURE_META: Array<{ href: string; accent: string; icon: ReactNode }> = [
  { // AI Arena
    href: '/arena', accent: 'purple',
    icon: <path d="M3 12h3l2-7 4 14 2-7h7" />,
  },
  { // Telegram Alerts
    href: '/settings', accent: 'blue',
    icon: <path d="M12 4a5 5 0 0 0-5 5v3.2c0 .5-.2 1-.5 1.4L5 16h14l-1.5-2.4c-.3-.4-.5-.9-.5-1.4V9a5 5 0 0 0-5-5Zm-2.5 14a2.5 2.5 0 0 0 5 0" />,
  },
  { // Morning Briefing
    href: '/briefing', accent: 'amber',
    icon: <><path d="M12 3v4M4.9 8.9l1.4 1.4M19.1 8.9l-1.4 1.4M3 15h18" /><path d="M6 15a6 6 0 0 1 12 0" /></>,
  },
  { // News Feed
    href: '/news', accent: 'green',
    icon: <><path d="M5 4h11a2 2 0 0 1 2 2v13a1 1 0 0 1-1.7.7L15 18H6a2 2 0 0 1-2-2V4Z" /><path d="M8 8h6M8 11.5h6M8 15h3" /></>,
  },
  { // Whale Tracker
    href: '/dashboard', accent: 'red',
    icon: <path d="M3 13c3-4 6-5 9-5s6 3 9 5c-3 4-6 5-9 5s-6-1-9-5Zm5 0h.01M15 9c1 1.5 1 3 0 4" />,
  },
  { // Squeeze Scanner
    href: '/scanner', accent: 'purple',
    icon: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21" /></>,
  },
];

export default function LandingContent({ dict, locale, dir }: Props) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const stepArrow = dir === 'rtl' ? '←' : '→';

  /* Redirect signed-in users straight to the app */
  useEffect(() => {
    if (!loading && user) router.replace('/arena');
  }, [user, loading, router]);

  /* Hide the app shell nav + ticker on this page, and set lang/dir for this
     locale variant - restored on unmount since the rest of the app is English/LTR. */
  useEffect(() => {
    document.body.classList.add('landing');
    const prevLang = document.documentElement.lang;
    const prevDir  = document.documentElement.dir;
    document.documentElement.lang = locale;
    document.documentElement.dir  = dir;
    return () => {
      document.body.classList.remove('landing');
      document.documentElement.lang = prevLang;
      document.documentElement.dir  = prevDir;
    };
  }, [locale, dir]);

  // `loading` starts true on both the server render and the client's first
  // hydration pass (Supabase's session check is async either way), so this
  // branch is identical on both sides - no hydration mismatch. It also means
  // the marketing page is never painted at all for a returning session.
  if (loading || user) {
    return (
      <div className="lp-loading">
        <span className="lp-loading-logo" aria-hidden="true">LiquidityHQ</span>
        <span className="lp-loading-spin" aria-hidden="true" />
        <span className="sr-only" role="status">Loading your session…</span>
      </div>
    );
  }

  return (
    <div className="lp-root" dir={dir}>

      {/* ── NAV ── */}
      <nav className="lp-nav">
        <div className="lp-nav-inner">
          {/* tone="dark" is fixed - .lp-nav's background is a hardcoded dark
              rgba() blur, not theme-driven, so this bar never turns light. */}
          <span className="lp-logo" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BrandMark size={24} tone="dark" />
            LiquidityHQ
          </span>
          <div className="lp-nav-actions">
            <LanguageSwitcher locale={locale} />
            <Link href="/login" className="lp-btn-ghost">{dict.nav.signIn}</Link>
            <Link href="/login?signup=1" className="lp-btn-primary">{dict.nav.getStarted}</Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="lp-hero">
        <BeamsBackground intensity="medium" />
        <div className="lp-hero-glow" />
        <div className="lp-hero-inner" style={{ position: 'relative', zIndex: 2 }}>
          <div className="lp-hero-badge">
            <span className="lp-live-dot" />
            {dict.hero.badge}
          </div>
          <h1 className="lp-h1">
            {dict.hero.h1Line1}<br />
            <span className="lp-h1-accent">{dict.hero.h1Line2}</span>
          </h1>
          <p className="lp-hero-sub">{dict.hero.sub}</p>
          <div className="lp-hero-ctas">
            <Link href="/login?signup=1" className="lp-cta-primary">{dict.hero.ctaPrimary}</Link>
            <Link href="/briefing" className="lp-cta-ghost">{dict.hero.ctaGhost}</Link>
          </div>
          <div className="lp-hero-stats">
            <div className="lp-stat"><span>50</span>{dict.hero.stats.coins}</div>
            <div className="lp-stat-sep" />
            <div className="lp-stat"><span>35</span>{dict.hero.stats.signals}</div>
            <div className="lp-stat-sep" />
            <div className="lp-stat"><span>Grok</span>{dict.hero.stats.ai}</div>
            <div className="lp-stat-sep" />
            <div className="lp-stat"><span>Live</span>{dict.hero.stats.telegram}</div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="lp-section">
        <div className="lp-section-inner">
          <div className="lp-section-label">{dict.features.label}</div>
          <h2 className="lp-h2">{dict.features.h2}</h2>
          <p className="lp-section-sub">{dict.features.sub}</p>
          <div className="lp-features">
            {dict.features.cards.map((card, i) => {
              const meta = FEATURE_META[i];
              return (
                <Link key={i} href={meta.href} className="lp-feature-card">
                  <div className={`lp-feat-icon lp-feat-icon-${meta.accent}`} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      {meta.icon}
                    </svg>
                  </div>
                  <h3>{card.title}</h3>
                  <p>{card.desc}</p>
                  <div className="lp-feat-pills">
                    {card.pills.map((p, j) => <span key={j}>{p}</span>)}
                  </div>
                  <span className="lp-feat-link">{dict.features.openLabel} {stepArrow}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-section-inner">
          <div className="lp-section-label">{dict.howItWorks.label}</div>
          <h2 className="lp-h2">{dict.howItWorks.h2}</h2>
          <div className="lp-steps">
            {dict.howItWorks.steps.map((step, i) => (
              <Fragment key={i}>
                <div className="lp-step">
                  <div className="lp-step-num">{i + 1}</div>
                  <h3>{step.title}</h3>
                  <p>{step.desc}</p>
                </div>
                {i < dict.howItWorks.steps.length - 1 && <div className="lp-step-arrow">{stepArrow}</div>}
              </Fragment>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section className="lp-section" id="pricing">
        <div className="lp-section-inner">
          <div className="lp-section-label">{dict.pricing.label}</div>
          <h2 className="lp-h2">{dict.pricing.h2}</h2>
          <div className="lp-pricing">

            <div className="lp-plan lp-plan-free">
              <div className="lp-plan-header">
                <div className="lp-plan-name">{dict.pricing.free.name}</div>
                <div className="lp-plan-price">$0<span>/mo</span></div>
                <div className="lp-plan-sub">{dict.pricing.free.sub}</div>
              </div>
              <ul className="lp-plan-features">
                {dict.pricing.free.features.map((f, i) => (
                  <li key={i}>
                    <span className={f.included ? 'lp-check' : 'lp-x'}>{f.included ? '✓' : '✕'}</span> {f.text}
                  </li>
                ))}
              </ul>
              <Link href="/login?signup=1" className="lp-plan-cta lp-plan-cta-free">
                {dict.pricing.free.cta}
              </Link>
            </div>

            <div className="lp-plan lp-plan-pro">
              <div className="lp-plan-badge">{dict.pricing.pro.badge}</div>
              <div className="lp-plan-header">
                <div className="lp-plan-name">{dict.pricing.pro.name}</div>
                <div className="lp-plan-price">$25<span>/mo</span></div>
                <div className="lp-plan-sub">{dict.pricing.pro.sub}</div>
              </div>
              <ul className="lp-plan-features">
                {dict.pricing.pro.features.map((f, i) => (
                  <li key={i}><span className="lp-check lp-check-pro">✓</span> {f}</li>
                ))}
              </ul>
              <Link href="/upgrade" className="lp-plan-cta lp-plan-cta-pro">
                {dict.pricing.pro.cta}
              </Link>
            </div>

          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="lp-final-cta">
        <div className="lp-final-inner">
          <h2>{dict.finalCta.h2}</h2>
          <p>{dict.finalCta.sub}</p>
          <Link href="/login?signup=1" className="lp-cta-primary">
            {dict.finalCta.cta}
          </Link>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="lp-footer">
        <div className="lp-footer-grid">
          <div className="lp-footer-brand">
            <span className="lp-logo" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <BrandMark size={32} tone="dark" />
              LiquidityHQ
            </span>
            <p>{dict.footer.brandDesc}</p>
          </div>

          <div className="lp-footer-col">
            <div className="lp-footer-col-title">{dict.footer.columns.product}</div>
            <Link href="/dashboard">{dict.footer.links.dashboard}</Link>
            <Link href="/arena">{dict.footer.links.arena}</Link>
            <Link href="/briefing">{dict.footer.links.briefing}</Link>
            <Link href="/news">{dict.footer.links.news}</Link>
          </div>

          <div className="lp-footer-col">
            <div className="lp-footer-col-title">{dict.footer.columns.analysis}</div>
            <Link href="/scanner">{dict.footer.links.scanner}</Link>
            <Link href="/liq">{dict.footer.links.liq}</Link>
            <Link href="/funding">{dict.footer.links.funding}</Link>
            <Link href="/correlation">{dict.footer.links.correlation}</Link>
          </div>

          <div className="lp-footer-col">
            <div className="lp-footer-col-title">{dict.footer.columns.tools}</div>
            <Link href="/journal">{dict.footer.links.journal}</Link>
            <Link href="/calc">{dict.footer.links.calc}</Link>
            <Link href="/alerts">{dict.footer.links.alerts}</Link>
            <Link href="/hours">{dict.footer.links.hours}</Link>
          </div>

          <div className="lp-footer-col">
            <div className="lp-footer-col-title">{dict.footer.columns.account}</div>
            <Link href="/login">{dict.footer.links.signIn}</Link>
            <Link href="/login?signup=1">{dict.footer.links.createAccount}</Link>
            <Link href="/upgrade">{dict.footer.links.pricing}</Link>
            <Link href="/about">{dict.footer.links.about}</Link>
            <Link href="/disclaimer">{dict.footer.links.disclaimer}</Link>
            <Link href="/terms">Terms of Use</Link>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/refund">Refund Policy</Link>
          </div>
        </div>
        {/* Risk Disclosure */}
        <div style={{ maxWidth: 1100, margin: '40px auto 0' }}>
          <div className="pf-footer-divider">
            <span className="pf-footer-divider-label">RISK DISCLOSURE</span>
            <div className="pf-footer-divider-line" />
          </div>
          <div className="pf-footer-grid" style={{ marginBottom: 32 }}>
            {[
              { label: 'Educational Use', text: 'All content - signals, scores, alerts, and AI commentary - is for informational purposes only. Nothing constitutes a recommendation to buy, sell, or hold any asset.' },
              { label: 'Trading Risk', text: 'Crypto trading involves substantial risk. Prices are volatile, leverage magnifies losses, and most active traders lose money. Only trade with money you can afford to lose.' },
              { label: 'No Investment Advice', text: 'We are not a registered investment advisor. You are solely responsible for your own trading decisions. Consult a licensed professional before making any investment decision.' },
              { label: 'AI Analysis', text: 'LiquidityAI is powered by xAI Grok. AI output can be incomplete, outdated, or wrong - never use it as your sole basis for a trade. Always verify against the raw data shown.' },
              { label: 'Data Sources', text: 'Price, funding, and OI data sourced from Binance, Bybit, Finnhub, and Alternative.me. We do not guarantee accuracy, completeness, or availability of third-party feeds.' },
              { label: 'No Affiliation', text: 'LiquidityHQ is not affiliated with, endorsed by, or sponsored by any exchange or data provider referenced here. All trademarks belong to their respective owners.' },
            ].map(item => (
              <div key={item.label} className="pf-footer-item">
                <div className="pf-footer-item-label">{item.label}</div>
                <p className="pf-footer-item-text">{item.text}</p>
              </div>
            ))}
          </div>
        </div>

        <div style={{
          maxWidth: 1100, margin: '36px auto 0', paddingTop: 20,
          borderTop: '0.5px solid var(--bdr)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <p style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', margin: 0, lineHeight: 1.6 }}>
            {dict.footer.copyright}{' '}
            <Link href="/disclaimer" style={{ color: 'var(--txt3)', textDecoration: 'underline', textUnderlineOffset: 2 }}>{dict.footer.fullDisclaimer}</Link>
          </p>
          {/* opacity 0.7 on --txt3 computed to #58585d = 2.88:1, and the two
              legal links inside inherited it. Fifth site of the same pattern -
              see the --txt3 note in globals.css. Caption size carries the
              de-emphasis; alpha on a token tuned to the AA line does not. */}
          <p style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', margin: 0, lineHeight: 1.6 }}>
            By using LiquidityHQ, you acknowledge that you understand and agree to our{' '}
            <Link href="/disclaimer" style={{ color: 'var(--txt3)', textDecoration: 'underline', textUnderlineOffset: 2 }}>Disclaimer</Link>,{' '}
            <Link href="/terms" style={{ color: 'var(--txt3)', textDecoration: 'underline', textUnderlineOffset: 2 }}>Terms of Use</Link>,{' '}
            <Link href="/privacy" style={{ color: 'var(--txt3)', textDecoration: 'underline', textUnderlineOffset: 2 }}>Privacy Policy</Link>, and{' '}
            <Link href="/refund" style={{ color: 'var(--txt3)', textDecoration: 'underline', textUnderlineOffset: 2 }}>Refund Policy</Link>.
          </p>
        </div>
      </footer>

    </div>
  );
}
