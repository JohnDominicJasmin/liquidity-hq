/* THE TEAM-ONLY GATE for the dev, qa and staging sites (owner ask via PM, 2026-11-19).
 *
 * ACTIVE ONLY WHEN `SITE_GATE_PASSWORD` IS SET. It is never set on production, so production takes the old code path untouched: no gate, no header, no robots change (proxy.ts checks the variable first and
 * returns to its previous behaviour when it is empty or absent).
 *
 * WHAT IT DOES, when the variable is set: HTTP Basic auth on every page and API (any user name; the password must equal the variable; the browser remembers it for the origin, and Playwright gives it through
 * `httpCredentials`), `X-Robots-Tag: noindex, nofollow` on every response, and `/robots.txt` answered here with "disallow all" (so a crawler reads the refusal instead of a login wall).
 *
 * EXEMPT, because something that is not a person with a password must reach them:
 *   - /api/version: Render's health check and our own deploy checks (it reports a commit and a branch, nothing else).
 *   - a request carrying `x-cron-secret` equal to CRON_SECRET: the scheduled routes (ingest, alerts, tracking). A WRONG secret is not exempt: it gets the login challenge like anyone else.
 *   - the payment and bot webhooks (each verifies its own signature or secret token): /api/lemonsqueezy/webhook, /api/boomfi/webhook, /api/whop/webhook, /api/telegram/webhook.
 *
 * No password is written in the repo: it comes from the environment of each gated service and from a GitHub secret for the browser tests. PURE: no request or environment object here, so it is unit-testable. */
import { createHash, timingSafeEqual } from 'node:crypto';

export const SITE_GATE_REALM = 'Team only';
export const SITE_GATE_EXEMPT_PATHS: readonly string[] = [
  '/api/version',
  '/api/lemonsqueezy/webhook',
  '/api/boomfi/webhook',
  '/api/whop/webhook',
  '/api/telegram/webhook',
];
export const SITE_GATE_ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';
export const SITE_GATE_ROBOTS_TAG = 'noindex, nofollow';

export type SiteGateDecision = 'robots' | 'allow' | 'deny';

const digest = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();
/** Equal strings, compared without a timing difference that depends on where they first differ. */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

/** The password out of an `Authorization: Basic ...` header, or null. The user name is ignored; the password may contain colons. */
export function basicPassword(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const m = /^Basic\s+([A-Za-z0-9+/=_-]+)\s*$/i.exec(authorization);
  if (!m) return null;
  let decoded: string;
  try { decoded = Buffer.from(m[1], 'base64').toString('utf8'); } catch { return null; }
  const i = decoded.indexOf(':');
  return i < 0 ? null : decoded.slice(i + 1);
}

/** What the gate does with one request. `password` is SITE_GATE_PASSWORD (non-empty: the caller only asks when the gate is on); `cronSecret` is CRON_SECRET (may be empty: then no request is exempt by secret). */
export function siteGateDecision(
  req: { pathname: string; authorization?: string | null; cronSecretHeader?: string | null },
  env: { password: string; cronSecret?: string | null },
): SiteGateDecision {
  if (req.pathname === '/robots.txt') return 'robots';
  if (SITE_GATE_EXEMPT_PATHS.includes(req.pathname)) return 'allow';
  if (env.cronSecret && req.cronSecretHeader && safeEqual(req.cronSecretHeader, env.cronSecret)) return 'allow';
  const given = basicPassword(req.authorization);
  return given != null && safeEqual(given, env.password) ? 'allow' : 'deny';
}
