/* Per-user, display-only cache of the last successfully-resolved plan, for
 * PlanBadge specifically (#1089) - the owner's ruling (option C) on what a
 * failed entitlement read should show: the last known answer, not a false
 * "FREE" and not blank if something better is available.
 *
 * DISPLAY ONLY. Nothing reads this to decide access - real entitlement
 * still comes from AuthProvider's own `entitled` on every render, unaffected
 * by anything here. A cached value that could satisfy an entitlement check
 * would be a client-side paywall bypass; this module has no such consumer
 * and must never grow one. If a future change makes anything but PlanBadge
 * import from this file, that's the review to stop at.
 *
 * Keyed per user id and cleared by AuthProvider on sign-out - a remembered
 * PRO surviving into the next account signed in on the same browser would be
 * a real defect, not a cosmetic one. Sign-out is the one thing this module
 * exposes to a file other than PlanBadge, and only as a cleanup call. */

export interface CachedPlan {
  role: 'free' | 'pro';
  trialEndsAt: number | null;
}

function key(userId: string): string {
  return `lhq_plan_badge_cache_${userId}`;
}

export function readPlanBadgeCache(userId: string): CachedPlan | null {
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedPlan>;
    if (parsed.role !== 'free' && parsed.role !== 'pro') return null;
    return { role: parsed.role, trialEndsAt: typeof parsed.trialEndsAt === 'number' ? parsed.trialEndsAt : null };
  } catch {
    return null; // corrupt entry or storage unavailable - same as no cache
  }
}

export function writePlanBadgeCache(userId: string, plan: CachedPlan): void {
  try {
    localStorage.setItem(key(userId), JSON.stringify(plan));
  } catch { /* storage unavailable (private mode, quota) - badge just won't have a fallback next time */ }
}

export function clearPlanBadgeCache(userId: string): void {
  try {
    localStorage.removeItem(key(userId));
  } catch { /* nothing to do if storage itself is unavailable */ }
}
