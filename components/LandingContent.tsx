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

  /* #1740: `loading` NO LONGER SUPPRESSES THE PAGE, and the hydration argument that justified it is
     what makes removing it safe.

     The old condition was `loading || user`. `loading` starts true on the server render AND on the
     client's first hydration pass, which is why the old branch could not mismatch - and that property
     belongs to the FLAG, not to what is rendered inside the branch. Rendering the marketing page in
     that state is identical on both sides for exactly the same reason.

     Why it had to change: the server therefore sent a spinner and nothing else to every visitor.
     Measured on production - `/` served 47 words and no <h1>, against /learn's 1,548 and one. Google
     runs JavaScript so Google mostly saw the page; AI assistants, Bing and link-preview bots did not.
     That is the half of the discovery surface the owner is about to spend money driving traffic to.

     What this costs, approved by the owner on 2026-10-24: a returning signed-in visitor may see the
     marketing page for a beat before the redirect below moves them to /arena. The `user` branch still
     covers the window between auth resolving and the redirect landing - it is only the UNRESOLVED
     state that now paints content instead of a spinner. */
  if (user) {
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
