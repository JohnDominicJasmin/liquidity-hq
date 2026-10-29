'use client';
import ScannerTerminal from '@/components/ScannerTerminal';

/* Terminal is the only design now (#1111, Pattern A). This route used to
 * branch on useDesignMode() and return one of two full JSX trees - the
 * current-design one lived here, inline, as a simple composition of
 * AccumulationTracker/DistributionTracker/CoinHeatmap/etc with no extra
 * state of its own. ScannerTerminal renders with no props and is fully
 * self-contained, so this route is now just the wrapper. Real users have
 * only ever seen ScannerTerminal here since terminal became default
 * (#748). */
export default function ScannerPage() {
  return <ScannerTerminal />;
}
