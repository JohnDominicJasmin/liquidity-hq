'use client';
import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { getSupabase } from '@/lib/supabase';
import { forceSignOut } from '@/lib/authSession';
import type { User } from '@supabase/supabase-js';
import posthog from 'posthog-js';
import { T } from '@/lib/tables';
import { clearPlanBadgeCache } from '@/lib/planBadgeCache';

// #1119, owner ruling 2026-09-11: a failed/timed-out subscription read is a
// DIFFERENT fact than a confirmed free account, and the two must not collapse
// into the same boolean. 'unknown' only means "every retry failed to get a
// real answer" - it is not fail-open (never grants Pro FEATURES) and not
// fail-closed (never asserts the user is on the free plan). A consumer that
// silently treats 'unknown' the same as 'not_entitled' everywhere it shows
// the user something has not implemented this - it has renamed the bug.
export type EntitlementStatus = 'entitled' | 'not_entitled' | 'unknown';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  role: 'free' | 'pro';
  isPro: boolean;          // PAID Pro only - use for "should we sell them Pro" (e.g. /upgrade)
  isTrial: boolean;        // inside the 14-day signup trial (Pro features, Free AI caps)
  // The gate for Pro FEATURES. Replaces the old `entitled: boolean` (#1119) -
  // every call site that read `entitled`/`!entitled` needs a conscious
  // decision for 'unknown', not a type that lets it fall through unnoticed.
  // 'not_entitled' covers both a confirmed free account AND the window while
  // entitlementsLoading is still true (the same safe default `entitled` used
  // to carry while unresolved - unchanged, not part of this fix). 'unknown'
  // is reserved for entitlementsLoading having settled with entitlementsError
  // true: every retry exhausted, still no real answer.
  entitlementStatus: EntitlementStatus;
  trialEndsAt: number | null; // ms epoch the trial ends, for the countdown banner
  // True from the moment `user` resolves until the user_subscriptions read
  // below settles (all retries included). `role` defaults to 'free' before
  // that read completes, so a consumer that paints on `role` alone (rather
  // than gating like the three `authLoading || entitlementStatus === 'entitled'`
  // call sites do) shows a real Pro/Trial account as Free for one frame on
  // every cold load (#1090's nav badge, caught by QA). Existing consumers
  // don't need this - they gate on `entitlementStatus`, which is already
  // 'not_entitled' (the safe default to fail toward) while unresolved. This
  // exists for the one kind of consumer that paints `role` itself and cannot
  // afford to show the wrong tier even briefly.
  entitlementsLoading: boolean;
  // True once every entitlements retry has been exhausted with no real
  // answer (#1119) - `entitlementStatus` reads 'unknown' exactly when this is
  // true. `role`/`trialEndsAt` still fall back to their free/null defaults on
  // this path - unfixed here on purpose, see the fetch effect's own comment -
  // so a consumer that paints `role` directly needs this to know "free" is a
  // guess, not a resolved fact. PlanBadge is the one existing consumer of
  // this exact field (#1089/#1118's display-only cache) and is unaffected by
  // this change - its meaning here is the same "we could not get a real
  // answer" it always was, just arrived at after retries instead of one try.
  entitlementsError: boolean;
  // Re-runs the entitlements fetch (fresh retry sequence) on demand - the
  // Retry action on the 'unknown'-state UI (#1119). Automatic retries already
  // ran and exhausted themselves before entitlementStatus ever reads
  // 'unknown', so this exists for the case where the backend recovers after
  // the user is already looking at a "couldn't verify" card.
  retryEntitlements: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  loading: true,
  role: 'free',
  isPro: false,
  isTrial: false,
  entitlementStatus: 'not_entitled',
  trialEndsAt: null,
  entitlementsLoading: true,
  entitlementsError: false,
  retryEntitlements: () => {},
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
/* #1119: retry-with-backoff, built on purpose to replace resilience this read
   used to get BY ACCIDENT. Before #1177's dedup fix, one page load fired this
   effect up to 3 times (object-identity churn on `[user]`), giving 3
   independent chances against a flaky backend for free. Measured live on
   #1119: 2 of 3 real runs had at least one of those accidental attempts fail
   before a later one succeeded; 1 of 3 had every attempt fail. Deduping to a
   single fetch (below, now keyed on `userId`) would have kept only whichever
   attempt happened to run first - on the runs that were observed, that was
   usually the one that failed. This gives the SAME read the SAME number of
   chances on purpose instead.

   3 attempts, matching the number the bug was already validating as enough
   for this backend's actual failure rate - not a round number picked cold.
   1s then 2s backoff between attempts: long enough to give a transient
   hiccup room to clear before trying again, short enough that 3 failed
   attempts at up to ENTITLEMENTS_FETCH_MS each stay a tail case (worst
   case ~48s) rather than the common path - the common path is a real answer
   on attempt 1, same as before this existed. */
