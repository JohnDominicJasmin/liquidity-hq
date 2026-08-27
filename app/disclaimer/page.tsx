'use client';
import Link from 'next/link';
import { useLabels } from '@/lib/labels';

const SECTIONS = [
  { titleKey: 'DISCLAIMER_SECTION_EDUCATIONAL_TITLE', bodyKey: 'DISCLAIMER_SECTION_EDUCATIONAL_BODY' },
  { titleKey: 'DISCLAIMER_SECTION_TRADING_RISKS_TITLE', bodyKey: 'DISCLAIMER_SECTION_TRADING_RISKS_BODY' },
  { titleKey: 'DISCLAIMER_SECTION_NO_GUARANTEES_TITLE', bodyKey: 'DISCLAIMER_SECTION_NO_GUARANTEES_BODY' },
  { titleKey: 'DISCLAIMER_SECTION_NOT_FINANCIAL_ADVICE_TITLE', bodyKey: 'DISCLAIMER_SECTION_NOT_FINANCIAL_ADVICE_BODY' },
  { titleKey: 'DISCLAIMER_SECTION_NO_TRADE_EXECUTION_TITLE', bodyKey: 'DISCLAIMER_SECTION_NO_TRADE_EXECUTION_BODY' },
  { titleKey: 'DISCLAIMER_SECTION_AI_ANALYSIS_TITLE', bodyKey: 'DISCLAIMER_SECTION_AI_ANALYSIS_BODY' },
  { titleKey: 'DISCLAIMER_SECTION_DATA_PROVIDERS_TITLE', bodyKey: 'DISCLAIMER_SECTION_DATA_PROVIDERS_BODY' },
  { titleKey: 'DISCLAIMER_SECTION_BACKTESTS_TITLE', bodyKey: 'DISCLAIMER_SECTION_BACKTESTS_BODY' },
  { titleKey: 'DISCLAIMER_SECTION_NO_LIABILITY_TITLE', bodyKey: 'DISCLAIMER_SECTION_NO_LIABILITY_BODY' },
  { titleKey: 'DISCLAIMER_SECTION_PLATFORM_IDENTITY_TITLE', bodyKey: 'DISCLAIMER_SECTION_PLATFORM_IDENTITY_BODY' },
] as const;

export default function Disclaimer() {
  const { t } = useLabels();

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 24px 80px' }}>

      {/* Header */}
      <div style={{ marginBottom: 48 }}>
        <div style={{
          fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 14,
        }}>
          {t('DISCLAIMER_EYEBROW')}
        </div>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--txt)', margin: 0, lineHeight: 1.1 }}>
          {t('DISCLAIMER_PAGE_TITLE')}
        </h1>
      </div>

      {/* 3-column grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '40px 52px',
        marginBottom: 64,
      }}>
        {SECTIONS.map(s => (
          <div key={s.titleKey}>
            <div style={{
              fontSize: 'var(--fs-card-title)', fontWeight: 700, color: 'var(--txt)',
              marginBottom: 10, lineHeight: 1.3,
            }}>
              {t(s.titleKey)}
            </div>
            <div style={{ fontSize: 'var(--fs-label)', color: 'var(--txt2)', lineHeight: 1.75 }}>
              {t(s.bodyKey)}
            </div>
          </div>
        ))}
      </div>

      {/* Footer line */}
      <div style={{
        borderTop: '1px solid var(--bdr)',
        paddingTop: 28,
        fontSize: 'var(--fs-caption)',
        color: 'var(--txt3)',
        lineHeight: 1.9,
      }}>
        <p>
          {t('DISCLAIMER_FOOTER_ACKNOWLEDGEMENT')}
        </p>
        <p style={{ marginTop: 20, display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>{t('DISCLAIMER_FOOTER_COPYRIGHT', { year: new Date().getFullYear() })}</span>
          <Link href="/about" style={{ color: 'var(--txt3)', textDecoration: 'underline' }}>{t('DISCLAIMER_FOOTER_ABOUT_LINK')}</Link>
        </p>
      </div>

    </div>
  );
}
