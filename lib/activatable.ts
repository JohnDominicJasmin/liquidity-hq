import type { KeyboardEvent } from 'react';

/* Keyboard activation for a control that cannot be a <button>.
 *
 * PREFER A REAL <button>. It is the pattern this codebase already uses -
 * MultiTFSqueezeView, PlatformFooter, arena/page.tsx:1414 - and it brings
 * focus, activation, the role and the Enter/Space handling for free. Reach for
 * this helper only when the element's children are block content or its
 * styling is bound to the element type, where a <button> would mean invalid
 * markup or a CSS rewrite.
 *
 * WHY IT EXISTS AT ALL (#939). A `<div onClick>` with no role, tabIndex or
 * keydown is not a badly announced control - it is an UNREACHABLE one. A
 * keyboard-only user cannot activate it, screen reader or not. A sweep of
 * components/ and app/ found 21 clickable div/span elements with neither role
 * nor tabIndex; most are modal backdrops or stopPropagation wrappers, which
 * are not controls, but several were the only way to perform their action.
 *
 * Space is preventDefault'd because it scrolls the page otherwise, which is
 * the bug people hit right after adding the keydown handler and then blame on
 * the handler not firing. */
export function activatable(onActivate: () => void, expanded?: boolean) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    ...(expanded === undefined ? {} : { 'aria-expanded': expanded }),
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
  };
}