const ENTITLEMENTS_MAX_ATTEMPTS = 3;
const ENTITLEMENTS_RETRY_BACKOFF_MS = [1000, 2000];

/* QA-only hook, #1119 follow-up. QA's own finding: the retry-EXHAUSTION path
   (every attempt failing, landing on entitlementStatus 'unknown') had been
   reasoned about from the code but never actually exercised - a
   `page.route()`/`window.fetch` override loses the race on a reload (this
   effect can already be mid-attempt before a test's override installs), and
   forcing a fresh sign-in to retry hits the login form's Turnstile widget.

   `page.addInitScript()` beats both: Playwright guarantees it runs before ANY
   page script, on every navigation including a reload, so a global it sets
   is reliably in place before this effect's first attempt ever checks it -
   no race to lose. Checked inside `attempt()` itself rather than raced
   against the real network call, so a positive answer here goes through the
   EXACT SAME retry loop, backoff and entitlementStatus derivation a real
   failure would, only the network round trip is skipped.

   FAIL-SAFE BY CONSTRUCTION, not by policy: this can only ever produce
   `failed: true`, which this file's own derivation resolves to 'unknown' -
   never 'entitled'. There is no value this flag can hold that grants access,
   so a test (or, in principle, a hostile page) setting it can only make an
   account look LESS entitled than it is, never more - the one thing #1119's
   own ruling requires anyway.

   BUILD-TIME DEAD ON PROD REGARDLESS: NEXT_PUBLIC_APP_ENV is inlined at
   build time (see AGENTS.md/CONTRIBUTING.md's own warning on this), so
   `QA_FORCE_ENTITLEMENTS_FAIL_ENABLED` is the literal `false` in a
   NEXT_PUBLIC_APP_ENV=prod build and the branch below is eliminated from
   the bundle entirely - not a runtime check a clever caller could flip. */
