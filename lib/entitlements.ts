// Shared server-side subscription-role lookup — extracted from what was three
// separate copy-pasted copies (grok, grok-chat, briefing routes). Reads through
// a user-scoped Supabase client (RLS: "sub_select_own") so a token can only
// ever read its own role, never someone else's.
import { createClient } from '@supabase/supabase-js';
import { T } from '@/lib/tables';

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

// Resolves the bearer token straight to a role, returning 'free' for any
// missing/invalid/anonymous token rather than throwing — callers gate on the
// returned role, not on whether this function succeeded.
export async function getRoleFromRequestToken(token: string | null): Promise<Role> {
  if (!token) return 'free';
  const { data: userData } = await sb(token).auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return 'free';
  return getUserRole(token, userId);
}
