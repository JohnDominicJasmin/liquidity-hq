'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { useOnboarding } from './OnboardingProvider';
import OnboardingFlow from './OnboardingFlow';

export default function OnboardingGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user } = useAuth();
  const { state, loaded } = useOnboarding();

  // Blocks every route behind onboarding, not just dashboard — a signed-in
  // user with an unresolved or incomplete profile must never reach app
  // content, wherever they navigate. `user` is null until /auth/callback's
  // own code exchange resolves, so this can't fire prematurely there.
  if (user && (!loaded || !state.profileComplete)) {
    // The spotlight tour targets dashboard-only DOM (data-spotlight-section,
    // .mb-glow-card), so route there to start it rather than trying to run
    // it over whatever page the user happened to finish onboarding on.
    return <OnboardingFlow onStartTour={() => router.push('/dashboard?tour=1')} />;
  }

  return <>{children}</>;
}
