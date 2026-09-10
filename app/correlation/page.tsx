'use client';
import CorrelationTerminal from '@/components/CorrelationTerminal';

/* Terminal is the only design now (#1111, Pattern A). This route used to
 * branch on useDesignMode() and return one of two full JSX trees - the
 * current-design one lived here, inline, ~400 lines of it (correlation
 * matrix, ranked pairs, alt-season signal, its own fetchCloses()).
 * CorrelationTerminal renders with no props and has its own independent
 * copy of every one of those (confirmed - both files' fetchCloses were
 * already migrated to the shared retry helper together, #1100), so this
 * route is now just the wrapper. Real users have only ever seen
 * CorrelationTerminal here since terminal became default (#748). */
export default function CorrelationHeatmap() {
  return <CorrelationTerminal />;
}
