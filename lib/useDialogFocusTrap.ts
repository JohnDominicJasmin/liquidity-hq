'use client';
import { useEffect, useRef } from 'react';

/* #1243 (QA's TEST_GAPS §6 audit): all four role="dialog" components in this
 * app asserted aria-modal="true" with none of the behaviour that claim
 * requires - focus never moved into the dialog on open, Tab could leave it
 * while open, and closing never returned focus to whatever triggered it.
 * One shared hook rather than four copies of the same three behaviours,
 * used by UpgradeGateModal, UsageModal, SpotlightTour and OnboardingFlow.
 *
 * Returns a ref to attach to the dialog's own root element.
 */
export function useDialogFocusTrap<T extends HTMLElement>(
  open: boolean,
  onClose?: () => void,
  /* QA #1245: document.activeElement is captured in the effect below, which
   * runs AFTER the click that opened the dialog has already committed. For
   * UpgradeGateModal that's fine - the button that opened it is still
   * mounted. UsageModal's opener is a dropdown menu item that the SAME click
   * unmounts (closing the dropdown), so by the time this effect runs the
   * browser has already moved activeElement to <body> - there is nothing
   * left to capture. A caller whose real trigger won't survive its own
   * click passes it explicitly here instead of relying on the DOM snapshot. */
  explicitTrigger?: HTMLElement | null,
): React.RefObject<T | null> {
  const containerRef = useRef<T | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  // Latest-ref pattern: several callers (SpotlightTour among them) pass a
  // plain function that is a new identity every render, not a useCallback.
  // Depending on `onClose` itself in the effect below would re-run the whole
  // setup - including re-capturing document.activeElement and re-stealing
  // focus to the first focusable child - on every parent re-render, not only
  // on open/close. Reading it through a ref keeps the effect keyed on `open`
  // alone while Escape still always calls whatever onClose is current.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  // Same latest-ref reasoning as onCloseRef - read fresh inside the
  // open-keyed effect below without adding it to that effect's deps.
  const explicitTriggerRef = useRef(explicitTrigger);
  useEffect(() => { explicitTriggerRef.current = explicitTrigger; }, [explicitTrigger]);

  useEffect(() => {
    if (!open) return;
    // The element focus returns to on close - captured fresh each time the
    // dialog opens, since a different control can open the same dialog from
    // different pages/states. Prefer the caller's explicit trigger (a
    // control guaranteed to survive its own click) over document.activeElement
    // (which, for a trigger that unmounts as part of opening this dialog, has
    // already moved to <body> by the time this effect runs).
    triggerRef.current = explicitTriggerRef.current ?? (document.activeElement as HTMLElement | null);

    const container = containerRef.current;
    if (!container) return;

    const focusables = (): HTMLElement[] => Array.from(
      container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(el => el.offsetParent !== null); // visible only - a hidden step in a wizard must not steal focus

    // Move focus in. Falls back to the container itself (tabIndex={-1} on
    // the dialog root makes that a valid focus target) for the rare dialog
    // with no focusable child yet - a loading state, say.
    (focusables()[0] ?? container).focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && onCloseRef.current) {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      // Wrap rather than let Tab escape the dialog into the page behind it.
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Restore focus to whatever opened the dialog. Guarded: the trigger
      // can have been removed from the DOM while the dialog was open (a
      // wizard step advancing, a list re-rendering).
      if (triggerRef.current?.isConnected) triggerRef.current.focus();
    };
  }, [open]);

  return containerRef;
}
