'use client';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useLabels } from '@/lib/labels';
import { useNow } from '@/lib/useNow';

// Slim in-flow countdown shown to users inside their 14-day Pro trial. Rendered
// in normal document flow at the top of the content area (NOT position:fixed) so
// it never has to coordinate with the --banner-h offset the announcement banner
// owns. Non-dismissible on purpose: the visible countdown is the whole point -
// it's the "you'll lose this" pressure that converts a trial to paid.
export default function TrialBanner() {
  const { isTrial, trialEndsAt } = useAuth();
  const { t } = useLabels();
  // Called before the early returns below - hooks cannot sit behind a branch.
  // The countdown only ever renders whole days, so a minute tick is more than
  // enough to keep it honest; the point is that it advances at all, which a
  // Date.now() read during render did not.
  const now = useNow(60_000);
  if (!isTrial || trialEndsAt == null) return null;

  const msLeft = trialEndsAt - now;
  if (msLeft <= 0) return null;
  const daysLeft = Math.ceil(msLeft / 86_400_000);
  const label = daysLeft === 1
    ? t('TRIAL_BANNER_LAST_DAY')
    : t('TRIAL_BANNER_DAYS_LEFT', { days: daysLeft });
  const urgent = daysLeft <= 3;

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
        {t('TRIAL_BANNER_FULL_ACCESS')}{' '}
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
    </div>
  );
}
