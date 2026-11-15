'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/components/AuthProvider';
import { useOnboarding } from '@/components/OnboardingProvider';
import BrandMark from '@/components/BrandMark';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/supportContact';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';

/* The AI Analysis entry reads the legal key (labelKey) instead of carrying its own copy of the processor sentence (#1185, PM): one source, so the wording cannot drift from the disclaimer page. */
/* The BODIES stay English on purpose: they are legal disclosure text, and an AI-drafted translation of them is a decision for the owner or counsel, not for this file (#1185, flagged to PM). Only the headings are translated. */
const DISCLOSURES: { label: string; headingKey: LabelKey; text: string; labelKey?: LabelKey }[] = [
  {
    label: 'Educational Use',
    headingKey: 'PF_ITEM_EDUCATIONAL',
    text: 'All content - signals, scores, alerts, and AI commentary - is for informational purposes only. Nothing constitutes a recommendation to buy, sell, or hold any asset.',
  },
  {
    label: 'Trading Risk',
    headingKey: 'PF_ITEM_TRADING_RISK',
    text: 'Crypto trading involves substantial risk. Prices are volatile, leverage magnifies losses, and most active traders lose money. Only trade with money you can afford to lose.',
  },
  {
    label: 'No Investment Advice',
    headingKey: 'PF_ITEM_NO_ADVICE',
    text: 'We are not a registered investment advisor. You are solely responsible for your own trading decisions. Consult a licensed professional before making any investment decision.',
  },
  {
    label: 'AI Analysis',
    headingKey: 'PF_ITEM_AI',
    text: '',
    labelKey: 'DISCLAIMER_SECTION_AI_ANALYSIS_BODY',
  },
  {
    label: 'Data Sources',
    headingKey: 'PF_ITEM_DATA',
    text: 'Price, funding, and OI data sourced from Binance and Bybit. News from Finnhub, Fear & Greed from Alternative.me. We do not guarantee accuracy, completeness, or availability of third-party feeds.',
  },
  {
    label: 'No Affiliation',
    headingKey: 'PF_ITEM_NO_AFFILIATION',
    text: 'LiquidityHQ is not affiliated with, endorsed by, or sponsored by any exchange or data provider referenced here. All trademarks belong to their respective owners.',
  },
];

