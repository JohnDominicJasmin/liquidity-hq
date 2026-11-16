/* A SIGNAL THAT ABORTS AFTER `ms`, ON EVERY BROWSER. `AbortSignal.timeout` does not exist on Safari/iOS before 16 (and some older WebViews), where calling it THROWS - so every read that built its
 * deadline with it failed outright there (#2389 added it to the Supabase client and a dozen call sites). This uses the native one when present and an AbortController + timer otherwise.
 * Use it for every browser-side deadline. */
export function deadlineSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(typeof DOMException !== 'undefined' ? new DOMException('The operation timed out.', 'TimeoutError') : undefined), ms);
  return c.signal;
}
