'use client';
import { useAuth } from '@/components/AuthProvider';
import { useSettings } from '@/lib/settings';
import { useLabels, SUPPORTED_LOCALES, type Locale } from '@/lib/labels';

// Distinct from the landing page's LanguageSwitcher.tsx (that one navigates
// between static /[locale] routes; this one flips the runtime label system
// for the signed-in app). Reuses the existing st-chip-row styling from the
// Default Timeframe field so it matches the rest of Settings.
const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  ko: '한국어',
  zh: '中文',
  ar: 'العربية',
  vi: 'Tiếng Việt',
  'pt-BR': 'Português',
  tr: 'Türkçe',
  es: 'Español',
  id: 'Indonesia',
  ru: 'Русский',
};

export default function LanguageSelect() {
  const { locale, setLocale } = useLabels();
  const { user } = useAuth();
  const { update } = useSettings();

  const choose = (l: Locale) => {
    setLocale(l);
    if (user) update({ language: l });
  };

  return (
    <div className="st-chip-row">
      {SUPPORTED_LOCALES.map(l => (
        <button
          key={l}
          type="button"
          className={`st-chip${locale === l ? ' on' : ''}`}
          onClick={() => choose(l)}
        >
          {LOCALE_LABELS[l]}
        </button>
      ))}
    </div>
  );
}
