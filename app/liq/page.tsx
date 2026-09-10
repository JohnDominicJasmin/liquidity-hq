'use client';
import LiqTerminal from '@/components/LiqTerminal';

/* Terminal is the only design now (#1111, Pattern A). This route used to
 * branch on useDesignMode() and return one of two full JSX trees - the
 * current-design one lived here, inline, ~650 lines of it (band estimation,
 * whale/retail/Bybit positioning fetches). LiqTerminal renders with no props
 * and is fully self-contained, so this route is now just the wrapper. Real
 * users have only ever seen LiqTerminal here since terminal became default
 * (#748). */
export default function LiqPage() {
  return <LiqTerminal />;
}
