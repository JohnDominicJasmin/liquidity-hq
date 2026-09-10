'use client';
import { useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useNow } from '@/lib/useNow';
import { readPlanBadgeCache, writePlanBadgeCache } from '@/lib/planBadgeCache';

/* Persistent plan indicator, left of the avatar (#1089, owner-approved
 * design: https://claude.ai/code/artifact/646d7358-3951-4a5f-8e8b-6b9027eb033e).
 *
 * THE GAP THIS CLOSES: TrialBanner (mounted globally in AppShell) already
 * shows a countdown DURING an active trial - the moment isTrial goes false
 * (into Free, or into Pro), nothing on any screen names the plan again. The
 * owner's own paid account hit exactly that. This is the permanent
 * indicator; TrialBanner keeps its own job (time-bounded, urgent - trial
 * countdown, later a failed payment). Neither replaces the other.
 *
 * WEIGHT, NOT COLOUR separates the three states - the owner's own
 * reasoning: red and green are reserved for market direction throughout
 * this product, so spending them on account state would make a
 * subscription badge read as a price move. Grey outline (Free), amber
 * outline with a tabular day count (Trial), amber filled (Pro) - a ladder
 * that also survives greyscale and colour-blindness where colour alone
 * would not. Do not substitute colours for weights here.
 *
 * Renders nothing while auth is loading, signed out, OR the subscription
 * read is still in flight (`entitlementsLoading`) - there is no plan to show
 * for a visitor who has not signed in, and `role` defaults to 'free' before
 * that read settles. Skipping the third check would paint every Pro and
 * Trial account as FREE for one frame on each cold load: a paying customer
 * watching their own badge say the wrong thing, on the one component whose
 * entire job is saying this correctly (QA caught it testing #1090). An
 * absent badge for a moment is invisible; a wrong one is alarming - so this
 * waits rather than guesses.
 *
 * FAILED READ FALLBACK (#1089, owner ruling - option C, "go C"): the
 * subscription read can also fail outright (fast error response, reset, or
 * the bounded timeout AuthProvider now applies) rather than just being slow.
 * `role`/`trialEndsAt` still fall back to their free/null defaults on that
 * path (see AuthProvider's own comment on why that is not fixed there) -
 * left unguarded, this component would paint a real Pro/Trial account as
 * FREE, which is #1049's exact impression arriving through a different
 * door. The owner's ruling: on a failed read, show the last SUCCESSFULLY
 * resolved plan instead - a paying customer should not watch their status
 * vanish or downgrade because of a server blip, and the one downside (a
 * cancelled subscriber staying visually PRO a little longer) is accepted
 * knowingly, since real access is decided server-side regardless of what
 * this badge shows. Cold start with a failed read and nothing cached yet
 * falls back to blank, not FREE - blank beats a false statement about
 * someone's account, and this is the one case where absence is genuinely
 * the most honest answer available. */
export default function PlanBadge() {
  const { user, loading, role, isTrial, trialEndsAt, entitlementsLoading, entitlementsError } = useAuth();
  /* isTrial itself already flips off a live clock inside AuthProvider (one
     scheduled setTimeout at exactly trialEndsAt, not a poll) - every
     consumer of the context re-renders when that happens, this component
     included, so the Trial->Free transition needs nothing extra here.
     useNow is for the DAY COUNT specifically: without a ticking clock the
     "6D" computed at mount would go stale for as long as the tab stays
     open, the same bug useNow's own doc comment exists to prevent. Same
     60s interval TrialBanner already uses for the identical number. */
  const now = useNow(60_000);

  // Cache the LAST SUCCESSFUL resolution, per user, so a later failed read
  // has something honest to fall back to. Never caches a failure - writing
  // 'free' on an error is the exact bug this exists to avoid one layer up.
  useEffect(() => {
    if (!user || entitlementsLoading || entitlementsError) return;
    writePlanBadgeCache(user.id, { role, trialEndsAt });
  }, [user, entitlementsLoading, entitlementsError, role, trialEndsAt]);

  if (loading || !user || entitlementsLoading) return null;

  let displayRole = role;
  let displayTrialEndsAt = trialEndsAt;
  if (entitlementsError) {
    const cached = readPlanBadgeCache(user.id);
    if (!cached) return null; // cold start, nothing to fall back to - blank beats a false FREE
    displayRole = cached.role;
    displayTrialEndsAt = cached.trialEndsAt;
  }
  // Recomputed against the live clock even from cached data, same formula
  // AuthProvider uses for the real thing - a cached Trial whose window
  // actually elapses while showing a stale read still correctly flips to
  // Free rather than displaying an expired trial as still active.
  const displayIsTrial = entitlementsError
    ? displayRole !== 'pro' && displayTrialEndsAt !== null && displayTrialEndsAt > now
    : isTrial;

  if (displayIsTrial) {
    const daysLeft = displayTrialEndsAt != null
      ? Math.max(0, Math.ceil((displayTrialEndsAt - now) / 86_400_000))
      : null;
    return (
      <span className="plan-badge plan-badge-trial" title="Trial">
        {`TRIAL${daysLeft != null ? ` · ${daysLeft}D` : ''}`}
      </span>
    );
  }

  if (displayRole === 'pro') {
    return <span className="plan-badge plan-badge-pro" title="Pro">PRO</span>;
  }

  return <span className="plan-badge plan-badge-free" title="Free">FREE</span>;
}
