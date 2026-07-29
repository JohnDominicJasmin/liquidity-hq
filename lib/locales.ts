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

export const SUPPORTED_LOCALES: Locale[] = ['en', 'ko', 'zh', 'ar', 'vi', 'pt-BR', 'tr', 'es', 'id', 'ru'];

export function isSupportedLocale(v: string): v is Locale {
  return (SUPPORTED_LOCALES as string[]).includes(v);
}
