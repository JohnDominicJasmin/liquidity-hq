'use client';
import BriefingTerminal from '@/components/BriefingTerminal';

/* Terminal is the only design now (#1111, Pattern A). This route used to
 * branch on useDesignMode() and return one of two full JSX trees - the
 * current-design one lived here, inline, ~680 lines of it, including its own
 * copy of buildBriefingContext() and all the AI-brief/JPY-rate state.
 * BriefingTerminal renders with no props and has its own independent copy of
 * every one of those (same hook shapes, same sessionStorage keys, its own
 * buildBriefingContext) - checked before deleting the copy that lived here,
 * so nothing is lost, since real users have only ever seen BriefingTerminal
 * here since terminal became default (#748). */
export default function MorningBriefing() {
  return <BriefingTerminal />;
}
