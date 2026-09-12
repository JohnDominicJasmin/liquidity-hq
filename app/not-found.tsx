import { headers } from 'next/headers';
import NotFoundContent from '@/components/NotFoundContent';

export const dynamic = 'force-dynamic';

/* #1251: production logs a bare `NoFallbackError` for an ungenerated dynamic
 * route (e.g. app/[locale]/page.tsx's `dynamicParams = false`) with no path
 * attached, so a crawler probe, a stale tab requesting an old build's route
 * after a deploy, and a genuinely broken link are indistinguishable after
 * the fact. The not-found boundary itself receives no information about the
 * URL that triggered it - that's a React Server Components limitation, not
 * an oversight here - so proxy.ts tags every page request with its own
 * pathname via a request header, and this reads it back.
 *
 * Warn level, not error: a 404 render is not, by itself, a server fault.
 * Pathname only - `x-lhq-pathname` is set from `request.nextUrl.pathname`
 * in proxy.ts, which excludes the query string by construction.
 *
 * The referer is NEVER logged raw (PM caught this in review). next.config.ts
 * sets `Referrer-Policy: strict-origin-when-cross-origin`, which only trims
 * the referer on CROSS-origin navigation - a same-origin navigation (the
 * common case for a 404 reached by clicking a stale in-app link) still sends
 * the full previous URL, query string included. That previous page could be
 * an auth callback (`?code=`), a password reset, or a checkout link - any of
 * those tokens would land in production logs the moment the next request
 * happens to 404. `refererOrigin` below keeps only the scheme+host+pathname
 * via `new URL()`, which drops the query and hash by construction, and never
 * throws into the render path if the referer isn't a parseable URL. */
function safeRefererOriginAndPath(referer: string | null): string | null {
  if (!referer) return null;
  try {
    const u = new URL(referer);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '(unparseable referer)';
  }
}

export default async function NotFound() {
  const h = await headers();
  const pathname = h.get('x-lhq-pathname') ?? '(unknown path)';
  const referer = safeRefererOriginAndPath(h.get('referer'));
  console.warn('[not-found]', pathname, referer ? `referer=${referer}` : '(no referer)');
  return <NotFoundContent />;
}
