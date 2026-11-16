'use client';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useSettings } from '@/lib/settings';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from './AuthProvider';
import { T } from '@/lib/tables';

export type OnboardingKey = 'tourSeen' | 'profileComplete' | 'telegram' | 'priceAlert' | 'grok' | 'coins';

export interface OnboardingState {
  tourSeen:        boolean;
  profileComplete: boolean;
  telegram:        boolean;
  priceAlert:      boolean;
  grok:            boolean;
  coins:           boolean;
}

/** Nothing seen, nothing complete: what every user starts from and what a user change resets to. */
const EMPTY_ONBOARDING: OnboardingState = { tourSeen: false, profileComplete: false, telegram: false, priceAlert: false, grok: false, coins: false };

interface OnboardingCtx {
  state:   OnboardingState;
  loaded:  boolean;
  // #1309 item 13: true only when the read itself failed (DB error or a
  // thrown exception) - distinct from `loaded && !state.profileComplete`,
  // which is the real "no row yet, genuinely new user" case. See the
  // effect below for why the two must never collapse into one boolean.
  loadError: boolean;
  markDone: (key: OnboardingKey) => void;
  allDone: boolean;
  tourPending:      boolean;
  requestTour:      () => void;
  clearTourPending: () => void;
}

const CTX = createContext<OnboardingCtx>({
  state: { tourSeen: false, profileComplete: false, telegram: false, priceAlert: false, grok: false, coins: false },
  loaded: false, loadError: false, markDone: () => {}, allDone: false,
  tourPending: false, requestTour: () => {}, clearTourPending: () => {},
});

export function useOnboarding() { return useContext(CTX); }

const DB_COL: Record<OnboardingKey, string> = {
  tourSeen:        'tour_seen',
  profileComplete: 'profile_complete',
  telegram:        'checklist_telegram',
  priceAlert:      'checklist_price_alert',
  grok:            'checklist_grok',
  coins:           'checklist_coins',
};

export default function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  /* The Telegram tick is DERIVED, not stored - see `telegram` in the context value below. Safe to
     call here: AppShell's only OnboardingProvider sits inside SettingsProvider (AppShell.tsx:151
     wraps :154), and `useSettings()` falls back to a defined context default anywhere else. */
  const { settings, settingsLoadStatus } = useSettings();
  const [state, setState] = useState<OnboardingState>(EMPTY_ONBOARDING);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [tourPending, setTourPending] = useState(false);

  useEffect(() => {
    if (authLoading) return;          // wait for auth to hydrate first
    /* STATE IS PER USER. It used to persist across a sign-out and sign-in in one page life, and `loaded` stayed true, so (a) an already-onboarded user who signed in without a reload saw the 5-step wizard until the read
       returned (user set, loaded true, profileComplete still false), and (b) a second user with no onboarding row inherited the first user's tour / profile / checklist flags. Reset to the empty state on every user change and
       mark it not loaded until THIS user's row has been read (a signed-out visitor has nothing to wait for). */
    setState(EMPTY_ONBOARDING);
    if (!user) { setLoaded(true); return; }
    setLoaded(false);
    const sb = getSupabase();
    if (!sb) { setLoaded(true); return; }
    setLoadError(false);
    (async () => {
      try {
        const { data, error } = await sb
          .from(T.user_onboarding)
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();
        // #1309 item 13: `error` and "no row" both leave `data` falsy, but
        // they are not the same fact. Only a genuinely errorless empty
        // result means "brand-new user, no row yet" - that's the one case
        // where creating the row is correct. An error means the real state
        // is UNKNOWN, not "incomplete": don't touch the DB, and don't let
        // `state.profileComplete`'s stale `false` default be read as a real
        // answer - OnboardingGate checks `loadError` before it checks that.
        if (error) { setLoadError(true); return; }
        if (data) {
          setState({
            tourSeen:        !!data.tour_seen,
            profileComplete: !!data.profile_complete,
            telegram:        !!data.checklist_telegram,
            priceAlert:      !!data.checklist_price_alert,
            grok:            !!data.checklist_grok,
            coins:           !!data.checklist_coins,
          });
        } else {
          await sb.from(T.user_onboarding).upsert({ user_id: user.id }, { onConflict: 'user_id', ignoreDuplicates: true });
        }
      } catch {
        setLoadError(true);
      } finally {
        setLoaded(true);
      }
    })();
  // Keyed on the user ID, not the user object: a token refresh hands out a new object for the same user and must not reset the state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading]);

  const markDone = useCallback((key: OnboardingKey) => {
    setState(prev => {
      if (prev[key]) return prev;
      return { ...prev, [key]: true };
    });
    const sb = getSupabase();
    if (!sb || !user) return;
    sb.from(T.user_onboarding)
      .upsert({ user_id: user.id, [DB_COL[key]]: true, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      .then(() => {});
  }, [user]);

  // Global event bridge - any page can fire: window.dispatchEvent(new CustomEvent('onboarding:done', { detail: 'grok' }))
  useEffect(() => {
    const h = (e: Event) => markDone((e as CustomEvent<OnboardingKey>).detail);
    window.addEventListener('onboarding:done', h);
    return () => window.removeEventListener('onboarding:done', h);
  }, [markDone]);

  /* ── THE TELEGRAM TICK IS DERIVED FROM THE LINK, NOT FROM A STORED FLAG (#1113) ──────────────
   *
   * It read `checklist_telegram`, which is written in exactly ONE place: `sendTest()` succeeding on
   * /alerts. Connecting Telegram does not write it and cannot - the link is finished by the bot
   * webhook while the user is in Telegram, with no browser of ours to tell. So the item said
   * "Connect Telegram alerts" and measured "pressed Send test message", and a user who connected
   * perfectly stayed unticked forever. Measured on dev: 0 of 11 rows ticked, while `grok` and
   * `coins` - both marked by the action they name - sat at 5.
   *
   * Deriving it from `telegram_chat_id` makes the item mean what it says, removes a write that can
   * fail silently, and fixes the existing rows with no backfill. Disconnecting un-ticks it, which is
   * honest: the step is genuinely no longer done. PM/DevOps chose this over marking it in the
   * webhook or relabelling the step (2026-11-08).
   *
   * AN UNREADABLE SETTINGS ROW MUST NOT READ AS "NOT DONE". `settingsLoadStatus` is 'ready' only
   * once the authoritative row has actually landed; while it is 'loading' or 'error' this falls back
   * to the stored column rather than deriving `false` from a `telegram_chat_id` nobody has read yet.
   * An unknown shown as a confident negative is the same defect as a flat price reading as
   * maximally overbought.
   *
   * THE STORED COLUMN IS LEFT IN PLACE AND STILL WRITTEN by `sendTest()`. It is no longer the
   * source of truth, but it is a meaningful fallback for the unreadable case above: someone who got
   * as far as a successful test message demonstrably had a working link at that moment. */
  const telegramLinked = (settings.telegram_chat_id ?? '').trim().length > 0;
  const derivedState: OnboardingState = {
    ...state,
    telegram: settingsLoadStatus === 'ready' ? telegramLinked : state.telegram,
  };

  const allDone = derivedState.telegram && derivedState.priceAlert && derivedState.grok && derivedState.coins;

  const requestTour      = useCallback(() => setTourPending(true), []);
  const clearTourPending = useCallback(() => setTourPending(false), []);

  return (
    <CTX.Provider value={{ state: derivedState, loaded, loadError, markDone, allDone, tourPending, requestTour, clearTourPending }}>
      {children}
    </CTX.Provider>
  );
}
