'use client';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from './AuthProvider';
import { useSettings } from '@/lib/settings';
import { useLabels, AVAILABLE_LOCALES, type Locale } from '@/lib/labels';

// Locale names shown in their own language - deliberately not run through
// t(), same choice as LanguageSelect.tsx (a language name is the one string
// that should never be translated out of its own language).
const LOCALE_SHORT: Record<Locale, string> = {
  en: 'EN', ko: 'KO', zh: 'ZH', ar: 'AR', vi: 'VI',
  'pt-BR': 'PT', tr: 'TR', es: 'ES', id: 'ID', ru: 'RU',
};
const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English', ko: '한국어', zh: '中文', ar: 'العربية', vi: 'Tiếng Việt',
  'pt-BR': 'Português', tr: 'Türkçe', es: 'Español', id: 'Indonesia', ru: 'Русский',
};

// Top-nav language switcher, always rendered regardless of auth state or
// viewport width - unlike the Settings switcher (LanguageSelect.tsx), which
// only reaches the signed-in user via the avatar dropdown, and the mobile
// drawer's hamburger, which is CSS-hidden at desktop widths (>=768px, see
// globals.css .hamburger media rules). Before this, a signed-out desktop
// visitor - e.g. anyone on /login right after "Get Started Free" - had zero
// way to change language until after they finished signing in.
export default function LanguageNavSwitcher() {
  const { locale, setLocale } = useLabels();
  const { user } = useAuth();
  const { update } = useSettings();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (l: Locale) => {
    setLocale(l);
    if (user) update({ language: l });
    setOpen(false);
  };

  return (
    <div className="lang-nav-wrap" ref={wrapRef}>
      <button
        type="button"
        className="lang-nav-btn"
        onClick={() => setOpen(v => !v)}
        aria-label="Change language"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {LOCALE_SHORT[locale]}
      </button>
      {open && (
        <div className="lang-nav-dropdown" role="menu">
          {/* AVAILABLE_LOCALES, not SUPPORTED_LOCALES - only offer languages
              that actually have rows. See lib/locales.ts. */}
          {AVAILABLE_LOCALES.map(l => (
            <button
              key={l}
              type="button"
              role="menuitem"
              className={`lang-nav-item${locale === l ? ' on' : ''}`}
              onClick={() => choose(l)}
            >
              {LOCALE_LABELS[l]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
