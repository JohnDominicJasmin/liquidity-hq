'use client';
import { useState, useRef, useCallback, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';

interface TipProps {
  /** The accessible name, and the panel body unless `body` overrides it.
   *  Stays a plain string: it is what `aria-label` announces, and a ReactNode
   *  there would stringify to "[object Object]" for a screen reader. */
  text: string;
  /* Optional rich panel content (#850). When present it replaces `text` in the
     PANEL only — `aria-label` still announces `text`, so the accessible name is
     unaffected and no existing call site changes behaviour.

     Added for the chart's setup-quality tooltip, which had three tiers of
     emphasis - a title, a dim sub-line and a brighter explanation - in
     hand-rolled markup that was keyboard-dead. Collapsing it to one string to
     fit this component would have traded a visual regression for the
     accessibility fix; this takes both. */
  body?: React.ReactNode;
  /* Optional. Tip usually wraps the label it explains, but where that label
     lives inside a <button> the Tip has to sit outside it - its trigger is a
     real focusable control, and a control inside a control is an
     axe nested-interactive violation. Rendering <Tip text={...} /> with no
     children gives a standalone ⓘ for exactly that case. See the anti-chop
     toggle in app/arena. */
  children?: React.ReactNode;
  width?: number;
  iconColor?: string;
}

export default function Tip({ text, body, children, width = 230, iconColor = 'var(--txt3)' }: TipProps) {
  const [open, setOpen]   = useState(false);
  const [above, setAbove] = useState(false);
  const [coords, setCoords] = useState({ top: 0, bottom: 0, left: 0 });
  const ref   = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tipId = useId();

  const show = useCallback(() => {
    if (!ref.current) return;
    const r    = ref.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const isAbove = r.bottom + 120 > window.innerHeight;
    setAbove(isAbove);
    setCoords({ top: r.bottom + 6, bottom: window.innerHeight - r.top + 6, left });
    setOpen(true);
  }, [width]);

  const scheduleHide = useCallback(() => {
    timer.current = setTimeout(() => setOpen(false), 120);
  }, []);

  const cancelHide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={() => { cancelHide(); show(); }}
        onMouseLeave={scheduleHide}
        onClick={e => { e.stopPropagation(); open ? setOpen(false) : show(); }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'default' }}
      >
        {children}
        {/* The icon carries the interactive semantics, not the wrapper.
         *
         * This was a bare <span> with only mouse handlers: not focusable, not
         * announced as anything, no way to open or dismiss it from a keyboard.
         * QA measured 0 of 8 focusable across the page, and this one component
         * has 55 call sites, so every one of them was a keyboard dead end.
         *
         * role="button" on a span rather than a real <button> on purpose - Tip
         * wraps arbitrary children and is used inside headings, labels and
         * clickable cards, so a nested <button> would be invalid HTML in an
         * unknown number of those places. Same reasoning as the notification
         * bell in app/arena, which documents it too.
         *
         * aria-describedby points at the portalled panel: screen readers then
         * announce the tooltip text on focus without it needing to be in the
         * tab order itself. */}
        <span
          role="button"
          tabIndex={0}
          aria-label={text}
          aria-expanded={open}
          aria-describedby={open ? tipId : undefined}
          onFocus={() => { cancelHide(); show(); }}
          onBlur={scheduleHide}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault(); e.stopPropagation();
              open ? setOpen(false) : show();
            } else if (e.key === 'Escape' && open) {
              /* Escape has to work or a keyboard user who opens one has no way
                 to close it without moving focus away. */
              e.stopPropagation();
              setOpen(false);
            }
          }}
          style={{
            fontSize: 'var(--fs-caption)',
            color: iconColor,
            fontWeight: 400,
            lineHeight: 1,
            flexShrink: 0,
            userSelect: 'none',
            transition: 'color 0.15s',
            cursor: 'pointer',
            /* 24px minimum so the icon is a real target for touch as well as
               keyboard. Centred, so the glyph itself looks unchanged. */
            minWidth: 24,
            minHeight: 24,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLSpanElement).style.color = 'var(--accent)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLSpanElement).style.color = iconColor; }}
        >ⓘ</span>
      </span>

      {open && typeof document !== 'undefined' && createPortal(
        // Portalled to document.body - NOT rendered inline. `position: fixed`
        // is only viewport-relative if every ancestor is untransformed; any
        // ancestor with a transform/filter/perspective (e.g. MagicBento's
        // .mb-glow-card, which sets `transform` for its hover tilt) creates a
        // new containing block and silently repositions a nested fixed
        // element relative to THAT box instead - the tooltip would render far
        // off-screen. Portalling out to body-level sidesteps the whole class
        // of bug regardless of what card this Tip ends up inside.
        <span
          id={tipId}
          role="tooltip"
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
          style={{
            position: 'fixed',
            ...(above ? { bottom: coords.bottom } : { top: coords.top }),
            left: coords.left,
            zIndex: 9990,
            width,
            background: '#12152b',
            border: '0.5px solid rgba(122,134,255,0.25)',
            borderRadius: 10,
            padding: '9px 11px',
            boxShadow: '0 8px 28px rgba(0,0,0,0.75)',
            fontSize: 'var(--fs-caption)',
            lineHeight: 1.55,
            color: 'rgba(255,255,255,0.72)',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: 400,
            pointerEvents: 'all',
            display: 'block',
            textTransform: 'none',
            whiteSpace: 'normal',
            letterSpacing: 'normal',
          }}
        >
          {body ?? text}
        </span>,
        document.body,
      )}
    </>
  );
}
