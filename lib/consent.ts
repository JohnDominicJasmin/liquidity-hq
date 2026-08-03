// Analytics consent. PostHog - product analytics AND session replay - must not
// run until the user has actively accepted; see components/CookieConsent.tsx
// (the banner) and components/PostHogProvider.tsx (the gate).
//
// 'unknown' is deliberately a separate state from 'denied'. Unknown means "we
// have not asked yet, show the banner"; denied means "asked and refused, stay
// quiet". Collapsing the two would re-prompt on every load after a refusal,
// which is both annoying and the kind of nagging that consent rules treat as
// not-freely-given.
//
// Default is denied-by-default in effect: anything that is not an explicit
// stored 'granted' results in no PostHog init at all.

export type ConsentState = 'unknown' | 'granted' | 'denied';

const KEY = 'lhq_analytics_consent_v1';
const EVENT = 'lhq-consent-change';

export function readConsent(): ConsentState {
  if (typeof window === 'undefined') return 'unknown';
  try {
    const raw = localStorage.getItem(KEY);
    return raw === 'granted' || raw === 'denied' ? raw : 'unknown';
  } catch {
    // Private mode / storage blocked. Treat as not-granted rather than
    // assuming consent - failing open here would be the whole point missed.
    return 'unknown';
  }
}

export function writeConsent(state: Exclude<ConsentState, 'unknown'>): void {
  try { localStorage.setItem(KEY, state); } catch { /* ignore */ }
  // The native 'storage' event only fires in OTHER tabs, so without this
  // custom event PostHogProvider would not react to the banner in the very
  // tab the user clicked it in - consent would not take effect until reload.
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: state })); } catch { /* ignore */ }
}

export function onConsentChange(cb: (s: ConsentState) => void): () => void {
  const handler = () => cb(readConsent());
  window.addEventListener(EVENT, handler);   // this tab
  window.addEventListener('storage', handler); // other tabs
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}
