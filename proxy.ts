/* Block /backtest and /live-tracking at the edge (#264).
 *
 * The owner asked for these pages hidden, and chose BLOCK THE ROUTES over hiding
 * the nav links — so a bookmark or a typed URL must not reach them either.
 *
 * ── WHY THIS FILE IS `proxy.ts` AND NOT `middleware.ts` ─────────────────────
 *
 * `middleware` is DEPRECATED in this version of Next and renamed to `proxy`.
 * From node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:
 *
 *   > The `middleware` file convention is deprecated and has been renamed to
 *   > `proxy`.
 *
 * A `middleware.ts` written from memory would sit in the repo doing NOTHING,
 * and the symptom would be "the routes are still reachable" with no error
 * anywhere — which reads as a broken redirect rather than a file Next never
 * loaded. This is the exact case AGENTS.md opens with: read the local docs
 * before writing framework code, because the docs in your head are older than
 * this project.
 *
 * ── REDIRECT, NOT 404 ───────────────────────────────────────────────────────
 *
 * QA's recommendation and I agree: an existing bookmark lands somewhere useful
 * rather than on a dead end, and re-enabling is deleting two strings from the
 * list below. A 404 would be right only if these pages should look like they
 * never existed, which is not what was asked.
 *
 * The pages themselves are left intact. Reversing this is a one-line change
 * here, not a restore from history.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SITE_GATE_COOKIE, SITE_GATE_COOKIE_MAX_AGE_S, SITE_GATE_REALM, SITE_GATE_ROBOTS_TAG, SITE_GATE_ROBOTS_TXT, siteGateBasicOk, siteGateCookieValue, siteGateDecision } from '@/lib/siteGate';

/** Exact paths only. A future /backtest/results should be a deliberate decision,
 *  not something that silently inherits this one — same reasoning as
 *  `isChromeless` and the (now removed) market-data exemption in AppShell. */
const BLOCKED = new Set(['/backtest', '/live-tracking']);

/* THE TEAM-ONLY GATE (lib/siteGate.ts; owner ask 2026-11-19): when SITE_GATE_PASSWORD is set (dev, qa and staging, never production) every page and API needs HTTP Basic auth, every response carries
   `X-Robots-Tag: noindex, nofollow`, and /robots.txt says "disallow all". With the variable unset or empty this function behaves exactly as before: the gate code below is never reached. */
export function proxy(request: NextRequest) {
  const gatePassword = process.env.SITE_GATE_PASSWORD;
  if (gatePassword) {
    const decision = siteGateDecision(
      { pathname: request.nextUrl.pathname, authorization: request.headers.get('authorization'), cronSecretHeader: request.headers.get('x-cron-secret'), cookie: request.headers.get('cookie') },
      { password: gatePassword, cronSecret: process.env.CRON_SECRET },
    );
    if (decision === 'robots') {
      return new NextResponse(SITE_GATE_ROBOTS_TXT, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': SITE_GATE_ROBOTS_TAG } });
    }
    if (decision === 'deny') {
      return new NextResponse('Authentication required.', {
        status: 401,
        headers: { 'WWW-Authenticate': `Basic realm="${SITE_GATE_REALM}", charset="UTF-8"`, 'X-Robots-Tag': SITE_GATE_ROBOTS_TAG, 'Cache-Control': 'no-store' },
      });
    }
    const res = routeBlocked(request) ?? NextResponse.next();
    res.headers.set('X-Robots-Tag', SITE_GATE_ROBOTS_TAG);
    /* The cookie is handed out ONLY after a correct HTTP Basic password (never on a cookie-only, cron or exempt pass), so the app's Bearer-carrying fetches get through behind the gate (lib/siteGate.ts). */
    if (siteGateBasicOk(request.headers.get('authorization'), gatePassword)) {
      res.cookies.set(SITE_GATE_COOKIE, siteGateCookieValue(gatePassword), { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: SITE_GATE_COOKIE_MAX_AGE_S });
    }
    return res;
  }
  return routeBlocked(request) ?? NextResponse.next();
}

function routeBlocked(request: NextRequest): NextResponse | null {
  if (BLOCKED.has(request.nextUrl.pathname)) {
    /* 307, the NextResponse.redirect default: a temporary redirect, because
       these pages are hidden rather than retired. A 308 would be cached by
       browsers and would outlive the decision. */
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }
  return null;
}

/* THE MATCHER IS WIDE NOW, AND THE FUNCTION IS A NO-OP FOR THE OLD CASE. It was scoped to the two blocked paths (#1434: from 2026-09-13 this ran on every page request to tag each one with an
   `x-lhq-pathname` header that app/not-found.tsx read back through `headers()`; that READ broke the 404s it was meant to explain, and it is gone). The gate has to see every page and API request,
   and a matcher must be a constant (it cannot depend on the environment), so it matches everything except Next's own static assets; with SITE_GATE_PASSWORD unset the function returns
   `NextResponse.next()` for every path but the two blocked ones, which it redirects exactly as before. Nothing here reads headers() or sets a header when the gate is off. */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
