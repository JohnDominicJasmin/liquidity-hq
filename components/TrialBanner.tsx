'use client';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useLabels } from '@/lib/labels';

// Slim in-flow countdown shown to users inside their 14-day Pro trial. Rendered
// in normal document flow at the top of the content area (NOT position:fixed) so
// it never has to coordinate with the --banner-h offset the announcement banner
// owns. Non-dismissible on purpose: the visible countdown is the whole point -
// it's the "you'll lose this" pressure that converts a trial to paid.
export default function TrialBanner() {
  const { isTrial, trialEndsAt } = useAuth();
  const { t } = useLabels();
  if (!isTrial || trialEndsAt == null) return null;

  const msLeft = trialEndsAt - Date.now();
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
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        flexWrap: 'wrap',
        padding: '7px 14px',
        background: bg,
        borderBottom: `0.5px solid ${bdr}`,
        fontSize: 'var(--fs-caption)',
        lineHeight: 1.4,
      }}
    >
      <span style={{ color: 'var(--txt2)' }}>
        <span
          style={{
            fontFamily: 'var(--font-mono, monospace)',
            fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: accent, marginRight: 8,
          }}
        >
          {t('TRIAL_BANNER_LABEL')}
        </span>
        {t('TRIAL_BANNER_FULL_ACCESS')} <strong style={{ color: 'var(--txt)' }}>{label}</strong>
      </span>
      <Link
        href="/upgrade"
        style={{
          fontWeight: 700, color: accent, textDecoration: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        {t('TRIAL_BANNER_CTA')} →
      </Link>
    </div>
  );
}
