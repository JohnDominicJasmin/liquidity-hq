'use client';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useAuth } from './AuthProvider';
import { getSupabase, getAuthToken } from '@/lib/supabase';
import {
  UserSettings, SettingsContext, SettingsLoadStatus,
  DEFAULT_SETTINGS, loadLocalSettings, saveLocalSettings, rowToSettings,
  loadUnconfirmed, saveUnconfirmed, dropLegacyUnconfirmedKey,
} from '@/lib/settings';
import { T } from '@/lib/tables';
import { retryWithBackoff } from '@/lib/retryWithBackoff';

/* #1188: retry-with-backoff before declaring a settings save failed, same
   shape as #1119's entitlements fetch - 3 attempts, 1s then 2s backoff. Not
   a new pattern invented for this: reusing #1119's exact numbers on purpose,
   since two different retry shapes in the same codebase is how a third one
   gets written the next time this comes up (#1199 later extracted the loop
   itself into lib/retryWithBackoff.ts, shared with AuthProvider's
   entitlements fetch - these numbers are this caller's own choice, not the
   shared utility's). Most saves that would have failed on a transient blip
   now succeed on attempt 2 or 3 instead of ever reaching the user - this is
   part 1 of #1188's fix; part 2 (this file's own comment on flushToDb below,
   and SettingsSaveToast.tsx) makes the ones that still fail visible; the
   reconciliation gap (a failed save silently overwritten by the next
   sign-in's read) is NOT fixed by either and stays open on #1188. */
const SETTINGS_SAVE_MAX_ATTEMPTS = 3;
const SETTINGS_SAVE_RETRY_BACKOFF_MS = [1000, 2000];

