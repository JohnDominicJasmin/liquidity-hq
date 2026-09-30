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
  // #1113 (owner option 4): the hint is now REPLAYABLE. Dismissing it no longer
  // removes it for good - it collapses to a small "?" affordance that reopens
  // it, so the "I skipped it and now I'm lost" case has a way back. A returning
  // visitor (localStorage marker set) starts collapsed, not gone.
  const [state, setState] = useState<'pending' | 'show' | 'collapsed'>('pending');
  const { t } = useLabels();

  useEffect(() => {
    try {
      setState(localStorage.getItem(key) ? 'collapsed' : 'show');
    } catch {
      setState('show');
    }
  }, [key]);

  function dismiss() {
    try { localStorage.setItem(key, '1'); } catch {}
    setState('collapsed');
  }
  function reopen() {
    // Reopen for this session; the seen-marker stays set so the next visit still
    // starts collapsed rather than re-showing the full banner unprompted.
    setState('show');
  }

  if (state === 'collapsed') {
    return (
      <button
        data-page-hint={pageKey}
        onClick={reopen}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'var(--accent-bg)', border: '0.5px solid var(--accent-bdr)',
          borderRadius: 8, padding: '4px 10px', marginBottom: 14, cursor: 'pointer',
          color: 'var(--accent)', fontSize: 'var(--fs-caption)', fontWeight: 700,
          minHeight: 24,
        }}
        aria-label={t('PAGE_HINT_REPLAY_LABEL')}
      >
        <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 800, color: 'var(--accent)', background: 'var(--accent-bg)', borderRadius: '50%', width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>?</span>
        {t('PAGE_HINT_REPLAY_LABEL')}
      </button>
    );
  }

  /* data-page-hint marks the hint's root in both states, so a layout check can
     find it and ask what its parent does with it (#1487: inside the dashboard's
     grid it took a column track and broke the page). */
  return (
    <div data-page-hint={pageKey} style={{
      /* Invisible but occupying its full height until the localStorage read
         resolves, so the hint arrives in space that was already reserved
         rather than inserting itself and pushing the page down. */
      visibility: state === 'pending' ? 'hidden' : 'visible',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      background: 'var(--accent-bg)',
      border: '0.5px solid var(--accent-bdr)',
      borderRadius: 10,
      padding: '10px 12px',
      marginBottom: 14,
    }}>
      <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 800, color: 'var(--accent)', background: 'var(--accent-bg)', borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, letterSpacing: 0 }}>i</span>
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
          /* WCAG 2.2 SC 2.5.8: 24x24 minimum. The glyph alone measured 14x16,
             and this button renders on every page carrying a hint - it was 5 of
             the app's remaining tap-target failures by itself. Centred rather
             than enlarged so the x looks identical; only the hit area grows. */
          minWidth: 24,
          minHeight: 24,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-label={t('PAGE_HINT_DISMISS_LABEL')}
      >×</button>
    </div>
  );
}
