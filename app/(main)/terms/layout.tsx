import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Use',
  /* A DESCRIPTION OF ITS OWN (SEO audit, PM 2026-11-20): every page without one inherited the root's sentence, so six legal and contact pages shared it. 140-160 characters. */
  description:
    'The terms of use for LiquidityHQ: what the service provides, subscriptions and billing, cancellation and refunds, prohibited uses and limits of liability.',
  /* #1740: a SELF-REFERENCING canonical. Deliberately not set on the root layout, where it would be
     INHERITED by every page that does not define its own - so each of those would declare itself to
     be `/`, which is worse than having no canonical at all. One per page, or none. */
  alternates: { canonical: '/terms' },
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
