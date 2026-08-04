'use client';
import { useState, useEffect } from 'react';
import { useLabels } from '@/lib/labels';

interface Props {
  pageKey: string;
  title: string;
  body: string;
}

export default function PageHint({ pageKey, title, body }: Props) {
  const key = `lhq_hint_${pageKey}`;
  /* Three states, not two: 'pending' matters.
   *
   * This used to start at "hidden", then flip to "shown" after reading
   * localStorage on mount. For a first-time visitor that inserted ~62px at the
   * very top of the page a beat after paint, pushing every card below it down
   * - about 7% of /scanner's layout shift, and it applied to every page this
   * component is on.
   *
   * Rendering an invisible spacer during 'pending' means the space is already
   * reserved when the answer arrives: the hint fades in where the gap was, or
   * the gap collapses for a returning visitor who dismissed it. The collapse
   * is a shift too, but it happens for people who have seen the hint before
   * and are scrolling past it, and it is one frame rather than a reflow of
   * everything below. */
  const [state, setState] = useState<'pending' | 'show' | 'hide'>('pending');
  const { t } = useLabels();

  useEffect(() => {
    try {
      setState(localStorage.getItem(key) ? 'hide' : 'show');
    } catch {
      setState('show');
    }
  }, [key]);

  if (state === 'hide') return null;

  function dismiss() {
    try { localStorage.setItem(key, '1'); } catch {}
    setState('hide');
  }

  return (
    <div style={{
      /* Invisible but occupying its full height until the localStorage read
         resolves, so the hint arrives in space that was already reserved
         rather than inserting itself and pushing the page down. */
      visibility: state === 'pending' ? 'hidden' : 'visible',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      background: 'rgba(26,122,255,0.07)',
      border: '0.5px solid rgba(26,122,255,0.22)',
      borderRadius: 10,
      padding: '10px 12px',
      marginBottom: 14,
    }}>
      <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 800, color: 'var(--accent)', background: 'rgba(26,122,255,0.18)', borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, letterSpacing: 0 }}>i</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--accent)', marginBottom: 3 }}>{title}</div>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', lineHeight: 1.55 }}>{body}</div>
      </div>
      <button
        onClick={dismiss}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--txt3)',
          fontSize: '1rem',
          lineHeight: 1,
          padding: '0 2px',
          flexShrink: 0,
          opacity: 0.6,
        }}
        aria-label={t('PAGE_HINT_DISMISS_LABEL')}
      >×</button>
    </div>
  );
}
