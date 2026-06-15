'use client';
import { createContext, useContext, useState, useEffect } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';
import posthog from 'posthog-js';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  role: 'free' | 'pro';
  isPro: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  loading: true,
  role: 'free',
  isPro: false,
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
  if (!raw) return false; // first visit or cleared — let Supabase decide
  return Date.now() - Number(raw) > INACTIVITY_MS;
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<'free' | 'pro'>('free');

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

  // Fetch subscription role whenever user changes
  useEffect(() => {
    if (!user) { setRole('free'); return; }
    const sb = getSupabase();
    if (!sb) return;
    sb.from('user_subscriptions')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => setRole(data?.role === 'pro' ? 'pro' : 'free'));
  }, [user]);

  const signOut = async () => {
    const sb = getSupabase();
    localStorage.removeItem(LAST_ACTIVE_KEY);
    await sb?.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, loading, role, isPro: role === 'pro', signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
