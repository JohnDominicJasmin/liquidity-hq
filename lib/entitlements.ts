// Shared server-side subscription-role lookup - extracted from what was three
// separate copy-pasted copies (grok, grok-chat, briefing routes). Reads through
// a user-scoped Supabase client (RLS: "sub_select_own") so a token can only
// ever read its own role, never someone else's.
import { T } from '@/lib/tables';
import type { UsageTier } from '@/lib/limits';
import { paidPeriodLapsed } from '@/lib/paidPeriod';
import { getUserCompat } from '@/lib/authUser';
import { userClient } from '@/lib/supabase-user';

/* Re-exported so call sites keep one import. The logic lives in lib/paidPeriod
   because this file cannot be unit-tested - see the note at the top of it. */
export { paidPeriodLapsed, PAID_GRACE_MS } from '@/lib/paidPeriod';

export type Role = 'free' | 'pro';

function sb(token: string) {
  return userClient(token);
}

export interface Entitlement {
  role:        Role;    // the PAID role ('pro' only after a real subscription)
  trialActive: boolean; // inside the 14-day signup trial window
  // Whether Pro FEATURES are unlocked (paid Pro OR active trial). This is the
  // gate for feature access - fast timeframes, backtest, on-chain/macro, etc.
  //
  // The daily AI usage caps are deliberately NOT keyed off this. They key off
  // `usageTierOf()` below, which has THREE values - a trial user is billed
  // against the `trial` row in AI_LIMITS, not the `free` one.
  //
  // This comment said "a trial user keeps Free-tier AI limits" until 2026-08-08.
  // That was the behaviour before the trial row existed and it survived the fix
  // that removed it, four lines above the function that disproves it. QA read it
  // and was about to assert `limits === FREE_LIMITS` for a trial user - an
  // assertion that passes only if the old bug comes back, so the test would have
  // defended the regression instead of catching it.
  //
  // The rows differ where it counts: `free` has toolPool null and every extra
  // tool at 0; `trial` has toolPool 8 and every extra tool at 8. Same headline
  // quick/deep/chat numbers, which is what makes the two easy to confuse.
  proFeatures: boolean;
}

// Reads role, trial_ends_at and current_period_end in one RLS-scoped query (a
// token can only ever read its own row). `failed` is reported alongside rather
// than folded in: getEntitlement() below has always resolved a failed read to
// free, and every existing Pro gate relies on that to fail closed, so only
// getEntitlementStatus() reads it.
async function readEntitlement(token: string, userId: string): Promise<{ entitlement: Entitlement; failed: boolean }> {
  const { data, error } = await sb(token).from(T.user_subscriptions)
    .select('role, trial_ends_at, current_period_end')
    .eq('user_id', userId)
    .maybeSingle();
  const stored: Role = data?.role === 'pro' ? 'pro' : 'free';
  // The backstop runs BEFORE trialActive is computed, so a lapsed paid account
  // falls back to whatever its trial window says rather than straight to free.
  const lapsed = paidPeriodLapsed(stored, data?.current_period_end as string | null);
  const role: Role = lapsed ? 'free' : stored;
  const trialEnds = data?.trial_ends_at ? new Date(data.trial_ends_at as string).getTime() : 0;
  const trialActive = role !== 'pro' && trialEnds > Date.now();
  return { entitlement: { role, trialActive, proFeatures: role === 'pro' || trialActive }, failed: !!error };
}

// Single source of truth for "does this token get Pro features". A failed read
// comes back as free - see getEntitlementStatus() for a gate that must not
// treat that as a confirmed answer.
export async function getEntitlement(token: string, userId: string): Promise<Entitlement> {
  return (await readEntitlement(token, userId)).entitlement;
}

// The server-side counterpart of AuthProvider's EntitlementStatus (#1119), same
// three values. getEntitlement() cannot say 'unknown': an errored read and a
// real free account both come back as proFeatures false. A missing
// row is NOT a failure - maybeSingle() returns no error for it, and an account
// with no subscription row really is free (lib/signupIntegrity.ts).
export type EntitlementStatus = 'entitled' | 'not_entitled' | 'unknown';

export async function getEntitlementStatus(token: string, userId: string): Promise<EntitlementStatus> {
  try {
    const { entitlement, failed } = await readEntitlement(token, userId);
    if (failed) return 'unknown';
    return entitlement.proFeatures ? 'entitled' : 'not_entitled';
  } catch {
    return 'unknown';
  }
}

// Convenience for feature-gate routes: true if paid Pro or in an active trial.
export async function hasProFeatures(token: string, userId: string): Promise<boolean> {
  return (await getEntitlement(token, userId)).proFeatures;
}

// Which AI_LIMITS row this caller is billed against. NOT the same as `role`:
// a trial user is role='free' but has its own limits row, because billing a
// trial against the free row is what made the free numbers secretly mean
// "trial" (see the long comment in lib/limits.ts). Anything that picks a
// usage limit must use this; anything that asks "have they PAID us" - the
// /upgrade sell, billing copy - must keep using `role`.
export function usageTierOf(e: Entitlement): UsageTier {
  return e.role === 'pro' ? 'pro' : e.trialActive ? 'trial' : 'free';
}

// getUsageTier() plus whether the read FAILED, for a gate that must tell "this account is Free" from "I could not find out" (#1596, the coin
// ladder on /api/grok). A failed read still resolves to 'free' here, as getEntitlement() always has, so the caller decides what a failure means.
export async function getUsageTierStatus(token: string, userId: string): Promise<{ tier: UsageTier; failed: boolean }> {
  try {
    const { entitlement, failed } = await readEntitlement(token, userId);
    return { tier: usageTierOf(entitlement), failed };
  } catch {
    return { tier: 'free', failed: true };
  }
}

// The usage tier for a call site that is choosing a USAGE LIMIT: 'trial' is its
// own value, never collapsed onto 'free'. Every AI route should use this. (The
// role-only getUserRole / getRoleFromRequestToken helpers are gone (#1630): they
// had no callers and read the stored role without the paid-period rule, a trap
// for the next route. "Has this account paid" is getEntitlement().role.)
export async function getUsageTier(token: string, userId: string): Promise<UsageTier> {
  return usageTierOf(await getEntitlement(token, userId));
}

// getEntitlementStatus() for a route that serves anyone but withholds the Pro
// part (#1263, /api/market/rsi). No token, or a token that resolves to no
// user, is 'not_entitled': there is no account to be Pro. Only a read that
// throws is 'unknown', for the same #1119 reason getEntitlementStatus() gives.
export async function getEntitlementStatusFromRequestToken(token: string | null | undefined): Promise<EntitlementStatus> {
  if (!token) return 'not_entitled';
  try {
    const { data } = await getUserCompat(token);
    const userId = data.user?.id;
    if (!userId) return 'not_entitled';
    return await getEntitlementStatus(token, userId);
  } catch {
    return 'unknown';
  }
}
