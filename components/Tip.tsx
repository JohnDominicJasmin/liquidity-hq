'use client';
import { useState, useRef, useCallback, useEffect } from 'react';

interface TipProps {
  text: string;
  children: React.ReactNode;
  width?: number;
}

export default function Tip({ text, children, width = 230 }: TipProps) {
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
          fontSize: 9,
          color: 'rgba(255,255,255,0.2)',
          fontWeight: 400,
          lineHeight: 1,
          flexShrink: 0,
          userSelect: 'none',
          transition: 'color 0.15s',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLSpanElement).style.color = 'rgba(167,139,250,0.7)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLSpanElement).style.color = 'rgba(255,255,255,0.2)'; }}
        >ⓘ</span>
      </span>

      {open && (
        <span
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
          style={{
            position: 'fixed',
            ...(above ? { bottom: coords.bottom } : { top: coords.top }),
            left: coords.left,
            zIndex: 9990,
            width,
            background: '#13121c',
            border: '0.5px solid rgba(167,139,250,0.2)',
            borderRadius: 8,
            padding: '9px 11px',
            boxShadow: '0 8px 28px rgba(0,0,0,0.75)',
            fontSize: 11.5,
            lineHeight: 1.55,
            color: 'rgba(255,255,255,0.72)',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: 400,
            pointerEvents: 'all',
            display: 'block',
          }}
        >
          {text}
        </span>
      )}
    </>
  );
}
