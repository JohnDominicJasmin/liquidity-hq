import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Contact',
  /* A DESCRIPTION OF ITS OWN (SEO audit, PM 2026-11-20): every page without one inherited the root's sentence, so six legal and contact pages shared it. 140-160 characters. */
  description:
    'Contact LiquidityHQ by email for questions, support requests or feedback. The support address is listed on this page; use it for account and billing issues.',
  /* #1740: a SELF-REFERENCING canonical. Deliberately not set on the root layout, where it would be
     INHERITED by every page that does not define its own - so each of those would declare itself to
     be `/`, which is worse than having no canonical at all. One per page, or none. */
  alternates: { canonical: '/contact' },
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
