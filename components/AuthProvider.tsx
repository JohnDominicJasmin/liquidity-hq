'use client';
import { createContext, useContext, useState, useEffect } from 'react';
import { getSupabase } from '@/lib/supabase';
import { authTokenKeys } from '@/lib/authSession';
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
// Read by AuthGate - shared here so both sides reference the same literal.
export const BAN_NOTICE_KEY = 'lhq_ban_notice';

// Module-scope (not state) - just suppresses a redundant welcome-email fetch
// if SIGNED_IN refires for the same user within this tab. Not a correctness
// guarantee (resets on reload) - the DB-side dedup in the route is that.
let lastWelcomeCheckUserId: string | null = null;

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
    const { data: { subscription } } = sb.auth.onAuthStateChange((event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (!u) setRole('free');
      if (u) touchActivity();
      // Identify / reset in PostHog so all events are tied to this user
      try {
        if (u) posthog.identify(u.id, { email: u.email });
        else    posthog.reset();
      } catch { /* PostHog may not be initialised yet */ }
      // Best-effort welcome-email trigger, covers all 3 signup methods (they
      // all converge on SIGNED_IN). Fires on every real sign-in, not just
      // signups - that's fine, the route itself dedupes via a DB column so
      // the email only ever actually sends once per account. The module-level
      // guard here just avoids a redundant network call if SIGNED_IN refires
      // for the same user within this tab (e.g. multi-tab broadcast).
      if (event === 'SIGNED_IN' && u && u.id !== lastWelcomeCheckUserId) {
        lastWelcomeCheckUserId = u.id;
        fetch('/api/auth/welcome-email', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session!.access_token}` },
        }).catch(() => {});
      }
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
            // AuthGate reads this once (and clears it) to show a specific
            // suspended message instead of the generic sign-in prompt -
            // without it, this signOut() just silently drops the user with
            // no explanation for why their own open tab went dark.
            sessionStorage.setItem(BAN_NOTICE_KEY, '1');
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
    /* Two ways this call can report failure, and it must survive both.
     *
     * Measured against auth-js 2.106.2 rather than assumed: a network
     * TypeError and an AbortError both RESOLVE with an AuthRetryableFetchError
     * in `error` - they do not reject. So the `if (error)` branch below is the
     * live path for the reported bug, and QA's spec exercises it.
     *
     * The catch is still here. GoTrueAdminApi.signOut only converts what
     * passes isAuthError() into a returned error and rethrows anything else,
     * so a non-AuthError escaping the client rejects instead. Nothing fetch
     * throws today lands there - but if one ever does, an uncaught rejection
     * here would skip the local cleanup AND the caller's navigation, which is
     * the original bug wearing a different hat. Cheap to make impossible. */
    let error: unknown = null;
    try {
      ({ error } = (await sb?.auth.signOut()) ?? { error: null });
    } catch (e) {
      error = e ?? new Error('signOut rejected');
    }

    /* A FAILED SIGN-OUT LOOKED EXACTLY LIKE A SUCCESSFUL ONE (#304).
     *
     * GoTrueClient._signOut only drops the stored session after its POST
     * /logout returns. It treats 401/403/404 as "already gone" and clears
     * anyway - but on a network error, timeout or 5xx it returns the error and
     * never reaches _removeSession(). The token stays in localStorage, no
     * SIGNED_OUT event fires, `user` stays set, and the app carries on fully
     * signed in. We discarded that return value, so the two outcomes were
     * indistinguishable: the button ran, nothing happened, nothing was said.
     * That is the reported symptom - "after sign out the UI still same".
     *
     * Navigating harder does not fix it, because /login bounces a signed-in
     * user straight back (app/login/page.tsx). The session has to actually go.
     * It is ours to drop whatever the server says, so clear it locally and let
     * the next document load start signed out.
     *
     * Matched by prefix: we never set a custom storageKey, so the name is
     * `sb-<project-ref>-auth-token` and the ref differs per environment. */
    if (error) {
      try {
        authTokenKeys(Object.keys(localStorage)).forEach(k => localStorage.removeItem(k));
      } catch {
        // Storage can throw (private mode, quota). The hard navigation that
        // follows is still worth attempting - do not let this abort it.
      }
      setUser(null);
    }
  };

  // Trial expiry is compared against a clock held in state rather than a
  // Date.now() call in the render body. Beyond the purity rule, the old form
  // was wrong in a way users would eventually hit: isTrial only re-evaluated
  // when something else happened to re-render this provider, so on a long-lived
  // tab a trial could keep reporting active well after it had actually ended.
  //
  // Deliberately NOT a polling tick. Every page in the app sits under this
  // provider, so an interval here would re-render the whole tree on a timer for
  // a value that changes exactly once. This schedules a single timeout for the
  // moment the trial ends, re-renders once, and then does nothing further.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (trialEndsAt === null) return;
    const ms = trialEndsAt - Date.now();
    if (ms <= 0) return; // already past; `clock` is newer than trialEndsAt already
    const id = setTimeout(() => setClock(Date.now()), ms + 1_000);
    return () => clearTimeout(id);
  }, [trialEndsAt]);

  const isPro   = role === 'pro';
  // Trial is active only for non-paid users still inside the window. Paid Pro
  // ignores the trial flag entirely (isPro already grants everything).
  const isTrial = !isPro && trialEndsAt !== null && trialEndsAt > clock;

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
