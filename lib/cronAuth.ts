import { timingSafeEqual } from 'crypto';

// Shared gate for the cron/scheduler-only routes (telegram/alert, macro-alert,
// signals/track, alert-outcomes/resolve, telegram/setup-webhook - see
// docs/INFRASTRUCTURE.md §2 for what actually calls these on a schedule).
//
// Previously each route inlined `if (secret) { check } ` - fail-OPEN: with
// CRON_SECRET unset, every one of these routes ran fully unauthenticated.
// This fails CLOSED instead, matching the lemonsqueezy webhook's
// verifySignature pattern: no secret configured means deny by default, not
// allow by default.
//
// CRON_SECRET IS set on prod (corrected 2026-07-25, see docs/INFRASTRUCTURE.md
// §2 - this comment previously said otherwise and was stale). All live
// cron-job.org jobs send a matching `x-cron-secret` header. Any NEW job or
// n8n workflow hitting one of these routes needs that header from the start.
// Takes a plain Request (NextRequest extends it) - some of these routes use
// the bare Web Request type rather than NextRequest, so this reads the query
// string via `new URL(req.url)` instead of `req.nextUrl` to work for both.
/**
 * @param opts.headerOnly refuse `?secret=` and accept the header alone. The query form is fine for the cron callers this was built
 *   for - they are configured once in cron-job.org - but a **query string travels**: into access logs, into `Referer`, into a URL
 *   someone pastes in a ticket or a monitor config. A caller that has no cron scheduler behind it gains nothing from it, so
 *   `/api/health` passes this (#1649, QA's review). Default false, so every existing caller is unchanged.
 */
export function checkCronAuth(req: Request, opts: { headerOnly?: boolean } = {}): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const provided = opts.headerOnly
    ? req.headers.get('x-cron-secret') ?? ''
    : req.headers.get('x-cron-secret') ?? new URL(req.url).searchParams.get('secret') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
