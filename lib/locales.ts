// The app-wide locale list, kept in its own module with NO react import so
// server code can use it. lib/labels.ts pulls in createContext/useContext, so
// importing the list from there drags React's client runtime into any API
// route that needs it and the build fails at the client/server boundary.
// lib/labels.ts re-exports these, so existing client imports are unchanged.
//
// Matches the landing page's SUPPORTED_LOCALES (lib/i18n/dictionaries.ts) plus
// the additional languages picked for the app-wide rollout - the two systems
// are deliberately separate (landing stays build-time static) but share the
// same locale codes. Note dictionaries.ts carries only the landing subset, so
// it is NOT a substitute for this list.
export type Locale = 'en' | 'ko' | 'zh' | 'ar' | 'vi' | 'pt-BR' | 'tr' | 'es' | 'id' | 'ru';

// Every locale the app KNOWS about. Stays complete on purpose: it is the
// validation list, so a preference already saved as 'tr' still resolves
// instead of erroring, and re-adding a language later is a one-line change
// to AVAILABLE_LOCALES rather than a migration.
export const SUPPORTED_LOCALES: Locale[] = ['en', 'ko', 'zh', 'ar', 'vi', 'pt-BR', 'tr', 'es', 'id', 'ru'];

// Locales that actually have translations in the labels table, and therefore
// the only ones worth OFFERING in a picker.
//
// Measured 2026-08-03, identical in dev and prod: en 2570 rows, ko/zh/ar/ru
// 2416 each, and vi/pt-BR/tr/es/id ZERO. The pickers listed all ten, so
// choosing Türkçe stored the preference, flipped the label to TR, and then
// rendered English - the labels API layers English under every locale, so an
// unseeded language degrades silently rather than visibly failing. Offering a
// language and then ignoring the choice is worse than not offering it.
//
// Add a locale back here the moment its rows land; nothing else needs to
// change. See the i18n section of pendings/PENDING.md.
export const AVAILABLE_LOCALES: Locale[] = ['en', 'ko', 'zh', 'ar', 'ru'];

export function isSupportedLocale(v: string): v is Locale {
  return (SUPPORTED_LOCALES as string[]).includes(v);
}
