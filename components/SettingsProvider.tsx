'use client';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useAuth } from './AuthProvider';
import { getSupabase } from '@/lib/supabase';
import {
  UserSettings, SettingsContext,
  DEFAULT_SETTINGS, loadLocalSettings, saveLocalSettings, rowToSettings,
} from '@/lib/settings';
import { T } from '@/lib/tables';

export default function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [settings,   setSettings]   = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading,    setLoading]    = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef  = useRef<Partial<UserSettings> | null>(null);

  // ── Debounced Supabase upsert ─────────────────────────────────────────────
  // Declared before the effects, not after them. The sign-in effect below calls
  // flushToDb from inside its anti-chop migration branch, and this used to sit
  // further down the file - so that effect closed over a const declared later.
  // It worked, because effects run after the whole component body has, but it is
  // what react-hooks/immutability flags as "cannot access variable before it is
  // declared", and it is only safe by accident: move that call anywhere that
  // runs during render and it becomes a real TDZ crash. Ordering it properly
  // costs nothing - it depends on `user`, which is already available here.
  const flushToDb = useCallback(async (partial: Partial<UserSettings>) => {
    if (!user) return;
    const sb = getSupabase();
    if (!sb) return;
    setSaveStatus('saving');
    try {
      const session = await sb.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('no token');

      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(partial),
      });
      if (!res.ok) throw new Error('save failed');
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }, [user]);

  // ── Initialise from localStorage immediately (no flash of defaults) ──────
  useEffect(() => {
    setSettings(loadLocalSettings());
    setLoading(false);
  }, []);

  // ── When user signs in: fetch from Supabase and override localStorage ────
  useEffect(() => {
    if (!user) return;
    const sb = getSupabase();
    if (!sb) return;
    setLoading(true);
    sb.from(T.user_settings)
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          const row = data as Record<string, unknown>;
          const s   = rowToSettings(row);
          setSettings(s);
          saveLocalSettings(s);

          // One-time migration: Arena's Anti-Chop Filter toggle used to be a
          // localStorage-only setting the server (Telegram alerts) could
          // never see. The anti_chop_enabled column backfilled every
          // existing row to its default (false) on creation - not null - so
          // there's no way to tell "never set" apart from "explicitly off"
          // from the DB value alone. A dedicated migrated-marker is the only
          // reliable one-time gate; without it this would silently clobber
          // whatever this browser had the legacy key set to.
          try {
            if (!localStorage.getItem('lhq_anti_chop_migrated')) {
              const legacy = localStorage.getItem('lhq_anti_chop_enabled');
              if (legacy != null) {
                const legacyVal = legacy === 'true';
                setSettings(prev => ({ ...prev, anti_chop_enabled: legacyVal }));
                pendingRef.current = { ...(pendingRef.current ?? {}), anti_chop_enabled: legacyVal };
                if (debounceRef.current) clearTimeout(debounceRef.current);
                debounceRef.current = setTimeout(() => {
                  if (pendingRef.current) { flushToDb(pendingRef.current); pendingRef.current = null; }
                }, 800);
              }
              localStorage.setItem('lhq_anti_chop_migrated', '1');
            }
          } catch { /* ignore */ }
        }
        setLoading(false);
      }, () => setLoading(false));
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-read from Supabase on demand ───────────────────────────────────────
  // Same read as the sign-in effect above, minus the one-time anti-chop
  // migration (that must stay one-time). Exposed on the context for flows
  // where the server writes a setting behind the client's back - the Telegram
  // link code is redeemed by the bot webhook, so the Alerts page polls this to
  // notice the connection landed.
  const refresh = useCallback(async () => {
    if (!user) return;
    const sb = getSupabase();
    if (!sb) return;
    const { data } = await sb.from(T.user_settings)
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!data) return;
    const s = rowToSettings(data as Record<string, unknown>);
    setSettings(s);
    saveLocalSettings(s);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback((partial: Partial<UserSettings>) => {
    // 1. Update local state immediately
    setSettings(prev => {
      const next = { ...prev, ...partial };
      saveLocalSettings(next);
      return next;
    });

    // 2. Merge into pending batch and schedule debounced save
    pendingRef.current = { ...(pendingRef.current ?? {}), ...partial };
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (pendingRef.current) {
        flushToDb(pendingRef.current);
        pendingRef.current = null;
      }
    }, 800);
  }, [flushToDb]);

  // Memoized for the same reason LabelsProvider's is: this provider wraps the
  // whole app, so a fresh object literal here re-rendered every useSettings()
  // consumer on every render of this component, regardless of whether any
  // setting actually changed. update/refresh/flushToDb are already useCallback'd,
  // so the identity is stable until the values genuinely move.
  const value = useMemo(
    () => ({ settings, loading, saveStatus, update, refresh }),
    [settings, loading, saveStatus, update, refresh],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}
