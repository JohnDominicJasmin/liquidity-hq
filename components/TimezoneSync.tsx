'use client';
import { useEffect } from 'react';
import { useSettings } from '@/lib/settings';

// Detects the browser's IANA timezone and persists it to user_settings when it
// differs from what's stored. Renders nothing - mounted once inside AppShell,
// same shape as LanguageSync.
//
// Why detect instead of asking: the server has no way to know a user's
// timezone, and Telegram alerts need it to stamp each subscriber's own local
// time (app/api/telegram/alert/route.ts). Those alerts used to carry Philippine
// time for everyone, then UTC once that was recognised as wrong - honest, but
// still nobody's actual clock. A timezone dropdown is a chore users skip, and
// the browser already knows the answer; detecting also self-corrects when
// someone travels or switches machine, which a once-set preference never would.
//
// Deliberately does NOT write for signed-out visitors - `update()` only
// persists for an authenticated user, and there is no row to attach it to
// otherwise.
export default function TimezoneSync() {
  const { settings, settingsLoadStatus, update } = useSettings();

  useEffect(() => {
    // #1347 item 19: was gated on `loading`, which flips false as soon as
    // the SYNCHRONOUS localStorage read completes on mount - well before
    // the authoritative DB read (settingsLoadStatus) has resolved, and
    // still true even when that read FAILS outright. Comparing against
    // `settings.timezone` at that point compares the browser's real
    // timezone against a stale localStorage/default value, not the
    // account's actual saved one - the same "acted on settings before the
    // authoritative source landed" shape as item 2, caught the same way
    // (a captured PATCH body during a settings-read failure showed this
    // firing with a genuinely failed read, unrelated to strategy_selection
    // and with no error state of its own to stop it). `!== 'ready'` means
    // this waits out both "still loading" and "the read failed" -
    // identical to every other settingsLoadStatus consumer from this audit.
    if (settingsLoadStatus !== 'ready') return;

    let tz: string | undefined;
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return; // No Intl timezone support - leave it null, alerts fall back to UTC.
    }
    if (!tz || tz === settings.timezone) return;

    update({ timezone: tz });
  }, [settingsLoadStatus, settings.timezone, update]);

  return null;
}
