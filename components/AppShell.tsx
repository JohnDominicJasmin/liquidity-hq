'use client';
/* LANDING HARD GATE - this file is one of the files that trips it.

   Changing this file requires that LANDING (`/`) IS RENDERED and confirmed
   unchanged in every reachable context - docs/HANDOVER.md section 14 names how
   many, and the number has drifted before - before the PR merges. Not "the selectors cannot reach landing", not "the diff is
   additive": rendered. The rule and its history live in docs/HANDOVER.md
   section 14 (search: "landing renders identically"); this is a signpost, not a
   second copy of it.

   WHY THIS FILE. The owner keeps the canvas-mirrored landing (#592) and it was
   deliberately excluded from the 2026-09-03 revert. These files are shared
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
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import MarketProvider from './MarketProvider';
import NewsProvider from './NewsProvider';
import NavDrawer from './NavDrawer';
import dynamic from 'next/dynamic';
/* The Ask AI chat (and the strategy registry it reads) is loaded after the page, not with it: it was in the first-load JavaScript of every route (speed audit 2026-11-17). Client only; the floating button appears once its chunk arrives. */
const GrokChat = dynamic(() => import('./GrokChat'), { ssr: false });
import NewsTicker from './NewsTicker';
import AuthProvider from './AuthProvider';
import LabelsProvider from './LabelsProvider';
import LanguageSync from './LanguageSync';
import LanguageNavSwitcher from './LanguageNavSwitcher';
import TimezoneSync from './TimezoneSync';
import PostHogProvider from './PostHogProvider';
import SettingsProvider from './SettingsProvider';
import SettingsSaveToast from './SettingsSaveToast';
import OfflineNotice from './OfflineNotice';
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
import { ProLockProvider } from './UpgradeGateModal';
import { useAppConfig } from '@/lib/useAppConfig';
import { MARKET_DATA_NEEDED_EVENT } from '@/lib/marketDataNeeded';

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

/* PAGES THAT SHOW NO MARKET DATA (OWNER-RULES 21, #1651 server-slowness audit). The provider used to run on every page, /about and /privacy included: ~16 API calls per load
   that also kept the server's shared caches refreshing for a reader who looked at no number. An OPT-OUT list on purpose (the provider's own contract: a route opts out deliberately,
   so a new data page never silently loses its data). Exact match after trimming a trailing slash. The Ask-AI chat reads the store, so opening it turns the provider on. */
const DATA_FREE_ROUTES = ['/about', '/faq', '/privacy', '/terms', '/changelog', '/help', '/learn', '/contact', '/disclaimer', '/refund', '/security', '/accessibility', '/status', '/offline', '/hours'];
const isDataFree = (pathname: string) => DATA_FREE_ROUTES.includes(pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname);

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const config = useAppConfig();
  const [marketNeeded, setMarketNeeded] = useState(false);
  /* THE LANDING PAGE STARTS ITS MARKET FEEDS AFTER FIRST PAINT (speed audit 2026-11-17: '/' fired about 40 data requests before the page had painted, on a connection that moves about 50 KB a second, and they delayed the one stylesheet the text waits for). Other pages are unchanged. */
  const [landingFeedsReady, setLandingFeedsReady] = useState(false);
  useEffect(() => {
    if (pathname !== '/') return;
    const start = () => setLandingFeedsReady(true);
    const idle = () => {
      const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
      /* At most 1 s after load (PM 2026-11-19, speed target: data on / within 8 s on 4G + 4x CPU). The hero's beams leave a 4x-throttled
         phone almost no idle time, so the old 3 s timeout was what the feeds actually waited for. The text has painted by `load`. */
      if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(start, { timeout: 1000 });
      else setTimeout(start, 1000);
    };
    if (document.readyState === 'complete') idle();
    else { window.addEventListener('load', idle, { once: true }); return () => window.removeEventListener('load', idle); }
  }, [pathname]);
  useEffect(() => {
    const on = () => setMarketNeeded(true);
    window.addEventListener(MARKET_DATA_NEEDED_EVENT, on);
    return () => window.removeEventListener(MARKET_DATA_NEEDED_EVENT, on);
  }, []);

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
              <SettingsSaveToast />
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
            <MarketProvider enabled={(marketNeeded || !isDataFree(pathname)) && (pathname !== '/' || landingFeedsReady)}>
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
                      <ProLockProvider key={pathname}><OnboardingGate>{children}</OnboardingGate></ProLockProvider>
                      <PlatformFooter />
                    </main>
                    <GrokChat />
                    <SetupChecklist />
                    <PWAInstallPrompt />
                    <CookieConsent />
                    <SettingsSaveToast />
                    <OfflineNotice />
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
