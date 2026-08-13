'use client';
import { createContext, useContext, useState, useEffect } from 'react';
import { getSupabase } from '@/lib/supabase';
import { forceSignOut } from '@/lib/authSession';
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
        // forceSignOut, not sb.auth.signOut: this path exists to END a session
        // that has outlived its window, so it failing quietly would keep the
        // user signed in past the expiry it is enforcing (#304).
        await forceSignOut(sb);
        localStorage.removeItem(LAST_ACTIVE_KEY);
        setUser(null);
      } else {
        if (sessionUser) touchActivity();
        setUser(sessionUser);
      }
    }).finally(() => setLoading(false));
    /* .finally, NOT a trailing statement inside the .then (QA, on #377).
     *
     * `touchActivity` and `isSessionExpired` above both read localStorage bare,
     * and storage throws for real users - Safari private mode, blocked site
     * data, quota. `lib/authSession.ts:43` already wraps its own storage access
     * for exactly this reason.
     *
     * If any of them throws, the handler dies and `loading` stays true for the
     * life of the page. That was harmless until this PR, because a stuck
     * `loading` produced `entitled === false` and the paywall showed. The three
     * call sites now read `authLoading || entitled`, which inverts it:
     *
     *   before   stuck loading -> paywall shown      FAIL CLOSED
     *   after    stuck loading -> Pro content shown  FAIL OPEN
     *
     * A signed-in FREE user whose storage throws would get Arena's Confluence
     * card and both Alerts sections unlocked until they reloaded. The bug is
     * pre-existing; this PR removes the accident that was covering it.
     *
     * `.finally` makes "auth finished trying" true regardless of outcome, which
     * is what `authLoading` means at all three call sites. */

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
            // Ban enforcement is a security control, so it must not depend on
            // the logout request succeeding. Before #304's follow-up, a banned
            // user whose request happened to fail simply stayed signed in and
            // nothing said so.
            void forceSignOut(sb);
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
    /* The stored session is dropped locally when the server call fails - see
     * forceSignOut in lib/authSession.ts for why, and for the two other paths
     * that need the same guarantee.
     *
     * Callers hard-navigate afterwards rather than router.push, because /login
     * bounces a signed-in user straight back (app/login/page.tsx:57) and a soft
     * navigation keeps every provider alive to be bounced by. */
    if (await forceSignOut(sb)) setUser(null);
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
