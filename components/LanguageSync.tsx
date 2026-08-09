'use client';
import { useEffect } from 'react';
import { useSettings } from '@/lib/settings';
import { useLabels, resolveOfferedLocale } from '@/lib/labels';

// One-way sync: a signed-in user's saved language (user_settings.language)
// applies to the label system on load/login, so the choice follows them
// across devices. Renders nothing - mounted once inside AppShell, inside
// both SettingsProvider and LabelsProvider so it can read one and write the
// other. The write direction (user picks a language -> persisted to
// user_settings) lives in LanguageSelect, next to where the choice is made.
export default function LanguageSync() {
  const { settings } = useSettings();
  const { locale, setLocale } = useLabels();

  useEffect(() => {
    /* Clamped the same way as the localStorage path: a saved user_settings
       .language that is no longer offered resolves to English rather than
       reinstating a language with no picker entry (#165). */
    const wanted = resolveOfferedLocale(settings.language);
    if (settings.language && wanted !== locale) {
      setLocale(wanted);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.language]);

  return null;
}
