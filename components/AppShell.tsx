'use client';
/* LANDING HARD GATE - this file is one of four that trips it.

   Changing this file requires that LANDING (`/`) IS RENDERED and confirmed
   unchanged in FOUR CONTEXTS - current/terminal x dark/light - before the PR
   merges. Not "the selectors cannot reach landing", not "the diff is
   additive": rendered. The rule and its history live in docs/HANDOVER.md
   section 14 (search: "landing renders identically"); this is a signpost, not a
   second copy of it.

   WHY THIS FILE. The owner keeps the canvas-mirrored landing (#592) and it was
   deliberately excluded from the 2026-09-03 revert. These four files are shared
   between landing and the reverted screens, so a change aimed at an app screen
   reaches landing too. AppShell.tsx is the one that bit us - it rendered
   PriceTickerStrip on `/` gated on design mode rather than pathname.

   The reason is written down because a guard whose reason is invisible gets
   deleted by the next reader - see app/globals.css:597, removed on the strength
   of a comment that had gone stale, which reinstated the defect it described.

   Missed twice in two days (#871, #883) by authors who had read HANDOVER, both
   times because they verified what they CHANGED rather than what the gate
   PROTECTS. That is why this sits here rather than only in a document. #873.
   ───────────────────────────────────────────────────────────────────── */
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import MarketProvider from './MarketProvider';
import NewsProvider from './NewsProvider';
import NavDrawer from './NavDrawer';
import GrokChat from './GrokChat';
import NewsTicker from './NewsTicker';
import AuthProvider from './AuthProvider';
import LabelsProvider from './LabelsProvider';
import LanguageSync from './LanguageSync';
import LanguageNavSwitcher from './LanguageNavSwitcher';
import TimezoneSync from './TimezoneSync';
import PostHogProvider from './PostHogProvider';
import SettingsProvider from './SettingsProvider';
import OnboardingProvider from './OnboardingProvider';
import OnboardingGate from './OnboardingGate';
import SetupChecklist from './SetupChecklist';
import GrokUsageProvider from './GrokUsageProvider';
import PlatformFooter from './PlatformFooter';
import PWAInstallPrompt from './PWAInstallPrompt';
import CookieConsent from './CookieConsent';
import MaintenanceScreen from './MaintenanceScreen';
import AnnouncementBanner from './AnnouncementBanner';
import TrialBanner from './TrialBanner';
import { useAppConfig } from '@/lib/useAppConfig';

// The admin console (/ops) has its own layout/shell and must NOT inherit any of
// the consumer chrome - nav drawer, news ticker, risk-disclosure footer, the
// Ask-AI floating button, onboarding tour/checklist, PWA prompt - nor the
// market/news polling providers it never uses. It renders inside a bare shell
// with only the providers it genuinely needs: auth (the gate reads the session)
// and analytics. Scoped to /ops only, so the /admin honeypot's 404 stays visually
// identical to any other 404.
const isChromeless = (pathname: string) => pathname === '/ops' || pathname.startsWith('/ops/');


/* Auth screens get the same treatment, for a different reason. /login used to
   render inside the full consumer shell, so a signed-OUT stranger arriving at
   the sign-in page was handed the nav drawer, the scrolling news ticker, the
   floating Ask-AI button and the coin rail - every one of which either bounces
   them straight back to /login or shows "Sign in to use LiquidityAI". The one
   task on the page was competing with a dozen dead controls, on the first
   screen of the product.
   Also drops MarketProvider/NewsProvider, which were opening market feeds and a
   Realtime subscription for a page that renders a form.

   Exact match, not endsWith: the only locale-prefixed route in the app is the
   marketing landing page (app/[locale]/page.tsx - that segment holds nothing
   else), so there is no /ar/login for a suffix match to catch. What endsWith
   would catch is a future route that merely ends in one of these words -
   /help/reset-password would silently lose the whole app shell, and the symptom
   (a page rendering with no nav) looks nothing like its cause. */
const AUTH_ROUTES = ['/login', '/forgot-password', '/reset-password', '/auth/callback'];
const isAuthRoute = (pathname: string) => AUTH_ROUTES.includes(pathname);

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const config = useAppConfig();

  useEffect(() => {
    try {
      const t = localStorage.getItem('theme') || 'dark';
      document.documentElement.setAttribute('data-theme', t);
    } catch {}
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  if (isChromeless(pathname)) {
    return (
      <PostHogProvider>
        <LabelsProvider>
          <AuthProvider>{children}</AuthProvider>
        </LabelsProvider>
      </PostHogProvider>
    );
  }

  // App-wide kill switch (see /ops/config). /ops itself is exempt (handled by
  // the branch above) so an owner can always reach the toggle to turn it back off.
  if (config?.maintenanceMode) {
    return (
      <PostHogProvider>
        <LabelsProvider>
          <MaintenanceScreen />
        </LabelsProvider>
      </PostHogProvider>
    );
  }

  /* Deliberately AFTER the maintenance check, unlike /ops: the owner must always
     be able to reach /ops to switch maintenance back off, but a normal user
     hitting /login during maintenance should see the maintenance screen, not a
     working sign-in form for an app that is down. */
  if (isAuthRoute(pathname)) {
    return (
      <PostHogProvider>
        <LabelsProvider>
          <AuthProvider>
            {/* SettingsProvider only reads auth + localStorage, no market feeds -
                it is here because the language switcher and LanguageSync both
                need it. Dropping the nav must not cost a non-English visitor the
                only language control on the first screen they see. */}
            <SettingsProvider>
              <LanguageSync />
              <div className="auth-shell">
                <div className="auth-shell-lang"><LanguageNavSwitcher /></div>
                {children}
              </div>
              {/* Also on the auth screens: analytics fires here too, and this
                  is often the first page a visitor lands on. */}
              <CookieConsent />
            </SettingsProvider>
          </AuthProvider>
        </LabelsProvider>
      </PostHogProvider>
    );
  }

  return (
    <PostHogProvider>
      <LabelsProvider>
        <AuthProvider>
          <SettingsProvider>
            <MarketProvider>
              <NewsProvider>
                <OnboardingProvider>
                  <GrokUsageProvider>
                    <LanguageSync />
                    <TimezoneSync />
                    <AnnouncementBanner banner={config?.announcementBanner ?? null} />
                    <NavDrawer />
                    <NewsTicker />
                    <main className="app-content">
                      <TrialBanner />
                      <OnboardingGate>{children}</OnboardingGate>
                      <PlatformFooter />
                    </main>
                    <GrokChat />
                    <SetupChecklist />
                    <PWAInstallPrompt />
                    <CookieConsent />
                  </GrokUsageProvider>
                </OnboardingProvider>
              </NewsProvider>
            </MarketProvider>
          </SettingsProvider>
        </AuthProvider>
      </LabelsProvider>
    </PostHogProvider>
  );
}
