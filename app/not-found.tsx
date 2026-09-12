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
 * in proxy.ts, which excludes the query string by construction - and
 * `referer` (when a browser sends one) is a URL, not anything that
 * identifies a person. Nothing else about the request is logged. */
export default async function NotFound() {
  const h = await headers();
  const pathname = h.get('x-lhq-pathname') ?? '(unknown path)';
  const referer = h.get('referer');
  console.warn('[not-found]', pathname, referer ? `referer=${referer}` : '(no referer)');
  return <NotFoundContent />;
}
