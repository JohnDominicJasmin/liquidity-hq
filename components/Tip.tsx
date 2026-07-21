'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface TipProps {
  text: string;
  children: React.ReactNode;
  width?: number;
  iconColor?: string;
}

export default function Tip({ text, children, width = 230, iconColor = 'var(--txt3)' }: TipProps) {
  const [open, setOpen]   = useState(false);
  const [above, setAbove] = useState(false);
  const [coords, setCoords] = useState({ top: 0, bottom: 0, left: 0 });
  const ref   = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
        <span style={{
          fontSize: 'var(--fs-caption)',
          color: iconColor,
          fontWeight: 400,
          lineHeight: 1,
          flexShrink: 0,
          userSelect: 'none',
          transition: 'color 0.15s',
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
          {text}
        </span>,
        document.body,
      )}
    </>
  );
}
