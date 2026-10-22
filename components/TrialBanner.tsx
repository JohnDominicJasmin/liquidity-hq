'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useLabels } from '@/lib/labels';
import { useNow } from '@/lib/useNow';
import CloseIcon from '@/components/CloseIcon';

// Slim in-flow countdown shown to users inside their 14-day Pro trial. Rendered
// in normal document flow at the top of the content area (NOT position:fixed) so
// it never has to coordinate with the --banner-h offset the announcement banner
// owns.
//
// DISMISSIBLE (owner, #1598, 2026-10-20; it used to be non-dismissible on purpose, the
// visible countdown being the conversion pressure). A small x hides it UNTIL THE NEXT
// CALENDAR DAY: the dismissal is the device's local date in localStorage, and the next
// day the banner is back. In the LAST 3 DAYS it always shows and there is no x.
//
// The copy no longer says "Full access": after #1604 a trial gets signals and Quick/Deep
// on BTC, ETH and SOL only, so it was untrue (PM, 2026-10-20).
const DISMISS_KEY = 'lhq_trial_banner_dismissed';
/** The device's local calendar day, YYYY-MM-DD: "until the next day" means until this string changes. */
function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function TrialBanner() {
  const { isTrial, trialEndsAt } = useAuth();
  const { t } = useLabels();
  // Called before the early returns below - hooks cannot sit behind a branch.
  // The countdown only ever renders whole days, so a minute tick is more than
  // enough to keep it honest; the point is that it advances at all, which a
  // Date.now() read during render did not.
  const now = useNow(60_000);
  // Read in the FIRST client render (a lazy initial state), not in an effect after it: an effect made every non-dismissed trial user see the banner mount a
  // frame late and the page jump (QA, #1618). undefined only on the server, where the banner renders nothing anyway (isTrial needs the signed-in user, which
  // only the client has), so there is no hydration mismatch. A dismissed banner does not flash: it is hidden from its first render.
  const [dismissedDay, setDismissedDay] = useState<string | null | undefined>(() => {
    if (typeof window === 'undefined') return undefined;
    try { return window.localStorage.getItem(DISMISS_KEY); } catch { return null; /* storage blocked: treat as not dismissed */ }
  });
  // "PRO TRIAL ·" over "14 days left" left the separator dangling at the end of the first line (PM, #1673): once the countdown has wrapped
  // below the label, the dot is hidden. Measured rather than a breakpoint, since where it wraps depends on the language and the width.
  // visibility, not display: the dot keeps its width, so hiding it cannot let the line fit again and flip back.
  const labelRef = useRef<HTMLSpanElement>(null);
  const countRef = useRef<HTMLElement>(null);
  const [wrapped, setWrapped] = useState(false);
  /* The day count is derived here, ABOVE the effect and the early returns, because the effect's dependency list needs it and hooks cannot
     sit behind a branch. `msLeft` is 0 when there is no trial, which the early return below turns into no banner at all. */
  const msLeft = trialEndsAt != null ? trialEndsAt - now : 0;
  const daysLeft = Math.ceil(msLeft / 86_400_000);
  useLayoutEffect(() => {
    const a = labelRef.current, b = countRef.current;
    if (!a || !b) return;
    const check = () => setWrapped(b.offsetTop > a.offsetTop + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(a.parentElement ?? a);
    return () => ro.disconnect();
    // The observer is rebuilt when the countdown's text could change or the banner appears, not on every render - useNow re-renders this
    // component every minute (QA, #1678). dismissedDay is in the list because dismissing and restoring unmounts and remounts the row.
  }, [daysLeft, isTrial, dismissedDay]);
  if (!isTrial || trialEndsAt == null) return null;

  if (msLeft <= 0) return null;
  const label = daysLeft === 1
    ? t('TRIAL_BANNER_LAST_DAY')
    : t('TRIAL_BANNER_DAYS_LEFT', { days: daysLeft });
  const urgent = daysLeft <= 3;
  // Last 3 days: always shown, no x. Otherwise hidden for the rest of the local day it was dismissed, and not shown before the stored day is read.
  const today = localDay(now);
  if (!urgent && (dismissedDay === undefined || dismissedDay === today)) return null;
  const dismiss = () => {
    try { window.localStorage.setItem(DISMISS_KEY, today); } catch { /* storage blocked: hidden for this visit only */ }
    setDismissedDay(today);
  };

  const accent = urgent ? 'var(--amber)' : 'var(--accent)';
  const bg     = urgent ? 'var(--amber-bg, rgba(251,191,36,0.08))' : 'var(--accent-bg, rgba(26,122,255,0.07))';
  const bdr    = urgent ? 'var(--amber-bdr, rgba(251,191,36,0.22))' : 'var(--accent-bdr, rgba(26,122,255,0.22))';

  return (
    <div
      role="status"
      style={{
        // ONE ROW at every width (owner, 2026-10-22, #1673 item 2: "put it into horizontal layout"). It wrapped, so at 390 px the countdown
        // and the "Keep Pro" pill stacked on two centred lines. Now the text block shrinks and wraps inside itself (min-width 0) while the
        // pill keeps its size; on desktop, where both fit, they sit centred exactly as before.
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 14, flexWrap: 'nowrap',
        // Was 7px/--fs-caption with a 0.5px rule - a 12px strip that read as a
        // system notice and got skipped. This is the only standing reminder that
        // the trial ends, so it is sized to be read: body text, real padding,
        // and a 2px accent rule instead of a hairline.
        padding: '13px 18px',
        // Room for the x (44px wide, 6px from the edge) so it never overlaps the text on a phone.
        ...(urgent ? {} : { paddingInlineEnd: 56 }),
        position: 'relative',
        background: bg,
        borderBottom: `2px solid ${bdr}`,
        fontSize: 'var(--fs-body)',
        lineHeight: 1.45,
      }}
    >
      {/* Wraps between "PRO TRIAL ·" and the countdown, never inside either: each part is nowrap. */}
      <span style={{ color: 'var(--txt2)', flex: '0 1 auto', minWidth: 0 }}>
        <span ref={labelRef} style={{ whiteSpace: 'nowrap' }}>
          <span
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
              fontSize: 'var(--fs-label)',
              color: accent, marginRight: 10,
            }}
          >
            {t('TRIAL_BANNER_LABEL')}
          </span>
          <span aria-hidden="true" style={{ color: 'var(--txt3)', marginInlineEnd: 8, visibility: wrapped ? 'hidden' : undefined }}>·</span>
        </span>
        <wbr />
        <strong ref={countRef} style={{ color: 'var(--txt)', fontWeight: 700, whiteSpace: 'nowrap' }}>{label}</strong>
      </span>
      {/* A bordered pill, not a bare text link - the CTA previously differed
          from the surrounding sentence only by weight and colour, on a strip
          where everything was already accent-coloured. */}
      <Link
        href="/upgrade"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          // minHeight, not more padding: the pill sits inline with the sentence
          // beside it, so growing it vertically via padding alone would push the
          // banner taller on every viewport. 44px is the touch-target floor -
          // the first version of this pill was 29px, which is a miss on the one
          // control in the app whose entire job is being tapped.
          padding: '0 15px', minHeight: 44, borderRadius: 999, flex: 'none',
          border: `1px solid ${accent}`,
          fontSize: 'var(--fs-label)', fontWeight: 700,
          color: accent, textDecoration: 'none', whiteSpace: 'nowrap',
          lineHeight: 1,
        }}
      >
        {t('TRIAL_BANNER_CTA')} →
      </Link>
      {/* The x: lighter than "Keep Pro" (no border, muted colour), a 44x44 hit area around a small glyph, reachable by keyboard. Not offered in the last 3 days. */}
      {!urgent && (
        <button
          type="button"
          data-testid="trial-banner-dismiss"
          onClick={dismiss}
          aria-label={t('TRIAL_BANNER_DISMISS')}
          title={t('TRIAL_BANNER_DISMISS')}
          style={{ position: 'absolute', insetInlineEnd: 6, top: '50%', transform: 'translateY(-50%)', width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, border: 'none', background: 'transparent', color: 'var(--txt3)', borderRadius: 8, cursor: 'pointer' }}
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}