const QA_FORCE_ENTITLEMENTS_FAIL_ENABLED = process.env.NEXT_PUBLIC_APP_ENV !== 'prod';
function qaForcedEntitlementsFailure(): boolean {
  if (!QA_FORCE_ENTITLEMENTS_FAIL_ENABLED) return false;
  if (typeof window === 'undefined') return false;
  return Boolean((window as unknown as { __LHQ_QA_FORCE_ENTITLEMENTS_FAIL__?: boolean }).__LHQ_QA_FORCE_ENTITLEMENTS_FAIL__);
}

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
  // Bumped by retryEntitlements() to force a fresh retry sequence on demand -
  // the entitlements-fetch effect below depends on it alongside `userId`, so
  // incrementing it re-runs the effect without needing a user change (#1119).
  const [entitlementsRetryNonce, setEntitlementsRetryNonce] = useState(0);
  // Depend on the id, not the user object - same reasoning as app/ops/layout.tsx's
  // admin check. Supabase hands back a new user object on every setUser() call
  // (including the 2-3 that fire on one page load, see #1177) even when it is
  // the same person; keying the entitlements fetch on the object re-ran it that
  // many times for no reason, which is what made 3 accidental attempts look
  // like resilience in the first place (#1119). The id is what actually decides
  // the answer.
  const userId = user?.id;
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

  // Retry-triggerable from outside this effect (the 'unknown'-state UI's
  // Retry button) - see retryEntitlements below.
  const retryEntitlements = () => setEntitlementsRetryNonce(n => n + 1);

  // Fetch subscription role + trial window whenever the user (by id) changes,
  // or a manual retry is requested.
  useEffect(() => {
    if (!userId) { setRole('free'); setTrialEndsAt(null); setEntitlementsLoading(false); setEntitlementsError(false); return; }
    const sb = getSupabase();
    if (!sb) { setEntitlementsLoading(false); return; }
    // Set even though the initial state is already `true` - this effect also
    // reruns on a user SWITCH (sign-out then a different sign-in in the same
    // tab), where the previous user's fetch already flipped it false.
    setEntitlementsLoading(true);
    setEntitlementsError(false);
    let cancelled = false;

    /* #1089/#1119: this read had NO bound at all originally - QA reproduced
       it hanging indefinitely, entitlementsLoading stuck true forever with
       no console error. Supabase resolves (rather than rejects) most
       failures, error field included, but an unbounded fetch can still
       simply never settle - .abortSignal(...) is what stops that. Called
       before `.maybeSingle()`: that narrows to a builder type that does not
       expose `.abortSignal()`. Wrapped in Promise.resolve() below because
       the builder's own .then() returns a bare PromiseLike with no .catch()
       at the type level, even though it behaves like a real promise at
       runtime. try/catch (not just .catch() below) covers a genuine
       rejection from that same call, for the same reason. */
    async function attempt(n: number): Promise<{ data: { role?: string; trial_ends_at?: string | null } | null; failed: boolean }> {
      if (qaForcedEntitlementsFailure()) return { data: null, failed: true };
      try {
        const { data, error } = await Promise.resolve(
          sb!.from(T.user_subscriptions)
            .select('role, trial_ends_at')
            .eq('user_id', userId!)
            .abortSignal(AbortSignal.timeout(ENTITLEMENTS_FETCH_MS))
            .maybeSingle(),
        );
        return { data: data ?? null, failed: Boolean(error) };
      } catch {
        return { data: null, failed: true };
      }
    }

    (async () => {
      for (let n = 1; n <= ENTITLEMENTS_MAX_ATTEMPTS; n++) {
        const { data, failed } = await attempt(n);
        if (cancelled) return;

        if (!failed) {
          /* NOT FIXED HERE, ON PURPOSE for a CONFIRMED answer - reported,
             not patched (#1089 audit). `data === null` with `failed: false`
             means Supabase genuinely found no subscription row: a real free
             account, not a failure. `role`/`trialEndsAt` resolving to their
             free/null defaults on that path is correct, not a guess. What
             #1119 fixes is the OTHER path, below: every attempt failing no
             longer resolves to this same free/null shape silently - see
             entitlementStatus's derivation for what a genuine failure now
             produces instead. */
          setRole(data?.role === 'pro' ? 'pro' : 'free');
          const t = data?.trial_ends_at ? new Date(data.trial_ends_at as string).getTime() : null;
          setTrialEndsAt(t);
          setEntitlementsLoading(false);
          setEntitlementsError(false);
          return;
        }

        if (n < ENTITLEMENTS_MAX_ATTEMPTS) {
          await new Promise(resolve => setTimeout(resolve, ENTITLEMENTS_RETRY_BACKOFF_MS[n - 1]));
          if (cancelled) return;
        }
      }
      // Every attempt failed - genuinely unknown. `role`/`trialEndsAt` are
      // left at whatever they already were (free/null on a first load, or
      // the last confirmed answer on a re-fetch) - entitlementsError is the
      // signal that they are not to be trusted, same as before #1119.
      setEntitlementsLoading(false);
      setEntitlementsError(true);
    })();

    return () => { cancelled = true; };
  }, [userId, entitlementsRetryNonce]);

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

  /* #1119. 'unknown' is checked FIRST but only wins when isPro/isTrial are
     both false - a read that failed after already having confirmed Pro/Trial
     from an earlier successful attempt (a re-fetch on a later retry, or a
     stale-but-real answer this render hasn't re-fetched yet) must not
     downgrade a real Pro account to 'unknown' just because entitlementsError
     is also true from a past attempt. In practice `entitlementsError` and
     `isPro`/`isTrial` are never both meaningfully true at once with the
     effect above (a successful attempt always clears entitlementsError in
     the same update as setting role) - ordered this way anyway so that
     invariant is enforced by this line, not assumed from the effect. */
  const entitlementStatus: EntitlementStatus =
    (isPro || isTrial) ? 'entitled' :
    entitlementsError  ? 'unknown' :
    'not_entitled';

  return (
    <AuthContext.Provider value={{
      user, loading, role,
      isPro, isTrial, entitlementStatus, trialEndsAt,
      entitlementsLoading, entitlementsError, retryEntitlements,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
