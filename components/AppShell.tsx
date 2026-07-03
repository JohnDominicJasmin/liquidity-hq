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
import OnboardingTour from './OnboardingTour';
import SetupChecklist from './SetupChecklist';
import GrokUsageProvider from './GrokUsageProvider';
import PlatformFooter from './PlatformFooter';

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
                  <div className="app-content">
                    {children}
                    <PlatformFooter />
                  </div>
                  <GrokChat />
                  <OnboardingTour />
                  <SetupChecklist />
                </GrokUsageProvider>
              </OnboardingProvider>
            </NewsProvider>
          </MarketProvider>
        </SettingsProvider>
      </AuthProvider>
    </PostHogProvider>
  );
}
