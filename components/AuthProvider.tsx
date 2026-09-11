'use client';
import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { getSupabase } from '@/lib/supabase';
import { forceSignOut } from '@/lib/authSession';
import type { User } from '@supabase/supabase-js';
import posthog from 'posthog-js';
import { T } from '@/lib/tables';
import { clearPlanBadgeCache } from '@/lib/planBadgeCache';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  role: 'free' | 'pro';
  isPro: boolean;          // PAID Pro only - use for "should we sell them Pro" (e.g. /upgrade)
  isTrial: boolean;        // inside the 14-day signup trial (Pro features, Free AI caps)
  entitled: boolean;       // isPro || isTrial - the gate for Pro FEATURES
  trialEndsAt: number | null; // ms epoch the trial ends, for the countdown banner
  // True from the moment `user` resolves until the user_subscriptions read
  // below settles. `role` defaults to 'free' before that read completes, so
  // a consumer that paints on `role` alone (rather than gating like the three
  // `authLoading || entitled` call sites do) shows a real Pro/Trial account
  // as Free for one frame on every cold load (#1090's nav badge, caught by
  // QA). Existing consumers don't need this - they gate on `entitled`, which
  // is already correct while unresolved (false is the safe default to fail
  // toward). This exists for the one kind of consumer that paints `role`
  // itself and cannot afford to show the wrong tier even briefly.
  entitlementsLoading: boolean;
  // True when the LAST user_subscriptions attempt (fast error response,
  // network failure, or the bounded timeout below) did not resolve to a real
  // answer. `role`/`trialEndsAt` still fall back to their free/null defaults
  // on this path - unfixed here on purpose, see the fetch effect's own
  // comment - so a consumer that paints `role` directly needs this to know
  // "free" is a guess, not a resolved fact. Existing `entitled`-gated
  // consumers are unaffected either way: false was already their safe
  // default while unresolved.
  entitlementsError: boolean;
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
  entitlementsLoading: true,
  entitlementsError: false,
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

const INACTIVITY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/* How long the initial session read may take before the app gives up and
   renders as signed-out (#727). Generous enough that a slow-but-working
   network still resolves to the real session - Render's free plan can be slow
   and QA measured the healthy anonymous path at 2-3s on staging - and short
   enough that a hang does not read as a broken page. The value is a ceiling on
   a failure, not a target: the normal path settles long before it. */
const SESSION_RESOLVE_MS = 8000;
/* Same reasoning as SESSION_RESOLVE_MS, different call: QA reproduced the
   user_subscriptions read hanging indefinitely with no timeout at all
   (#1089) - entitlementsLoading stuck true forever, badge never appears.
   #949/#1025 already document this backend's latency behaviour, so this
   is not a hypothetical.

   NOT reused at SESSION_RESOLVE_MS's own 8s - measured, not assumed:
   building this fix, a real (uninflated, unmocked) load on this project's
   shared dev Supabase genuinely took longer than 8s and tripped the abort,
   which would have been a second, self-inflicted version of the exact bug
   being fixed - a fast, wrong "error" on a request that was only ever slow.
   15s cleared every observed run with real headroom to spare. Generous on
   purpose: this timeout only matters when something is already wrong, so
   the cost of it being too long is a few extra seconds of `entitlementsLoading`
   on that already-bad path, while the cost of too short is exactly the false
   failure just described. */
