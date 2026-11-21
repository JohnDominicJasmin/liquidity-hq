import type { Metadata } from 'next';
import SeoExplainer from '@/components/SeoExplainer';
import { faqJsonLd } from '@/lib/seoExplainers';

export const metadata: Metadata = {
  title: 'Crypto Trading Sessions',
  description:
    'Which hours of the day and days of the week actually see volume and volatility in crypto, broken down by trading session.',
  /* #1740: a SELF-REFERENCING canonical. Deliberately not set on the root layout, where it would be
     INHERITED by every page that does not define its own - so each of those would declare itself to
     be `/`, which is worse than having no canonical at all. One per page, or none. */
  alternates: { canonical: '/hours' },
};

/* A SERVER-RENDERED EXPLAINER AND FAQPage DATA UNDER THE PAGE (SEO strategic item 1, PM 2026-11-20): the layout is a server component, so the text is in the HTML a crawler reads; the page itself is unchanged. */
export default function HoursLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <SeoExplainer topic="hours" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLd('hours') }} />
    </>
  );
}
