'use client';
import MarketProvider from './MarketProvider';
import NewsProvider from './NewsProvider';
import NavDrawer from './NavDrawer';
import GrokChat from './GrokChat';
import NewsTicker from './NewsTicker';
import AuthProvider from './AuthProvider';
import PostHogProvider from './PostHogProvider';
import SettingsProvider from './SettingsProvider';

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <PostHogProvider>
      <AuthProvider>
        <SettingsProvider>
          <MarketProvider>
            <NewsProvider>
              <NavDrawer />
              <NewsTicker />
              <div className="app-content">{children}</div>
              <GrokChat />
            </NewsProvider>
          </MarketProvider>
        </SettingsProvider>
      </AuthProvider>
    </PostHogProvider>
  );
}
