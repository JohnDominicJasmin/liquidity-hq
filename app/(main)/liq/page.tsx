import LiqTerminal from '@/components/LiqTerminal';
import SeoExplainer from '@/components/SeoExplainer';
import { faqJsonLd } from '@/lib/seoExplainers';

/* Terminal is the only design now (#1111, Pattern A). This route used to
 * branch on useDesignMode() and return one of two full JSX trees - the
 * current-design one lived here, inline, ~650 lines of it (band estimation,
 * whale/retail/Bybit positioning fetches). LiqTerminal renders with no props
 * and is fully self-contained, so this route is now just the wrapper. Real
 * users have only ever seen LiqTerminal here since terminal became default
 * (#748). */
/* A SERVER COMPONENT NOW (SEO strategic item 1, PM 2026-11-20): the terminal is a client component and renders as before; the explainer and its FAQPage structured data sit under it so the server HTML carries real text. */
export default function LiqPage() {
  return (
    <>
      <LiqTerminal />
      <SeoExplainer topic="liq" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLd('liq') }} />
    </>
  );
}
