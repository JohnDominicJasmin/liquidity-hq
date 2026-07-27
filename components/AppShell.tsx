'use client';
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
import TimezoneSync from './TimezoneSync';
import PostHogProvider from './PostHogProvider';
import SettingsProvider from './SettingsProvider';
import OnboardingProvider from './OnboardingProvider';
import OnboardingGate from './OnboardingGate';
import SetupChecklist from './SetupChecklist';
import GrokUsageProvider from './GrokUsageProvider';
import PlatformFooter from './PlatformFooter';
import PWAInstallPrompt from './PWAInstallPrompt';
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
