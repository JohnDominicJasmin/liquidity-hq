'use client';
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

export default function AppShell({ children }: { children: React.ReactNode }) {
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
                  <div className="app-content">{children}</div>
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
