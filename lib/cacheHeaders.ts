/* The Cache-Control header for data a page POLLS (#1626 part 2, item B).
 *
 * These routes used to answer `public, s-maxage=N, stale-while-revalidate=600`. There is no max-age, so a browser's own cache treats the answer as
 * immediately stale - and `stale-while-revalidate` lets ANY cache, the browser's included, hand that stale answer back at once and refresh it in
 * the background. A page that polls every 30 s therefore kept being given the PREVIOUS poll's body: measured by PM, transferSize 0 and a body 46 s
 * old, and a HYPE price over 8 minutes old next to a live chart.
 *
 * Now: `max-age=0, must-revalidate` - the browser may not reuse an answer without asking again (and these answers carry no validator, so asking
 * again is a fresh request) - and no stale-while-revalidate. `s-maxage` stays for a shared edge cache in front of the app, which may hold an
 * answer for N seconds (none does today; Cloudflare passes these through). The SERVER's own cache (lib/apiCache.ts, per-route TTLs) is
 * unchanged, so upstream traffic does not change: a poll is answered from the server's memory. */
export function polledCacheControl(sMaxAgeSeconds: number): string {
  return `public, max-age=0, must-revalidate, s-maxage=${Math.max(0, Math.floor(sMaxAgeSeconds))}`;
}
