'use client';
import FundingTerminal from '@/components/FundingTerminal';

/* Terminal is the only design now (#1111, Pattern A). This route used to
 * branch on useDesignMode() and return one of two full JSX trees - the
 * current-design one lived here, inline, ~380 lines of it (per-coin funding
 * rate history, sparklines, full chart canvas drawing). FundingTerminal
 * renders with no props and is fully self-contained (its own canvas refs,
 * its own fetch/draw effects), so this route is now just the wrapper. Real
 * users have only ever seen FundingTerminal here since terminal became
 * default (#748). */
export default function FundingHistory() {
  return <FundingTerminal />;
}
