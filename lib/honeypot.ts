import { rateLimit } from '@/lib/rateLimit';

/* HONEYPOT HITS GO TO THE LOGS, BOUNDED (security audit #1413, S9). The /admin page and the /api/admin/* catch-all wrote the caller's own pathname (up to about 16 KB, attacker-chosen)
 * and user agent into the REAL admin audit log, one row per request on the page and five a minute per IP on the route: a cheap way to bury genuine admin actions and grow the
 * table. They now write ONE short structured line to the server log (Render logs), every field truncated and stripped of control characters, under a global cap, and nothing to the
 * database. The routes still answer the same 404 either way. */
const clean = (v: string | null | undefined, max: number): string =>
  (v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);

export function logHoneypotHit(kind: 'admin_api' | 'admin_page', f: { method?: string; path?: string; ip?: string | null; ua?: string | null }): void {
  // A global cap on log lines, so a flood cannot become a log flood either.
  if (!rateLimit('honeypot-log:all', 120, 60_000)) return;
  console.warn(`[honeypot] ${kind} ${JSON.stringify({ method: clean(f.method, 8), path: clean(f.path, 120), ip: clean(f.ip, 64), ua: clean(f.ua, 120) })}`);
}
