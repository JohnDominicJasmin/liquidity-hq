'use client';
import DashboardTerminal from '@/components/DashboardTerminal';

/* Terminal is the only design now (#1111, Pattern A). This route used to
 * branch on useDesignMode() and return one of two full JSX trees - the
 * current-design one lived here, inline, ~600 lines of it. DashboardTerminal
 * renders with no props and is fully self-contained (its own data, its own
 * onboarding-tour handling via SpotlightTour/useOnboarding - checked before
 * deleting the copy that lived here, so nothing is lost), so this route is
 * now just the wrapper. */
export default function Dashboard() {
  return <DashboardTerminal />;
}
