'use client';
import MarketProvider from './MarketProvider';
import NewsProvider from './NewsProvider';
import NavDrawer from './NavDrawer';

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <MarketProvider>
      <NewsProvider>
        <NavDrawer />
        <div className="app-content">{children}</div>
      </NewsProvider>
    </MarketProvider>
  );
}
