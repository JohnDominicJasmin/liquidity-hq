import NotFoundContent from '@/components/NotFoundContent';

/* THIS FILE MUST STAY STATIC. No `headers()`, no `cookies()`, no `dynamic =
 * 'force-dynamic'`, no request-time read of any kind. (#1434)
 *
 * It looks like a page that only runs when something is not found. It is not.
 * Next builds the root not-found element for EVERY page render and hands it to
 * the boundary that would show it (node_modules/next/dist/server/app-render/
 * create-component-tree.js: `notFound: notFoundElement` on the
 * HTTPAccessFallbackBoundary). So whatever this component does, every page in
 * the app does, on every request.
 *
 * On 2026-09-13 (#1251) this file started calling `headers()` to log which
 * path had 404'd. That one call, running inside every page's render, opted the
 * whole site out of static rendering:
 *
 *   - every page, /faq and /terms included, was rendered on the server per
 *     request and sent `Cache-Control: private, no-cache, no-store`;
 *   - app/[locale]/page.tsx was no longer prerendered, so its
 *     `dynamicParams = false` had nothing to compare against, the page rendered
 *     for ANY single-segment path and called notFound() after the response had
 *     started - and every made-up URL answered 200 again, the exact soft-404
 *     #157 reported and #163 had fixed;
 *   - and the log line it existed for, `[not-found] <path>`, was written for
 *     every page view of every page, not for 404s.
 *
 * The path of a real 404 does not need logging from here: once unknown URLs
 * answer 404 again, the host's request log carries the path and the status for
 * each one. What is lost is the referer #1251 also recorded; if that is wanted
 * back it has to come from somewhere that does not render with every page (a
 * beacon from the client component below, for example), never from this file. */
export default function NotFound() {
  return <NotFoundContent />;
}
