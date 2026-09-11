'use client';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useAuth } from './AuthProvider';
import { getSupabase, getAuthToken } from '@/lib/supabase';
import {
  UserSettings, SettingsContext,
  DEFAULT_SETTINGS, loadLocalSettings, saveLocalSettings, rowToSettings,
} from '@/lib/settings';
import { T } from '@/lib/tables';

/* #1188: retry-with-backoff before declaring a settings save failed, same
   shape as #1119's entitlements fetch - 3 attempts, 1s then 2s backoff. Not
   a new pattern invented for this: reusing #1119's exact numbers on purpose,
   since two different retry shapes in the same codebase is how a third one
   gets written the next time this comes up. Most saves that would have
   failed on a transient blip now succeed on attempt 2 or 3 instead of ever
   reaching the user - this is part 1 of #1188's fix; part 2 (this file's own
   comment on flushToDb below, and SettingsSaveToast.tsx) makes the ones that
   still fail visible; the reconciliation gap (a failed save silently
   overwritten by the next sign-in's read) is NOT fixed by either and stays
   open on #1188. */
const SETTINGS_SAVE_MAX_ATTEMPTS = 3;
const SETTINGS_SAVE_RETRY_BACKOFF_MS = [1000, 2000];

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
    setSaveStatus('saving');

    // getAuthToken(), not a raw getSession() - #1168. Every settings save in
    // the app runs through this (update() debounces into it), so an unbounded
    // call here left saveStatus stuck on 'saving' forever on a degraded auth
    // backend, with nothing downstream ever given a chance to reset it.
    async function attemptSave(): Promise<{ failed: boolean }> {
      try {
        const token = await getAuthToken();
        if (!token) return { failed: true };
        const res = await fetch('/api/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(partial),
        });
        return { failed: !res.ok };
      } catch {
        return { failed: true };
      }
    }

    for (let n = 1; n <= SETTINGS_SAVE_MAX_ATTEMPTS; n++) {
      const { failed } = await attemptSave();
      if (!failed) {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
        return;
      }
      if (n < SETTINGS_SAVE_MAX_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, SETTINGS_SAVE_RETRY_BACKOFF_MS[n - 1]));
      }
    }
    /* Every attempt failed. `saveStatus: 'error'` is #1188 part 2's signal -
       SettingsSaveToast.tsx renders it from anywhere, not just /settings.
       NOT FIXED HERE, ON PURPOSE: `settings`/localStorage still hold the
       user's change in memory for the rest of this browser session, but the
       next sign-in effect below re-reads the DB (which never got this write)
       and overwrites both with the stale row - silently, with no error at
       that point either. That reconciliation gap is #1188's still-open part
       3, not something a retry or a toast can close. */
    setSaveStatus('error');
    setTimeout(() => setSaveStatus('idle'), 3000);
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
