// Shared server-side subscription-role lookup - extracted from what was three
// separate copy-pasted copies (grok, grok-chat, briefing routes). Reads through
// a user-scoped Supabase client (RLS: "sub_select_own") so a token can only
// ever read its own role, never someone else's.
import { createClient } from '@supabase/supabase-js';
import { T } from '@/lib/tables';
import type { UsageTier } from '@/lib/limits';

export type Role = 'free' | 'pro';

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

export async function getUserRole(token: string, userId: string): Promise<Role> {
  const { data } = await sb(token).from(T.user_subscriptions)
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.role === 'pro' ? 'pro' : 'free';
}

export interface Entitlement {
  role:        Role;    // the PAID role ('pro' only after a real subscription)
  trialActive: boolean; // inside the 14-day signup trial window
  // Whether Pro FEATURES are unlocked (paid Pro OR active trial). This is the
  // gate for feature access - fast timeframes, backtest, on-chain/macro, etc.
  // The daily AI usage caps are deliberately NOT included: they key on `role`
  // (via getUserRole), so a trial user keeps Free-tier AI limits - Pro tools,
  // Free AI spend. See lib/tables.ts / the add_signup_trial migration.
  proFeatures: boolean;
}

// Single source of truth for "does this token get Pro features". Reads role +
// trial_ends_at in one RLS-scoped query (a token can only read its own row).
export async function getEntitlement(token: string, userId: string): Promise<Entitlement> {
  const { data } = await sb(token).from(T.user_subscriptions)
    .select('role, trial_ends_at')
    .eq('user_id', userId)
    .maybeSingle();
  const role: Role = data?.role === 'pro' ? 'pro' : 'free';
  const trialEnds = data?.trial_ends_at ? new Date(data.trial_ends_at as string).getTime() : 0;
  const trialActive = role !== 'pro' && trialEnds > Date.now();
  return { role, trialActive, proFeatures: role === 'pro' || trialActive };
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

// Drop-in replacement for getUserRole() at any call site that is choosing a
// USAGE LIMIT. Same signature, but returns 'trial' instead of collapsing a
// trial user onto 'free'. Every AI route should use this; getUserRole stays
// for the places that genuinely mean "has this account paid".
export async function getUsageTier(token: string, userId: string): Promise<UsageTier> {
  return usageTierOf(await getEntitlement(token, userId));
}

// Resolves the bearer token straight to a role, returning 'free' for any
// missing/invalid/anonymous token rather than throwing - callers gate on the
// returned role, not on whether this function succeeded.
export async function getRoleFromRequestToken(token: string | null): Promise<Role> {
  if (!token) return 'free';
  const { data: userData } = await sb(token).auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return 'free';
  return getUserRole(token, userId);
}
