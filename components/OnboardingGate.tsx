'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { useOnboarding } from './OnboardingProvider';
import OnboardingFlow from './OnboardingFlow';

export default function OnboardingGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user } = useAuth();
  const { state, loaded, loadError, requestTour } = useOnboarding();
  /* ONE-WAY (arena layout shift, #1263). The session read resolves a moment AFTER the first paint, so `user` is null on the first render and the page renders; when the user then arrives with the
     onboarding read still in flight, the old gate swapped the whole page for the 'Setting up your account' stub and back, which re-created every panel (QA probe, run 43649222730: arena-term-wrap
     mounted twice, +0.029 to +0.095). Once the page has rendered it is never taken away for an UNRESOLVED read: the stub is for a mount that begins with the user already known. A resolved
     incomplete profile still gets the wizard, and a failed read still does not block. */
  const [pageRendered, setPageRendered] = useState(false);
  const showStub = !!user && !loadError && !loaded && !pageRendered;
  const showWizard = !!user && !loadError && loaded && !state.profileComplete;
  useEffect(() => { if (!showStub && !showWizard) setPageRendered(true); }, [showStub, showWizard]);

  // Blocks every route behind onboarding, not just dashboard - a signed-in
  // user with an unresolved or incomplete profile must never reach app
  // content, wherever they navigate. `user` is null until /auth/callback's
  // own code exchange resolves, so this can't fire prematurely there.
  //
  // #1309 item 13: `loadError` is checked first and short-circuits the
  // whole gate. Without it, a failed read left `state.profileComplete` at
  // its default `false` with `loaded` true - indistinguishable from a
  // genuinely new user - so an already-onboarded user hit by a transient
  // DB error got dropped back into the 5-step wizard on every route. A
  // failed read means unknown, not incomplete; unknown must not block.
  if (showStub || showWizard) {
    // The spotlight tour targets dashboard-only DOM (data-spotlight-section,
    // .mb-glow-card), so route there to start it rather than trying to run
    // it over whatever page the user happened to finish onboarding on.
    // requestTour() flips a flag in OnboardingProvider (read by Dashboard on
    // mount) instead of a ?tour=1 query param - markDone('profileComplete')
    // and this navigation both fire inside the same finish() call, and
    // there's no guarantee the pushed URL lands before Dashboard's mount
    // effect runs, so a query param the effect reads once on mount can lose
    // that race and silently never show the tour. Context state is visible
    // to Dashboard the instant it first renders, regardless of navigation
    // timing.
    return <OnboardingFlow onStartTour={() => { requestTour(); router.push('/dashboard'); }} />;
  }

  return <>{children}</>;
}
