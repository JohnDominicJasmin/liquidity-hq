'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import type { LandingDict, Locale } from '@/lib/i18n/dictionaries';

interface Props {
  dict: LandingDict;
  locale: Locale;
  dir: 'ltr' | 'rtl';
}

export default function LandingContent({ dict, locale, dir }: Props) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const stepArrow = dir === 'rtl' ? '←' : '→';

  /* Redirect signed-in users straight to the app */
  useEffect(() => {
    if (!loading && user) router.replace('/arena');
  }, [user, loading, router]);

  /* Hide the app shell nav + ticker on this page, and set lang/dir for this
     locale variant — restored on unmount since the rest of the app is English/LTR. */
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
  // branch is identical on both sides — no hydration mismatch. It also means
  // the marketing page is never painted at all for a returning session.
  if (loading || user) {
    return (
      <div className="lp-loading">
        <span className="lp-loading-logo" aria-hidden="true">LiquidityHQ<span>.ai</span></span>
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
          <span className="lp-logo">LiquidityHQ<span>.ai</span></span>
          <div className="lp-nav-actions">
            <LanguageSwitcher locale={locale} />
            <Link href="/login" className="lp-btn-ghost">{dict.nav.signIn}</Link>
            <Link href="/login?signup=1" className="lp-btn-primary">{dict.nav.getStarted}</Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="lp-hero">
        <div className="lp-hero-glow" />
        <div className="lp-hero-inner">
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
            <div className="lp-stat"><span>17</span>{dict.hero.stats.coins}</div>
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
          <div className="lp-features">
            {dict.features.cards.map((card, i) => {
              const colors = ['lp-feat-purple', 'lp-feat-green', 'lp-feat-amber', 'lp-feat-blue', 'lp-feat-red', 'lp-feat-purple'];
              return (
                <div key={i} className={`lp-feature-card ${colors[i]}`}>
                  <h3>{card.title}</h3>
                  <p>{card.desc}</p>
                  <div className="lp-feat-pills">
                    {card.pills.map((p, j) => <span key={j}>{p}</span>)}
                  </div>
                </div>
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
              <div key={i} style={{ display: 'contents' }}>
                <div className="lp-step">
                  <div className="lp-step-num">{i + 1}</div>
                  <h3>{step.title}</h3>
                  <p>{step.desc}</p>
                </div>
                {i < dict.howItWorks.steps.length - 1 && <div className="lp-step-arrow">{stepArrow}</div>}
              </div>
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
                    <span className={i < 6 ? 'lp-check' : 'lp-x'}>{i < 6 ? '✓' : '✕'}</span> {f}
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
                <div className="lp-plan-price">$15<span>/mo</span></div>
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
            <span className="lp-logo">LiquidityHQ<span>.ai</span></span>
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
              { label: 'Educational Use', text: 'All content — signals, scores, alerts, and AI commentary — is for informational purposes only. Nothing constitutes a recommendation to buy, sell, or hold any asset.' },
              { label: 'Trading Risk', text: 'Crypto trading involves substantial risk. Prices are volatile, leverage magnifies losses, and most active traders lose money. Only trade with money you can afford to lose.' },
              { label: 'No Investment Advice', text: 'We are not a registered investment advisor. You are solely responsible for your own trading decisions. Consult a licensed professional before making any investment decision.' },
              { label: 'AI Analysis', text: 'LiquidityAI is powered by xAI Grok. AI output can be incomplete, outdated, or wrong — never use it as your sole basis for a trade. Always verify against the raw data shown.' },
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

        <div className="lp-footer-bottom">
          <span className="lp-footer-copy">
            {dict.footer.copyright}{' '}
            <Link href="/disclaimer" style={{ color: 'var(--txt3)', textDecoration: 'underline' }}>{dict.footer.fullDisclaimer}</Link>
          </span>
        </div>
      </footer>

    </div>
  );
}
