import { BASE_URL } from '@/lib/structuredData';
import type { JsonLdGraph } from '@/lib/structuredData';

/* #1740 item 4: JSON-LD, of which the site had none on any page.
 *
 * A server component on purpose - this is markup a crawler reads on the first response, so it must not
 * wait for hydration. `JSON.stringify` of a value we built ourselves, never of anything from a request.
 *
 * `dangerouslySetInnerHTML` is the documented way to emit a JSON-LD block and there is no alternative that
 * produces valid output: React escapes `<` and `&` inside a text child, which turns a valid document into
 * an invalid one. The input is a typed object from lib/structuredData.ts, so nothing user-supplied reaches
 * it - and `<` is escaped below anyway, which is the one sequence that could close the script tag early. */
export default function StructuredData({ graph }: { graph: JsonLdGraph }) {
  const json = JSON.stringify(graph).replace(/</g, '\\u003c');
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}

export { BASE_URL };
