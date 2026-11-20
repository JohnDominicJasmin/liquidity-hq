import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  /* A DESCRIPTION OF ITS OWN (SEO audit, PM 2026-11-20): every page without one inherited the root's sentence, so six legal and contact pages shared it. 140-160 characters. */
  description:
    'How LiquidityHQ handles your data: what we collect, how it is used, stored and protected, which third-party services process it, and your rights.',
  /* #1740: a SELF-REFERENCING canonical. Deliberately not set on the root layout, where it would be
     INHERITED by every page that does not define its own - so each of those would declare itself to
     be `/`, which is worse than having no canonical at all. One per page, or none. */
  alternates: { canonical: '/privacy' },
};

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
