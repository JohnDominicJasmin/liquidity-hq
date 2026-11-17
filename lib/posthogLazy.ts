/* POSTHOG, LOADED ONLY WHEN IT IS USED (speed audit 2026-11-17: posthog-js was in the first-load JavaScript of every page, about 100 KB of the 540 KB a static page shipped, for visitors who may never consent).
 *
 * The app only ever initialises PostHog after the visitor has consented (components/PostHogProvider.tsx), so the library has no work to do before that. This module has the same call surface the app uses
 * (capture, identify, reset, init, opt_in_capturing, opt_out_capturing) and imports posthog-js on the first `init`, after the page's load event and an idle moment. Until `init` has been asked for, every call is
 * dropped, exactly what the library did when it was not initialised (the old code called capture / identify before init and they did nothing). Once `init` is pending, calls are kept in order and run when the
 * library has loaded. No consent means the library is never downloaded. */
import type { PostHog, PostHogConfig } from 'posthog-js';

let ph: PostHog | null = null;
let wanted = false;          // init has been asked for
let scheduled = false;
const queue: Array<(p: PostHog) => void> = [];

function run(fn: (p: PostHog) => void) {
  try { fn(ph as PostHog); } catch { /* an analytics call never breaks the app */ }
}

function loadNow() {
  import('posthog-js').then((m) => {
    ph = m.default;
    for (const fn of queue.splice(0)) run(fn);
  }).catch(() => { queue.length = 0; });
}

function schedule() {
  if (scheduled || typeof window === 'undefined') return;
  scheduled = true;
  const idle = () => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(loadNow, { timeout: 4000 });
    else setTimeout(loadNow, 2500);
  };
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
}

function call(fn: (p: PostHog) => void) {
  if (ph) { run(fn); return; }
  if (!wanted) return;       // never initialised: a no-op, as before
  queue.push(fn);
}

export const posthog = {
  init(key: string, config: Partial<PostHogConfig>) {
    wanted = true;
    queue.push((p) => { p.init(key, config); });
    if (ph) { for (const fn of queue.splice(0)) run(fn); return; }
    schedule();
  },
  capture(event: string, props?: Record<string, unknown>) { call((p) => { p.capture(event, props); }); },
  identify(id: string) { call((p) => { p.identify(id); }); },
  reset() { call((p) => { p.reset(); }); },
  opt_in_capturing() { call((p) => { p.opt_in_capturing(); }); },
  opt_out_capturing() { call((p) => { p.opt_out_capturing(); }); },
};
