'use client';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
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

interface OnboardingCtx {
  state:   OnboardingState;
  loaded:  boolean;
  markDone: (key: OnboardingKey) => void;
  allDone: boolean;
  tourPending:      boolean;
  requestTour:      () => void;
  clearTourPending: () => void;
}

const CTX = createContext<OnboardingCtx>({
  state: { tourSeen: false, profileComplete: false, telegram: false, priceAlert: false, grok: false, coins: false },
  loaded: false, markDone: () => {}, allDone: false,
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
  const [state, setState] = useState<OnboardingState>({
    tourSeen: false, profileComplete: false, telegram: false, priceAlert: false, grok: false, coins: false,
  });
  const [loaded, setLoaded] = useState(false);
  const [tourPending, setTourPending] = useState(false);

  useEffect(() => {
    if (authLoading) return;          // wait for auth to hydrate first
    if (!user) { setLoaded(true); return; }
    const sb = getSupabase();
    if (!sb) { setLoaded(true); return; }
    (async () => {
      const { data } = await sb
        .from(T.user_onboarding)
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
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
      setLoaded(true);
    })();
  }, [user, authLoading]);

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

  // Global event bridge — any page can fire: window.dispatchEvent(new CustomEvent('onboarding:done', { detail: 'grok' }))
  useEffect(() => {
    const h = (e: Event) => markDone((e as CustomEvent<OnboardingKey>).detail);
    window.addEventListener('onboarding:done', h);
    return () => window.removeEventListener('onboarding:done', h);
  }, [markDone]);

  const allDone = state.telegram && state.priceAlert && state.grok && state.coins;

  const requestTour      = useCallback(() => setTourPending(true), []);
  const clearTourPending = useCallback(() => setTourPending(false), []);

  return (
    <CTX.Provider value={{ state, loaded, markDone, allDone, tourPending, requestTour, clearTourPending }}>
      {children}
    </CTX.Provider>
  );
}
