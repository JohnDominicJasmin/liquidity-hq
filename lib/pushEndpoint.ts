/* WHAT A PUSH SUBSCRIPTION MAY CONTAIN (security audit #1413, 2026-11-14).
 *
 * `/api/push/subscribe` stored whatever `endpoint` it was given, and the alert cron later sends a request to that URL from the server. An attacker could therefore
 * save an internal or arbitrary URL and have the server call it (stored SSRF). A real browser endpoint is always an HTTPS URL on its push service's host, so that is
 * the only thing accepted: a push service host allowlist, https only, no credentials, default port, bounded length. The keys are base64url strings of bounded length. */

const PUSH_HOST_SUFFIXES = [
  'fcm.googleapis.com',            // Chrome, Edge, Brave, Opera, Samsung, Android
  'android.googleapis.com',        // legacy GCM endpoints
  'push.services.mozilla.com',     // Firefox (updates.push.services.mozilla.com and regional hosts)
  'push.apple.com',                // Safari / iOS web push (web.push.apple.com)
  'notify.windows.com',            // Windows Notification Service (wns2-*.notify.windows.com)
] as const;

export const MAX_ENDPOINT_LENGTH = 2048;
export const MAX_KEY_LENGTH = 256;
const BASE64URL = /^[A-Za-z0-9_\-+/=]+$/;

export function isPushHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some(s => h === s || h.endsWith('.' + s));
}

/** The endpoint, normalised, or null when it is not an https URL on a known push service. */
export function validPushEndpoint(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_ENDPOINT_LENGTH) return null;
  let u: URL;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  if (!isPushHost(u.hostname)) return null;
  return u.toString();
}

export function validPushKey(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_KEY_LENGTH && BASE64URL.test(v) ? v : null;
}
