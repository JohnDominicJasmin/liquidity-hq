'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import type { LandingDict, Locale } from '@/lib/i18n/dictionaries';
import LandingTerminal from '@/components/LandingTerminal';

interface Props {
  dict: LandingDict;
  locale: Locale;
  dir: 'ltr' | 'rtl';
}

/* Terminal is the only design now (#1111, Pattern A - the last of the 8).
 * This file used to also branch on useDesignMode() and render current
 * design's own ~250-line marketing page JSX when it wasn't 'terminal'.
 * Deleted: this was the ONLY page in the app still doing anything
 * different under ?design=current at the time it collapsed - every other
 * Pattern A page had already lost that distinction. Collapsing this one
 * completes the set: ?design=current now renders unstyled Terminal markup
 * everywhere, not just on the other 7. See #1139's PR body for the full
 * finding and the owner-relayed ruling on why that's accepted.
 *
 * A stranger cannot reach the broken state: the only ways to ?design=current
 * are typing the param deliberately or carrying a stale stored preference,
 * and `/` has defaulted to terminal for real traffic since #748, same as
 * every other route (see NavDrawer.tsx's #714 comment). Production has none
 * of this queued regardless - the owner is holding every change from this
 * migration off main until it's complete.
 *
 * The redirect and body/lang/dir effects below stay here rather than moving
 * into LandingTerminal - they were never inside the deleted branch, they ran
 * unconditionally for both designs already. LandingTerminal has its own
 * duplicate of the body-class and lang/dir effect (harmless: both end up
 * setting the same values, and this component's cleanup runs after its
 * child's on unmount, so the final restored state is still correct). Not
 * worth de-duplicating as part of this PR - pre-existing, not introduced by
 * this collapse. */
export default function LandingContent({ dict, locale, dir }: Props) {
  const { user, loading } = useAuth();
  const router = useRouter();

  /* Redirect signed-in users straight to the app */
  useEffect(() => {
    if (!loading && user) router.replace('/arena');
  }, [user, loading, router]);

  /* Hide the app shell nav + ticker on this page, and set lang/dir for this
     locale variant - restored on unmount since the rest of the app is English/LTR. */
  useEffect(() => {
    document.body.classList.add('landing');
    const prevLang = document.documentElement.lang;
    const prevDir  = document.documentElement.dir;
    document.documentElement.lang = locale;
    document.documentElement.dir  = dir;
    return () => {
      document.body.classList.remove('landing');
      document.documentElement.lang = prevLang;
      document.documentElement.dir  = prevDir;
    };
  }, [locale, dir]);

  // `loading` starts true on both the server render and the client's first
  // hydration pass (Supabase's session check is async either way), so this
  // branch is identical on both sides - no hydration mismatch. It also means
  // the marketing page is never painted at all for a returning session.
  if (loading || user) {
    return (
      <div className="lp-loading" style={{ background: 'var(--bg0)' }}>
        <span
          className="lp-loading-logo"
          aria-hidden="true"
          style={{ color: 'var(--txt)', fontFamily: 'var(--font-mono), monospace' }}
        >
          LiquidityHQ
        </span>
        <span className="lp-loading-spin" aria-hidden="true" />
        <span className="sr-only" role="status">Loading your session…</span>
      </div>
    );
  }

  return <LandingTerminal dict={dict} locale={locale} dir={dir} />;
}
