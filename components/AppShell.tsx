'use client';
import { useEffect } from 'react';
import MarketProvider from './MarketProvider';
import NewsProvider from './NewsProvider';
import NavDrawer from './NavDrawer';
import GrokChat from './GrokChat';
import NewsTicker from './NewsTicker';
import AuthProvider from './AuthProvider';
import PostHogProvider from './PostHogProvider';
import SettingsProvider from './SettingsProvider';
import OnboardingProvider from './OnboardingProvider';
import OnboardingGate from './OnboardingGate';
import OnboardingTour from './OnboardingTour';
import SetupChecklist from './SetupChecklist';
import GrokUsageProvider from './GrokUsageProvider';
import PlatformFooter from './PlatformFooter';
import PWAInstallPrompt from './PWAInstallPrompt';

export default function AppShell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    try {
      const t = localStorage.getItem('theme') || 'dark';
      document.documentElement.setAttribute('data-theme', t);
    } catch {}
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  return (
    <PostHogProvider>
      <AuthProvider>
        <SettingsProvider>
          <MarketProvider>
            <NewsProvider>
              <OnboardingProvider>
                <GrokUsageProvider>
                  <NavDrawer />
                  <NewsTicker />
                  <main className="app-content">
                    <OnboardingGate>{children}</OnboardingGate>
                    <PlatformFooter />
                  </main>
                  <GrokChat />
                  <OnboardingTour />
                  <SetupChecklist />
                  <PWAInstallPrompt />
                </GrokUsageProvider>
              </OnboardingProvider>
            </NewsProvider>
          </MarketProvider>
        </SettingsProvider>
      </AuthProvider>
    </PostHogProvider>
  );
}
