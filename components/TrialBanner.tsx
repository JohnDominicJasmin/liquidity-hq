'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useLabels } from '@/lib/labels';
import { useNow } from '@/lib/useNow';

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
  if (!isTrial || trialEndsAt == null) return null;

  const msLeft = trialEndsAt - now;
  if (msLeft <= 0) return null;
  const daysLeft = Math.ceil(msLeft / 86_400_000);
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
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 14, flexWrap: 'wrap',
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
      <span style={{ color: 'var(--txt2)' }}>
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
        <span aria-hidden="true" style={{ color: 'var(--txt3)', marginInlineEnd: 8 }}>·</span>
        <strong style={{ color: 'var(--txt)', fontWeight: 700 }}>{label}</strong>
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
          padding: '0 15px', minHeight: 44, borderRadius: 999,
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
          style={{ position: 'absolute', insetInlineEnd: 6, top: '50%', transform: 'translateY(-50%)', width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, border: 'none', background: 'transparent', color: 'var(--txt3)', fontSize: 'var(--fs-body)', lineHeight: 1, borderRadius: 8, cursor: 'pointer' }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
