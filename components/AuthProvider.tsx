'use client';
import { createContext, useContext, useState, useEffect } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';
import posthog from 'posthog-js';
import { T } from '@/lib/tables';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  role: 'free' | 'pro';
  isPro: boolean;          // PAID Pro only - use for "should we sell them Pro" (e.g. /upgrade)
  isTrial: boolean;        // inside the 14-day signup trial (Pro features, Free AI caps)
  entitled: boolean;       // isPro || isTrial - the gate for Pro FEATURES
  trialEndsAt: number | null; // ms epoch the trial ends, for the countdown banner
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  loading: true,
  role: 'free',
  isPro: false,
  isTrial: false,
  entitled: false,
  trialEndsAt: null,
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

const INACTIVITY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const LAST_ACTIVE_KEY = 'lhq_last_active';

function touchActivity() {
  localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
}

function isSessionExpired(): boolean {
  const raw = localStorage.getItem(LAST_ACTIVE_KEY);
  if (!raw) return false; // first visit or cleared - let Supabase decide
  return Date.now() - Number(raw) > INACTIVITY_MS;
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<'free' | 'pro'>('free');
  const [trialEndsAt, setTrialEndsAt] = useState<number | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) { setLoading(false); return; }

    // Seed initial session, force sign-out if inactive >7 days
    sb.auth.getSession().then(async ({ data }) => {
      const sessionUser = data.session?.user ?? null;
      if (sessionUser && isSessionExpired()) {
        await sb.auth.signOut();
        localStorage.removeItem(LAST_ACTIVE_KEY);
        setUser(null);
      } else {
        if (sessionUser) touchActivity();
        setUser(sessionUser);
      }
      setLoading(false);
    });

    // Keep in sync on sign-in / sign-out / token refresh
    const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (!u) setRole('free');
      if (u) touchActivity();
      // Identify / reset in PostHog so all events are tied to this user
      try {
        if (u) posthog.identify(u.id, { email: u.email });
        else    posthog.reset();
      } catch { /* PostHog may not be initialised yet */ }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Push-based ban enforcement - no polling. lhq_user_status mirrors
  // auth.users.banned_until via a DB trigger (Realtime can't watch the auth
  // schema directly); subscribing here means a ban takes effect the moment
  // an admin flips it, instead of waiting up to ~1h for the JWT to naturally
  // refresh and fail its own ban check.
  useEffect(() => {
    if (!user) return;
    const sb = getSupabase();
    if (!sb) return;
    const channel = sb
      .channel(`user-status-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: T.user_status, filter: `user_id=eq.${user.id}` },
        (payload) => {
          if ((payload.new as { banned?: boolean } | null)?.banned) {
            localStorage.removeItem(LAST_ACTIVE_KEY);
            sb.auth.signOut();
          }
        },
      )
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [user]);

  // Fetch subscription role + trial window whenever user changes
  useEffect(() => {
    if (!user) { setRole('free'); setTrialEndsAt(null); return; }
    const sb = getSupabase();
    if (!sb) return;
    sb.from(T.user_subscriptions)
      .select('role, trial_ends_at')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setRole(data?.role === 'pro' ? 'pro' : 'free');
        const t = data?.trial_ends_at ? new Date(data.trial_ends_at as string).getTime() : null;
        setTrialEndsAt(t);
      });
  }, [user]);

  const signOut = async () => {
    const sb = getSupabase();
    localStorage.removeItem(LAST_ACTIVE_KEY);
    await sb?.auth.signOut();
  };

  const isPro   = role === 'pro';
  // Trial is active only for non-paid users still inside the window. Paid Pro
  // ignores the trial flag entirely (isPro already grants everything).
  const isTrial = !isPro && trialEndsAt !== null && trialEndsAt > Date.now();

  return (
    <AuthContext.Provider value={{
      user, loading, role,
      isPro, isTrial, entitled: isPro || isTrial, trialEndsAt,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
