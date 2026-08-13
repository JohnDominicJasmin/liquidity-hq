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

/** Exact paths only. A future /backtest/results should be a deliberate decision,
 *  not something that silently inherits this one — same reasoning as
 *  `isChromeless` and the (now removed) market-data exemption in AppShell. */
const BLOCKED = new Set(['/backtest', '/live-tracking']);

export function proxy(request: NextRequest) {
  if (BLOCKED.has(request.nextUrl.pathname)) {
    /* 307, the NextResponse.redirect default: a temporary redirect, because
       these pages are hidden rather than retired. A 308 would be cached by
       browsers and would outlive the decision. */
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }
  return NextResponse.next();
}

/* Scoped so this runs for two paths and nothing else. Without a matcher the
   proxy executes on every request in the app for a two-entry lookup. */
export const config = {
  matcher: ['/backtest', '/live-tracking'],
};
