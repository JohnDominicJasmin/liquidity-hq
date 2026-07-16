'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { useOnboarding } from './OnboardingProvider';
import OnboardingFlow from './OnboardingFlow';

export default function OnboardingGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user } = useAuth();
  const { state, loaded, requestTour } = useOnboarding();

  // Blocks every route behind onboarding, not just dashboard — a signed-in
  // user with an unresolved or incomplete profile must never reach app
  // content, wherever they navigate. `user` is null until /auth/callback's
  // own code exchange resolves, so this can't fire prematurely there.
  if (user && (!loaded || !state.profileComplete)) {
    // The spotlight tour targets dashboard-only DOM (data-spotlight-section,
    // .mb-glow-card), so route there to start it rather than trying to run
    // it over whatever page the user happened to finish onboarding on.
    // requestTour() flips a flag in OnboardingProvider (read by Dashboard on
    // mount) instead of a ?tour=1 query param — markDone('profileComplete')
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
