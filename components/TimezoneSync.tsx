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
  const { settings, loading, update } = useSettings();

  useEffect(() => {
    // Wait for the real row: while loading, `settings` is still localStorage or
    // defaults, so comparing against it would fire a redundant write on every
    // page load before the fetch resolves.
    if (loading) return;

    let tz: string | undefined;
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return; // No Intl timezone support - leave it null, alerts fall back to UTC.
    }
    if (!tz || tz === settings.timezone) return;

    update({ timezone: tz });
  }, [loading, settings.timezone, update]);

  return null;
}
