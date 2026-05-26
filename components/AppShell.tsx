'use client';
import MarketProvider from './MarketProvider';
import NewsProvider from './NewsProvider';
import NavDrawer from './NavDrawer';
import BreakingAlert from './BreakingAlert';

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <MarketProvider>
      <NewsProvider>
        <NavDrawer />
        <BreakingAlert />
        <div className="app-content">{children}</div>
      </NewsProvider>
    </MarketProvider>
  );
}