export default function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [settings,   setSettings]   = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading,    setLoading]    = useState(true);
  // #1246/#1347: see lib/settings.ts's own comment on why this is separate
  // from `loading` and why it's a tri-state, not a boolean. 'loading' until
  // the authoritative source (DB row for a signed-in user, or a confirmed
  // sign-out) has actually been consulted once for the CURRENT account -
  // goes back to 'loading' if the account changes.
  const [settingsLoadStatus, setSettingsLoadStatus] = useState<SettingsLoadStatus>('loading');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef  = useRef<Partial<UserSettings> | null>(null);
  // #1202 core: the last server-confirmed write timestamp per field, as of
  // the most recent DB read (sign-in fetch, refresh(), or a PATCH response).
  // Sent back as `knownAsOf` on the next save so the server can tell "I'm
  // writing based on the version I actually last saw" from "I'm writing
  // blind" - see app/api/settings/route.ts's own accept-rule comment. A ref,
  // not state: purely an outgoing-request input, never rendered.
  const fieldUpdatedAtRef = useRef<Record<string, string>>({});

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
    type AttemptResult =
      | { failed: true }
      | { failed: false; accepted: string[]; rejected: string[]; settings: Record<string, unknown> | null };
    async function attemptSave(_attemptNumber: number): Promise<AttemptResult> {
      try {
        const token = await getAuthToken();
        if (!token) return { failed: true };
        // #1202 core: only send a knownAsOf entry for a field this client has
        // actually seen a server-confirmed timestamp for - omitting one for a
        // never-synced field is deliberate, not a gap; see the route's own
        // accept-rule comment for why sending nothing must not read as "no
        // conflict".
        const knownAsOf: Record<string, string> = {};
        for (const key of Object.keys(partial)) {
          const ts = fieldUpdatedAtRef.current[key];
          if (ts) knownAsOf[key] = ts;
        }
        const res = await fetch('/api/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ...partial, knownAsOf }),
        });
        if (!res.ok) return { failed: true };
        const body = await res.json() as { accepted?: string[]; rejected?: string[]; settings?: Record<string, unknown> | null };
        return { failed: false, accepted: body.accepted ?? [], rejected: body.rejected ?? [], settings: body.settings ?? null };
      } catch {
        return { failed: true };
      }
    }

    const { result } = await retryWithBackoff(attemptSave, {
      maxAttempts: SETTINGS_SAVE_MAX_ATTEMPTS,
      backoffMs: SETTINGS_SAVE_RETRY_BACKOFF_MS,
    });

    if (!result.failed) {
      // The row the server actually holds now, regardless of which fields
      // this attempt won - authoritative ground truth for fieldUpdatedAtRef
      // and for reconciling anything rejected below.
      const freshRow = result.settings;
      if (freshRow?.field_updated_at && typeof freshRow.field_updated_at === 'object') {
        fieldUpdatedAtRef.current = freshRow.field_updated_at as Record<string, string>;
      }

      const unconfirmed = loadUnconfirmed(user.id);
      for (const key of result.accepted) {
        // #1188 part 3 + PM/DevOps's #1202 catch: only clear the marker if
        // the stored value still equals what THIS attempt actually sent.
        // Without this check, a newer edit to the same key made WHILE this
        // attempt was in flight (update() already overwrote the map entry
        // with the newer value) would have its protection deleted here by
        // an older attempt confirming an older value - the newer edit is
        // then unprotected and never retried.
        if (JSON.stringify(unconfirmed[key]) === JSON.stringify((partial as Record<string, unknown>)[key])) {
          delete unconfirmed[key];
        }
      }
      // #1202 core: a rejected field lost to a newer confirmed write on
      // another device. The conflict is now resolved by an authoritative
      // answer, not a guess - adopt the server's actual value and release
      // this device's protection for it, the same way applyDbSettings
      // would if this had arrived via a fresh sign-in instead.
      if (result.rejected.length > 0 && freshRow) {
        for (const key of result.rejected) delete unconfirmed[key];
        setSettings(prev => {
          const merged = { ...prev } as Record<string, unknown>;
          for (const key of result.rejected) if (key in freshRow) merged[key] = freshRow[key];
          saveLocalSettings(merged as unknown as UserSettings);
          return merged as unknown as UserSettings;
        });
      }
      saveUnconfirmed(user.id, unconfirmed);

      setSaveStatus(result.rejected.length > 0 ? 'error' : 'saved');
      setTimeout(() => setSaveStatus('idle'), result.rejected.length > 0 ? 3000 : 2000);
      return;
    }
    /* Every attempt failed. `saveStatus: 'error'` is #1188 part 2's signal -
       SettingsSaveToast.tsx renders it from anywhere, not just /settings.
       These keys stay in the unconfirmed set (update() already added them
       before this ever ran) - #1188 part 3's applyDbSettings below is what
       stops the next sign-in's DB read from silently overwriting them with
       the stale value this save was trying to replace. */
    setSaveStatus('error');
    setTimeout(() => setSaveStatus('idle'), 3000);
  }, [user]);

  // Applies a DB-confirmed row without letting it silently overwrite a field
  // this browser has an unconfirmed local write for - #1188 part 3. Shared by
  // the sign-in effect and refresh() below, which had the identical
  // unconditional-overwrite bug (refresh() exists specifically for
  // server-initiated writes like the Telegram webhook, so a poll landing
  // mid-edit on some OTHER field must not clobber that edit either).
  //
  // Deliberately does NOT re-push unconfirmed fields to the server. An
  // earlier version retried them automatically on every fresh sign-in, using
  // their current (stale) local value - QA traced the real consequence: on
  // device A, a failed save leaves a key unconfirmed with A's OLD value; if
  // device B then successfully saves a NEWER value for that same key, A's
  // next sign-in would keep A's stale value locally (correct, this function's
  // whole job) and then PUSH it back to the server (not this function's job),
  // silently overwriting B's newer, already-confirmed write - repeating on
  // every sign-in until it happened to land. Keeping the local value is the
  // fix; writing it back over someone else's newer change is a different,
  // unsolved problem (no timestamp exists to decide who actually wins) -
  // tracked on #1202, not solved here. This function's contract stays
  // narrow: protect the field locally, touch nothing server-side.
  //
  // Reads the protected value from the unconfirmed MAP itself, never from
  // `settings`/`lhq_settings_v1` - PM/DevOps caught a real cross-account leak
  // in an earlier version that read the value from there: that cache is
  // shared across whichever account most recently used this tab, so it could
  // hold account B's real value at the moment account A's own unconfirmed
  // field was being restored, showing B's setting as A's own, permanently.
  // Storing the value alongside the marker (lib/settings.ts) removes that
  // shared-cache dependency entirely.
  const applyDbSettings = useCallback((userId: string, dbSettings: UserSettings) => {
    const unconfirmed = loadUnconfirmed(userId);
    const keys = Object.keys(unconfirmed);
    if (keys.length === 0) {
      setSettings(dbSettings);
      saveLocalSettings(dbSettings);
      return;
    }
    // Record<string, unknown>, not a per-key generic like #1188 part 3 used
    // against `settingsRef` - the source here is `unconfirmed[key]`, which
    // has already crossed a JSON.parse boundary and is `unknown` by
    // construction, so there is no real UserSettings-typed value left to
    // type-check dest[key] against. Same trade rowToSettings already makes
    // for a DB row.
    const merged = { ...dbSettings } as Record<string, unknown>;
    for (const key of keys) {
      if (!(key in merged)) continue; // stale key from a removed field - ignore
      merged[key] = unconfirmed[key];
    }
    setSettings(merged as unknown as UserSettings);
    saveLocalSettings(merged as unknown as UserSettings);
  }, []);

  // ── Initialise from localStorage immediately (no flash of defaults) ──────
  useEffect(() => {
    setSettings(loadLocalSettings());
    setLoading(false);
  }, []);

  // ── When user signs in: fetch from Supabase and override localStorage ────
  useEffect(() => {
    // QA caught this, #1119-shaped: `user` starts null on every page load,
    // before AuthProvider's session check has resolved - `!user` alone
    // cannot tell "genuinely signed out" from "not known yet" and was
    // treating the second as the first. That wiped clearUnconfirmedKeys()
    // against a merely-not-yet-resolved session on every cold reload, before
    // the protection it exists for ever got a chance to run - reproduced as
    // 10000 -> 55555 -> reload -> back to 10000, marker already gone. Same
    // owner ruling as #1119 applies here: unknown is not a negative. Wait
    // for authLoading to actually settle before treating a null user as a
    // real sign-out.
    if (authLoading) return;
    // #1202 symptom 3: drops the pre-#1202 global unconfirmed-keys key once
    // authLoading settles, regardless of whether a real user resolves -
    // nothing can attribute that legacy key to any one account (see
    // dropLegacyUnconfirmedKey's own comment for why this drops rather than
    // migrates), so there is no "right" account to move it into.
    dropLegacyUnconfirmedKey();
    if (!user) {
      // #1202 symptom 3: used to call clearUnconfirmedKeys() here - needed
      // when the key was global, since a stale marker from THIS account
      // could otherwise wrongly protect a field for the NEXT account signed
      // in on a shared browser. Now namespaced by user id, so a different
      // account's sign-in reads its own key and never sees this one -
      // nothing left here to protect against.
      // #1246: a confirmed sign-out IS an authoritative answer - there is no
      // row to wait for, so DEFAULT_SETTINGS is correct as-is and a consumer
      // gating on settingsLoadStatus should not stay blocked forever here.
      setSettingsLoadStatus('ready');
      return;
    }
    const sb = getSupabase();
    // #1347 item 8: used to just `return` here, leaving settingsLoadStatus
    // at whatever it already was (permanently 'loading' on a fresh session)
    // with no error surfaced - a signed-in user with no client got a silent,
    // permanent skeleton. 'error' at least gives StrategyPanel a real state
    // to render instead of pretending the read is still in flight forever.
    if (!sb) { setSettingsLoadStatus('error'); return; }
    setLoading(true);
    // #1246: a new account id means its row hasn't been read yet, even
    // though the PREVIOUS account's had - without this, switching accounts
    // in one session would leave settingsLoadStatus 'ready' from the old
    // account for the instant before the new read resolves.
    setSettingsLoadStatus('loading');
    sb.from(T.user_settings)
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (data) {
          const row = data as Record<string, unknown>;
          const s   = rowToSettings(row);
          // #1202 core: seed the known-as-of map from this read before
          // anything else touches it, so the very first save this session
          // makes already carries real per-field timestamps.
          if (row.field_updated_at && typeof row.field_updated_at === 'object') {
            fieldUpdatedAtRef.current = row.field_updated_at as Record<string, string>;
          }
          applyDbSettings(user.id, s);

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
                // #1188 part 3: this is a local write same as any update()
                // call, so it needs the same unconfirmed-until-saved marker -
                // otherwise a reload between now and this flush landing would
                // let applyDbSettings silently revert the migrated value.
                const unconfirmed = loadUnconfirmed(user.id);
                unconfirmed.anti_chop_enabled = legacyVal;
                saveUnconfirmed(user.id, unconfirmed);
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
        // #1347 item 2: `error` used to be dropped entirely by the
        // `{ data }` destructure above, so a real Postgrest-level failure
        // (RLS denial, transient DB error) was indistinguishable from "no
        // row yet for a new user" - both landed here and both reported
        // 'ready' with DEFAULT_SETTINGS standing in as a confirmed answer.
        // `data` with no `error` (a real row) and no `data` with no `error`
        // (genuinely new user, nothing saved yet) are both honest 'ready'
        // outcomes; only a real `error` is not.
        setSettingsLoadStatus(error ? 'error' : 'ready');
      }, () => { setLoading(false); setSettingsLoadStatus('error'); });
  }, [user?.id, authLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-read from Supabase on demand ───────────────────────────────────────
  // Same read as the sign-in effect above, minus the one-time anti-chop
  // migration (that must stay one-time). Exposed on the context for flows
  // where the server writes a setting behind the client's back - the Telegram
  // link code is redeemed by the bot webhook, so the Alerts page polls this to
  // notice the connection landed. Also StrategyPanel's Retry action once
  // settingsLoadStatus is 'error' (#1347 item 2).
  //
  // Deliberately does NOT set 'loading' at the start, unlike the sign-in
  // effect: this runs as a background poll (Alerts page) as well as an
  // explicit Retry, and flashing every settingsLoadStatus consumer's loading
  // state (StrategyPanel's skeleton) on each poll tick would be a new,
  // worse annoyance than the bug this fixes.
  //
  // STICKY 'ready' (#1347): a failed refresh must never demote a status that
  // has already reached 'ready' back to 'error' - `refresh` is consumed by
  // the Alerts page too, and that provider is app-wide, so a network blip on
  // an unrelated background poll would otherwise lock the Arena panel's
  // write guard even though `settings` still holds correct, already-loaded
  // data. 'error' means "we have never successfully read this," which is
  // only true the first time this fails, before anything has landed - the
  // functional setState form checks that rather than overwriting blindly.
  const refresh = useCallback(async () => {
    if (!user) return;
    const sb = getSupabase();
    if (!sb) { setSettingsLoadStatus(prev => prev === 'ready' ? prev : 'error'); return; }
    const { data, error } = await sb.from(T.user_settings)
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) { setSettingsLoadStatus(prev => prev === 'ready' ? prev : 'error'); return; }
    if (data) {
      const row = data as Record<string, unknown>;
      const s = rowToSettings(row);
      if (row.field_updated_at && typeof row.field_updated_at === 'object') {
        fieldUpdatedAtRef.current = row.field_updated_at as Record<string, string>;
      }
      applyDbSettings(user.id, s);
    }
    // A successful refresh always confirms 'ready', whether or not a row
    // came back - never a demotion, so unconditional is correct here.
    setSettingsLoadStatus('ready');
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback((partial: Partial<UserSettings>) => {
    // 1. Update local state immediately
    setSettings(prev => {
      const next = { ...prev, ...partial };
      saveLocalSettings(next);
      return next;
    });

    // #1188 part 3: mark these keys unconfirmed SYNCHRONOUSLY, before the
    // debounce below even fires - a reload that happens before the save is
    // ever attempted (not just before it completes) must still protect this
    // field from applyDbSettings' next DB read.
    //
    // #1202 symptom 3: 'anon' is a deliberate shared bucket, not a namespacing
    // gap - a signed-out edit has no account row to reconcile against yet
    // (applyDbSettings only ever runs once a real user.id resolves), so there
    // is nothing for a shared anonymous bucket to wrongly protect. Matches
    // this key's pre-#1202 behaviour exactly for that one case.
    const unconfirmedUserId = user?.id ?? 'anon';
    const unconfirmed = loadUnconfirmed(unconfirmedUserId);
    for (const [key, val] of Object.entries(partial)) unconfirmed[key] = val;
    saveUnconfirmed(unconfirmedUserId, unconfirmed);

    // 2. Merge into pending batch and schedule debounced save
    pendingRef.current = { ...(pendingRef.current ?? {}), ...partial };
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (pendingRef.current) {
        flushToDb(pendingRef.current);
        pendingRef.current = null;
      }
    }, 800);
  }, [flushToDb, user?.id]);

  // Memoized for the same reason LabelsProvider's is: this provider wraps the
  // whole app, so a fresh object literal here re-rendered every useSettings()
  // consumer on every render of this component, regardless of whether any
  // setting actually changed. update/refresh/flushToDb are already useCallback'd,
  // so the identity is stable until the values genuinely move.
  const value = useMemo(
    () => ({ settings, loading, settingsLoadStatus, saveStatus, update, refresh }),
    [settings, loading, settingsLoadStatus, saveStatus, update, refresh],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}
