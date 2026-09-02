'use client';
import { useLabels } from '@/lib/labels';
import { useDesignMode } from '@/components/DesignModeProvider';

const SECTIONS = [
  { titleKey: 'REFUND_SECTION_NO_REFUNDS_TITLE', bodyKey: 'REFUND_SECTION_NO_REFUNDS_BODY' },
  { titleKey: 'REFUND_SECTION_CANCELLATION_TITLE', bodyKey: 'REFUND_SECTION_CANCELLATION_BODY' },
  { titleKey: 'REFUND_SECTION_FREE_TRIAL_TITLE', bodyKey: 'REFUND_SECTION_FREE_TRIAL_BODY' },
  { titleKey: 'REFUND_SECTION_BILLING_ERRORS_TITLE', bodyKey: 'REFUND_SECTION_BILLING_ERRORS_BODY' },
  { titleKey: 'REFUND_SECTION_CHARGEBACKS_TITLE', bodyKey: 'REFUND_SECTION_CHARGEBACKS_BODY' },
  { titleKey: 'REFUND_SECTION_CONTACT_TITLE', bodyKey: 'REFUND_SECTION_CONTACT_BODY' },
] as const;

export default function RefundPolicy() {
  const mode = useDesignMode();
  const { t } = useLabels();

  return (
    <div className={mode === 'terminal' ? 'refund-term-wrap' : undefined} style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 24px 80px' }}>

      <div style={{ marginBottom: 48 }}>
        <div style={{
          fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 14,
        }}>
          {t('REFUND_EYEBROW')}
        </div>
        <h1 style={{ fontSize: '2.625rem', fontWeight: 800, color: 'var(--txt)', margin: 0, lineHeight: 1.1 }}>
          {t('REFUND_PAGE_TITLE')}
        </h1>
        <p style={{ fontSize: 'var(--fs-label)', color: 'var(--txt3)', marginTop: 16, lineHeight: 1.7 }}>
          {t('REFUND_LAST_UPDATED')}
        </p>
      </div>

      <div style={{
        fontSize: 'var(--fs-data)', fontWeight: 700, color: 'var(--txt)', lineHeight: 1.6,
        padding: '20px 24px', marginBottom: 48,
        background: 'var(--bg2)', borderRadius: 12,
      }}>
        {t('REFUND_CALLOUT_BODY')}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '40px 52px',
        marginBottom: 64,
      }}>
        {SECTIONS.map(s => (
          <div key={s.titleKey}>
            <div style={{ fontSize: 'var(--fs-card-title)', fontWeight: 700, color: 'var(--txt)', marginBottom: 10, lineHeight: 1.3 }}>
              {t(s.titleKey)}
            </div>
            <div style={{ fontSize: 'var(--fs-label)', color: 'var(--txt2)', lineHeight: 1.75 }}>
              {t(s.bodyKey)}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        borderTop: '1px solid var(--bdr)',
        paddingTop: 28,
        fontSize: 'var(--fs-caption)',
        color: 'var(--txt3)',
        lineHeight: 1.9,
      }}>
        <p>
          {t('REFUND_FOOTER_ACKNOWLEDGEMENT')}
        </p>
        <p style={{ marginTop: 12 }}>{t('REFUND_FOOTER_COPYRIGHT', { year: new Date().getFullYear() })}</p>
      </div>

    </div>
  );
}
