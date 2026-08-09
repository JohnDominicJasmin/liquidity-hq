/* PostHog session-replay masking.
 *
 * Session replay is ON in production - posthog-recorder.js loads and records
 * real users. `maskAllInputs: true` covers what a user TYPES. It does not cover
 * what the app RENDERS, and rendered text is where this app keeps the sensitive
 * material: a trade's notes and thesis, every P&L figure, every position size.
 *
 * That leaked once already and was fixed by hand, with a list of the five class
 * names that happened to be dangerous at the time:
 *
 *   maskTextSelector: '.tj-trade-notes, .tj-tp-val, .tj-stat-val, ...'
 *
 * A deny-list fails OPEN. A field added to TradeJournal defaults to captured in
 * the clear, a rename silently stops masking, and neither produces an error, a
 * warning or a failing test - the only artifact is a video in PostHog that
 * nobody on this side watches.
 *
 * So this is inverted. `.lhq-private` marks a subtree as private and everything
 * inside it is masked; a new field there is masked because it is inside, not
 * because someone remembered. The exception is opt-in and deliberate.
 *
 * HOW rrweb ACTUALLY DECIDES, because both halves depend on it:
 *
 *   1. masking is ancestor-aware - `el.closest(maskTextSelector)`, verified in
 *      the bundled rrweb - so ONE class on a container covers every descendant.
 *   2. `maskTextFn` is called ONLY for text rrweb has already decided to mask,
 *      and is handed the text node's parent element:
 *        maskTextFn ? maskTextFn(text, parentElement(n)) : text.replace(/[\S]/g, '*')
 *      which is what makes an un-mask possible at all.
 *
 * There is no `unmaskTextSelector` in posthog-js 1.404.1 - checked the types and
 * the bundle. `maskTextFn` is the only hook, and it is a better one: the
 * exception cannot be widened by editing a class list, only by adding an
 * attribute to an element, in a diff, where it is visible.
 *
 * KNOWN GAP, and no test in this repo can close it: PostHog's REMOTE config can
 * override masking -
 *   masking?: Pick<SessionRecordingOptions, 'maskAllInputs' | 'maskTextSelector' | 'blockSelector'>
 * so a change in the PostHog project settings can switch the container mask off
 * with nothing here changing, and every assertion below would still pass.
 * `maskTextFn` is not in that Pick and survives - but it never fires if nothing
 * is being masked to begin with.
 */

/** Marks a subtree whose rendered text is user-private. Everything inside is
 *  masked in session replay. Applied to the component roots that render a
 *  user's own financial data - see the test for the enforced list. */
export const MASK_TEXT_SELECTOR = '.lhq-private';

/** The only exception, and deliberately an ATTRIBUTE rather than a class list.
 *  Ships with zero usages. Widening it means touching an element in a diff, not
 *  appending to a string that looks like configuration.
 *
 *  Anything carrying this is captured in the clear. Nothing user-specific may. */
export const UNMASK_TEXT_SELECTOR = '[data-ph-safe]';

/**
 * Called by rrweb for text it is about to mask. Returns the text unchanged only
 * for an explicitly opted-in subtree; everything else is masked.
 *
 * Fails closed by construction - a missing element, a detached node, or any
 * unrecognised case falls through to masking.
 *
 * The replacement matches rrweb's own default (`/[\S]/g` -> '*') so a masked
 * recording looks the same as it did before this change, preserving word shape
 * and whitespace for layout.
 */
export function maskText(text: string, element?: HTMLElement | null): string {
  // closest() searches the element itself and its ancestors, so opting in a
  // container opts in everything under it - same semantics as the mask side.
  if (element && typeof element.closest === 'function' && element.closest(UNMASK_TEXT_SELECTOR)) {
    return text;
  }
  return text.replace(/\S/g, '*');
}

/** The `session_recording` block passed to posthog.init(). Exported rather than
 *  built inline in PostHogProvider so it can be asserted without a browser. */
export const SESSION_RECORDING = {
  maskAllInputs:    true,
  maskTextSelector: MASK_TEXT_SELECTOR,
  maskTextFn:       maskText,
};
