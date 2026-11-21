import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Security, Data Storage and Who Operates It', // the root template adds ' - LiquidityHQ'; the brand was doubled and the ampersand rendered as &amp; (SEO audit, PM 2026-11-20)
  description:
    'Who operates LiquidityHQ and how to reach them, which region your account data is stored in, how it is protected, and how to report a security problem.',
  /* A SELF-REFERENCING canonical, per the note in app/(main)/about/layout.tsx. */
  alternates: { canonical: '/security' },
};

export default function SecurityLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
