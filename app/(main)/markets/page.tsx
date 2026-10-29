'use client';
import MarketsTerminal from '@/components/MarketsTerminal';

/* Terminal is the only design now (#1111, Pattern A). This route used to
 * branch on useDesignMode() and return one of two full JSX trees - the
 * current-design one lived here, inline, ~380 lines of it (search/sort/
 * pagination over the coin table). MarketsTerminal renders with no props
 * and is fully self-contained, so this route is now just the wrapper. Real
 * users have only ever seen MarketsTerminal here since terminal became
 * default (#748). */
export default function MarketsPage() {
  return <MarketsTerminal />;
}
