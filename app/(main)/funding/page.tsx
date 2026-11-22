import FundingTerminal from '@/components/FundingTerminal';
import SeoExplainer from '@/components/SeoExplainer';
import { faqJsonLd } from '@/lib/seoExplainers';

/* Terminal is the only design now (#1111, Pattern A). This route used to
 * branch on useDesignMode() and return one of two full JSX trees - the
 * current-design one lived here, inline, ~380 lines of it (per-coin funding
 * rate history, sparklines, full chart canvas drawing). FundingTerminal
 * renders with no props and is fully self-contained (its own canvas refs,
 * its own fetch/draw effects), so this route is now just the wrapper. Real
 * users have only ever seen FundingTerminal here since terminal became
 * default (#748). */
/* A SERVER COMPONENT NOW (SEO strategic item 1, PM 2026-11-20): the terminal is a client component and renders as before; the explainer and its FAQPage structured data sit under it so the server HTML carries real text. */
export default function FundingHistory() {
  return (
    <>
      <FundingTerminal />
      <SeoExplainer topic="funding" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLd('funding') }} />
    </>
  );
}