const ENTITLEMENTS_FETCH_MS = 15000;
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
  // Starts true, same reasoning as `loading`: unknown until proven otherwise,
  // never a default that happens to read as correct.
  const [entitlementsLoading, setEntitlementsLoading] = useState(true);
  const [entitlementsError, setEntitlementsError] = useState(false);
  // Tracks the CURRENT user id for the sign-out handler below, which fires
  // with the new (null) session and has no other way to know whose cache
  // to clear. A ref, not state read in that closure - onAuthStateChange's
  // callback is created once inside the effect with `[]` deps, so `user`
  // itself would be permanently stale there.
  const userIdRef = useRef<string | null>(null);
  useEffect(() => { userIdRef.current = user?.id ?? null; }, [user]);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) { setLoading(false); return; }

    /* Seed initial session, force sign-out if inactive >7 days.
     *
     * BOUNDED, because `loading` staying true is a page-blocking failure and
     * this promise does not always settle (#727).
     *
     * A browser holding an EXPIRED session made `getSession()` hang: supabase-js
     * tries to refresh the token on read, and when that refresh neither resolves
     * nor rejects the `.finally` below never runs, so `loading` stays true
     * forever. `/upgrade` is the one screen that gates its whole render on
     * `loading` (page.tsx:105), so it sat on "Loading…" indefinitely while the
     * rest of the app looked fine - QA measured /dashboard settling in 1ms and
     * /upgrade stuck past 25s in the same browser, same commit.
     *
     * That is the ordinary state of a returning user's browser, since tokens
     * expire by design, and the wall is exactly where they try to pay.
     *
     * The timeout treats "no answer" as "no session" rather than guessing at a
     * user. That is the safe direction: a real session that merely arrives late
     * is still delivered by the onAuthStateChange subscription below, which
     * fires on TOKEN_REFRESHED and SIGNED_IN and sets the user then. The
     * failure this replaces had no recovery path at all.
     *
     * NOT the opposite bug. #377 was a stuck `loading` that GRANTED Pro; this
     * resolves to signed-out, which grants nothing. */
    /* ONE DEADLINE FOR THE WHOLE CHAIN, not one per call.
     *
     * Both awaits were bounded at SESSION_RESOLVE_MS each, which QA flagged as
     * stacking: they cannot both time out (a timed-out read yields no user, so
     * the sign-out branch is not entered), but a read that SUCCEEDS slowly and
     * is then followed by a hanging forceSignOut adds up to ~16s. Narrow - it
     * needs a session idle past the 7-day window - and still finite, but 16s of
     * spinner is not meaningfully better than 25s to the person looking at it.
     *
     * The deadline is taken once, so `loading` resolves within
     * SESSION_RESOLVE_MS of the effect starting no matter how the time is split
     * between the two calls. */
    const deadline = Date.now() + SESSION_RESOLVE_MS;
    const withTimeout = <T,>(p: PromiseLike<T>): Promise<T | null> =>
      Promise.race([
        Promise.resolve(p),
        new Promise<null>(resolve =>
          setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()))),
      ]);

    withTimeout(sb.auth.getSession()).then(async (res) => {
      const data = res?.data;
      const sessionUser = data?.session?.user ?? null;
      if (sessionUser && isSessionExpired()) {
        /* Bounded for the same reason as the read above: signOut() is a network
           call and this branch awaits it, so a hang here would keep `loading`
           true just as effectively. forceSignOut itself is now also
           internally time-bounded (#1149, lib/authSession.ts), so this outer
           withTimeout is redundant rather than load-bearing - kept anyway as
           a second, independent bound on `loading` specifically, which is
           what this effect actually promises to resolve. */
        // forceSignOut, not sb.auth.signOut: this path exists to END a session
        // that has outlived its window, so it failing quietly would keep the
        // user signed in past the expiry it is enforcing (#304).
        await withTimeout(forceSignOut(sb));
        localStorage.removeItem(LAST_ACTIVE_KEY);
        setUser(null);
      } else {
        if (sessionUser) touchActivity();
        /* setEntitlementsLoading(true) alongside setUser, same synchronous
           block, batched into the same render - a REAL race found while
           building #1089's cache fix, pre-existing in this file since
           before it. Without this, there is one render frame where `user`
           is already the real one but `entitlementsLoading` still reads
           the stale `false` this effect's own `!user` branch left behind
           on the very first mount (user starts null, so that branch always
           runs once before any real session resolves) - the entitlements
           fetch effect below hasn't re-run yet to flip it back to `true`,
           because effects run after commit, not synchronously with the
           state update that changed `user`. A consumer reading `role`
           during exactly that frame sees the free/null defaults and reads
           them as resolved, not pending - which is the same shape #1095
           fixed for `entitlementsLoading` staying true through the initial
           load, just a narrower, single-frame instance of it neither that
           fix nor its regression test (#1096/#1104, which widen the window
           via an artificial fetch delay) were positioned to catch, because
           the race is in a different pair of effects settling, not in the
           fetch's own duration. */
        if (sessionUser) setEntitlementsLoading(true);
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
      // Same race, same fix as the initial session resolve above - batched
      // with setUser so a consumer never sees the new user paired with a
      // stale `entitlementsLoading=false` left over from before this user
      // existed. Harmless on a token refresh for the SAME user: the
      // entitlements-fetch effect already re-runs and re-sets this on every
      // `user` reference change (which a refresh also produces) - this just
      // closes the one-frame gap before that effect gets to run.
      if (u) setEntitlementsLoading(true);
      setUser(u);
      if (!u) {
        setRole('free');
        // Cleanup, not a read for a decision: this is the one place PlanBadge's
        // display-only cache is touched from outside PlanBadge.tsx. A remembered
        // PRO surviving into the next account signed in on this browser would be
        // a real defect (#1089), so it goes the moment there is no user.
        if (userIdRef.current) clearPlanBadgeCache(userIdRef.current);
      }
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
    if (!user) { setRole('free'); setTrialEndsAt(null); setEntitlementsLoading(false); setEntitlementsError(false); return; }
    const sb = getSupabase();
    if (!sb) { setEntitlementsLoading(false); return; }
    // Set even though the initial state is already `true` - this effect also
    // reruns on a user SWITCH (sign-out then a different sign-in in the same
    // tab), where the previous user's fetch already flipped it false.
    setEntitlementsLoading(true);
    /* #1089: this read had NO bound at all - QA reproduced it hanging
       indefinitely, entitlementsLoading stuck true forever with no console
       error. Supabase resolves (rather than rejects) most failures, error
       field included, but an unbounded fetch can still simply never settle -
       .abortSignal(...) is what stops that. Called before `.maybeSingle()`:
       that narrows to a builder type that does not expose `.abortSignal()`.
       Wrapped in Promise.resolve() below because the builder's own .then()
       returns a bare PromiseLike with no .catch() at the type level, even
       though it behaves like a real promise at runtime. */
    Promise.resolve(
      sb.from(T.user_subscriptions)
        .select('role, trial_ends_at')
        .eq('user_id', user.id)
        .abortSignal(AbortSignal.timeout(ENTITLEMENTS_FETCH_MS))
        .maybeSingle(),
    )
      .then(({ data, error }) => {
        /* NOT FIXED HERE, ON PURPOSE - reported, not patched (#1089 audit).
           On a failed read (fast error response, reset, or the timeout
           above), `data` is null and this still resolves role to 'free' /
           trialEndsAt to null exactly as a genuinely-free account would -
           `error` is available but deliberately not branched on here. That
           means a real Pro/Trial account can read as `entitled: false`
           during a backend hiccup, not just show the wrong badge - losing
           actual Pro FEATURES (Arena's Confluence card, both Alerts
           sections), not only a cosmetic label. Fixing that is a bigger,
           separate change (what should every `entitled`-gated consumer do
           on a failed read? fail open, fail closed, or something needing
           its own cache the way the badge now has?) and is being decided
           on #1089 rather than folded into this PR silently. `role`/
           `trialEndsAt` keep today's exact behaviour; `entitlementsError`
           below is the only new signal, and only PlanBadge acts on it. */
        setRole(data?.role === 'pro' ? 'pro' : 'free');
        const t = data?.trial_ends_at ? new Date(data.trial_ends_at as string).getTime() : null;
        setTrialEndsAt(t);
        setEntitlementsLoading(false);
        setEntitlementsError(Boolean(error));
      })
      .catch(() => {
        // Defensive: Supabase resolves rather than rejects on the failures
        // actually observed (including an abortSignal timeout), but nothing
        // guarantees every failure mode does - a genuine rejection must not
        // leave entitlementsLoading stuck true the same way the un-timed-out
        // hang did before this fix existed.
        setEntitlementsLoading(false);
        setEntitlementsError(true);
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
    if (await forceSignOut(sb)) {
      // The success path clears the badge cache via onAuthStateChange's
      // SIGNED_OUT event above - this is the local-only fallback for when
      // the network signOut() call itself failed, which never fires that
      // event, so it needs the same cleanup done explicitly here.
      if (user) clearPlanBadgeCache(user.id);
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
      entitlementsLoading, entitlementsError,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
