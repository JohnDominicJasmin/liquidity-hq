/* The read deadlines, in one dependency-free file so the browser caller (lib/grok.ts) and the route (app/api/grok/route.ts) name the same numbers.
 * The SERVER's deadline is always under the CLIENT's: the server ends the upstream call and refunds the reservation before the client gives up, so a slow read is never "took too long" on screen while still being billed. */
export const GROK_QUICK_TIMEOUT_MS = 90_000;
export const GROK_DEEP_TIMEOUT_MS = 200_000;
export const GROK_SERVER_QUICK_MS = 80_000;
export const GROK_SERVER_DEEP_MS = 180_000;
