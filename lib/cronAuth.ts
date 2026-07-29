import { timingSafeEqual } from 'crypto';

// Shared gate for the cron/scheduler-only routes (telegram/alert, macro-alert,
// signals/track, alert-outcomes/resolve, telegram/setup-webhook - see
// docs/INFRASTRUCTURE.md §2 for what actually calls these on a schedule).
//
// Previously each route inlined `if (secret) { check } ` - fail-OPEN: with
// CRON_SECRET unset (the confirmed state of prod as of this writing, since
// none of cron-job.org's jobs send the header), every one of these routes
// ran fully unauthenticated. This fails CLOSED instead, matching the
// lemonsqueezy webhook's verifySignature pattern: no secret configured means
// deny by default, not allow by default.
//
// Deploying this to prod WILL start rejecting the live cron-job.org jobs
// until CRON_SECRET is set in Render's env AND those jobs are updated to
// send a matching `x-cron-secret` header - do that first (or in the same
// window), not after. See docs/INFRASTRUCTURE.md §2's own warning.
// Takes a plain Request (NextRequest extends it) - some of these routes use
// the bare Web Request type rather than NextRequest, so this reads the query
// string via `new URL(req.url)` instead of `req.nextUrl` to work for both.
export function checkCronAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const provided = req.headers.get('x-cron-secret') ?? new URL(req.url).searchParams.get('secret') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
