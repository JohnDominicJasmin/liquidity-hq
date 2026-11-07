import StructuredData from '@/components/StructuredData';
import { glossaryGraph, breadcrumbGraph } from '@/lib/structuredData';

/* #1740: the glossary's structured data. Same shape as app/(main)/faq/layout.tsx - a layout carries the
 * graphs so `page.tsx` keeps owning the metadata, which matters here more than elsewhere: that file's
 * `openGraph` block REPLACES the root layout's rather than merging, and it has already lost its share image
 * once that way (#1740 item 3). Nothing in this file touches metadata.
 *
 * WHY /learn RATHER THAN A TOOL PAGE. It is 29 definitions of the exact terms people search for, which is
 * the only content on this site that answers an informational query. `DefinedTermSet` is what lets a term's
 * own `#slug` anchor surface as a result instead of the page as a whole.
 *
 * The graph is built from `GLOSSARY_FLAT`, so it tracks the `SHOW_PERFORMANCE_STATS` filter and cannot
 * describe a term the page does not render - see `glossaryGraph` for why that is the load-bearing part. */
export default function LearnLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <StructuredData graph={glossaryGraph()} />
      <StructuredData graph={breadcrumbGraph('Crypto Trading Glossary', '/learn')} />
      {children}
    </>
  );
}
