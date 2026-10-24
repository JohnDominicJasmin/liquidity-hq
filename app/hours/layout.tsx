import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Best Hours to Trade Crypto - Volatility by Session',
  description:
    'Which hours of the day and days of the week actually see volume and volatility in crypto, broken down by trading session.',
};

export default function HoursLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