export default function PlatformFooter() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  // Unlike NavDrawer/LandingContent/LearnContent, PlatformFooter's background
  // genuinely follows the app's light/dark toggle (no hardcoded bg on
  // .pf-footer), so its mark must track the real theme rather than a fixed
  // tone - the one surface in this rollout where that's actually true.
  const { theme } = useTheme();
  const { t } = useLabels();
  const { user, loading: authLoading } = useAuth();
  const { loaded: onboardingLoaded, loadError: onboardingFailed } = useOnboarding();
  if (pathname === '/' || pathname === '/login') return null;

  /* Do not paint the page's closing chrome before the page body exists.
   *
   * Most routes render nothing but a small header stub until auth resolves,
   * which takes roughly 800ms. During that window this footer - 296px, the
   * tallest single element on the page - sat at y=132 in a 900px viewport,
   * fully visible. The moment the real content mounted it was thrown below
   * the fold in one frame, and because CLS scores impact fraction times
   * distance moved, that one move was 82% of /arena's 0.365 total.
   *
   * Returning null here is the whole fix: with no footer in the pending
   * window there is nothing to move, and once auth settles the footer mounts
   * already below the fold. Mounting an element is not a layout shift, and
   * nothing renders after the footer for its arrival to push around.
   *
   * Tried and rejected first: min-height on .app-content to reserve a
   * viewport of space. It made things worse, not better - measured 0.76,
   * roughly double the baseline - because it turned .app-content itself into
   * a shifting element. Reserving space is the textbook CLS fix and it was
   * the wrong one here; the problem was never missing space, it was painting
   * the footer too early. */
  if (authLoading) return null;

  /* ... AND NOT BEFORE A SIGNED-IN VISITOR'S ONBOARDING STATE HAS LOADED (production /arena, signed in, CLS 0.906 and 1.037, #1263).
   * Auth settles first. Right after it, OnboardingGate is still showing a short stub for a signed-in account (it renders the real page only once the onboarding
   * read has finished), so the footer painted in view and was thrown below the fold when the page arrived about a second later: the same one-frame move as above,
   * one step later in the load. A failed read (`loadError`) is 'unknown', which the gate does not block on, so the footer does not wait for it either. */
  if (user && !onboardingLoaded && !onboardingFailed) return null;

  return (
    <footer className="pf-footer">

      {/* Top row - brand + nav */}
      <div className="pf-footer-top">
        <div className="pf-footer-brand" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <BrandMark size={40} tone={theme} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span className="pf-footer-logo">LiquidityHQ</span>
            <span className="pf-footer-tagline">{t('PF_TAGLINE')}</span>
          </div>
        </div>
        <nav className="pf-footer-nav">
          <Link href="/about" className="pf-footer-link">{t('PF_LINK_ABOUT')}</Link>
          <Link href="/faq" className="pf-footer-link">{t('PF_LINK_FAQ')}</Link>
          <Link href="/help" className="pf-footer-link">{t('PF_LINK_HELP')}</Link>
          <Link href="/learn" className="pf-footer-link">{t('PF_LINK_LEARN')}</Link>
          {/* #1810. The footer is the only route to these five from anywhere on
              the site, so leaving one out ships a page nothing links to. Ordered
              product-first then legal, matching the existing run. The labels are
              literals like every other entry here, not label keys. */}
          <Link href="/changelog" className="pf-footer-link">{t('PF_LINK_CHANGELOG')}</Link>
          <Link href="/status" className="pf-footer-link">{t('PF_LINK_STATUS')}</Link>
          <Link href="/security" className="pf-footer-link">{t('PF_LINK_SECURITY')}</Link>
          <Link href="/accessibility" className="pf-footer-link">{t('PF_LINK_ACCESSIBILITY')}</Link>
          <Link href="/terms" className="pf-footer-link">{t('PF_LINK_TERMS')}</Link>
          <Link href="/privacy" className="pf-footer-link">{t('PF_LINK_PRIVACY')}</Link>
          {/* Restored 2026-10-31. The link was pulled when /refund was withdrawn until payments
              went live (owner, 2026-10-08); payments went live 2026-10-28, so the condition the
              withdrawal named has fired. Placed in the legal run beside Terms and Privacy rather
              than at its former position, which is not recoverable from the history - the earlier
              markup differed, so there is nothing to restore it to. */}
          <Link href="/refund" className="pf-footer-link">{t('PF_LINK_REFUND')}</Link>
          <Link href="/disclaimer" className="pf-footer-link">{t('PF_LINK_DISCLAIMER')}</Link>
          <Link href="/contact" className="pf-footer-link">{t('PF_LINK_CONTACT')}</Link>
          {/* The support address itself, as a working link, on every page (owner, 2026-10-07). */}
          <a href={SUPPORT_MAILTO} className="pf-footer-link" data-testid="footer-support-email">{SUPPORT_EMAIL}</a>
        </nav>
      </div>

      {/* Risk disclosure section label */}
      <div className="pf-footer-divider">
        <span className="pf-footer-divider-label">{t('PF_RISK_LABEL')}</span>
        <div className="pf-footer-divider-line" />
      </div>

      {/* Unmissable financial disclaimer - exact required wording. Always shown,
          never gated behind the expand toggle below - only the elaborating
          6-item grid is collapsible (audit item #8: that grid repeated on
          every single page was a big scroll footprint on mobile). */}
      <p className="pf-footer-disclaimer">
        LiquidityHQ provides data analytics and software tools for informational purposes only.
        This is not financial, investment, or trading advice. Past performance does not guarantee
        future results. Trade at your own risk.
      </p>

      <button
        type="button"
        className="pf-footer-expand"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
      >
        {expanded ? t('PF_HIDE_DISCLOSURES') : t('PF_SHOW_DISCLOSURES')}
        <span aria-hidden="true" className={`pf-footer-expand-chevron${expanded ? ' up' : ''}`}>▾</span>
      </button>

      {/* Disclosure grid */}
      {expanded && (
        <div className="pf-footer-grid">
          {DISCLOSURES.map(item => (
            <div key={item.label} className="pf-footer-item">
              <div className="pf-footer-item-label">{t(item.headingKey)}</div>
              <p className="pf-footer-item-text">{item.labelKey ? t(item.labelKey) : item.text}</p>
            </div>
          ))}
        </div>
      )}

      {/* Acknowledgment + copyright */}
      <div className="pf-footer-bottom">
        <span>© {new Date().getFullYear()} LiquidityHQ. {t('PF_RIGHTS_RESERVED')}</span>
        <span className="pf-footer-bottom-note">
          By using LiquidityHQ, you acknowledge that you understand and agree to our{' '}
          <Link href="/disclaimer" className="pf-footer-bottom-link">Disclaimer</Link>,{' '}
          <Link href="/terms" className="pf-footer-bottom-link">Terms of Use</Link>, and{' '}
          <Link href="/privacy" className="pf-footer-bottom-link">Privacy Policy</Link>.
        </span>
      </div>

    </footer>
  );
}
