'use client';
import { useLabels } from '@/lib/labels';

const SECTIONS = [
  { titleKey: 'PRIVACY_SECTION_INFO_COLLECTED_TITLE', bodyKey: 'PRIVACY_SECTION_INFO_COLLECTED_BODY' },
  { titleKey: 'PRIVACY_SECTION_HOW_WE_USE_TITLE', bodyKey: 'PRIVACY_SECTION_HOW_WE_USE_BODY' },
  { titleKey: 'PRIVACY_SECTION_DATA_STORAGE_TITLE', bodyKey: 'PRIVACY_SECTION_DATA_STORAGE_BODY' },
  { titleKey: 'PRIVACY_SECTION_THIRD_PARTY_TITLE', bodyKey: 'PRIVACY_SECTION_THIRD_PARTY_BODY' },
  { titleKey: 'PRIVACY_SECTION_COOKIES_TITLE', bodyKey: 'PRIVACY_SECTION_COOKIES_BODY' },
  { titleKey: 'PRIVACY_SECTION_DATA_RETENTION_TITLE', bodyKey: 'PRIVACY_SECTION_DATA_RETENTION_BODY' },
  { titleKey: 'PRIVACY_SECTION_SHARING_TITLE', bodyKey: 'PRIVACY_SECTION_SHARING_BODY' },
  { titleKey: 'PRIVACY_SECTION_YOUR_RIGHTS_TITLE', bodyKey: 'PRIVACY_SECTION_YOUR_RIGHTS_BODY' },
  { titleKey: 'PRIVACY_SECTION_CHILDRENS_PRIVACY_TITLE', bodyKey: 'PRIVACY_SECTION_CHILDRENS_PRIVACY_BODY' },
  { titleKey: 'PRIVACY_SECTION_INTERNATIONAL_USERS_TITLE', bodyKey: 'PRIVACY_SECTION_INTERNATIONAL_USERS_BODY' },
  { titleKey: 'PRIVACY_SECTION_CHANGES_TITLE', bodyKey: 'PRIVACY_SECTION_CHANGES_BODY' },
  { titleKey: 'PRIVACY_SECTION_CONTACT_TITLE', bodyKey: 'PRIVACY_SECTION_CONTACT_BODY' },
] as const;

export default function PrivacyPolicy() {
  const { t } = useLabels();

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 24px 80px' }}>

      <div style={{ marginBottom: 48 }}>
        <div style={{
          fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 14,
        }}>
          {t('PRIVACY_EYEBROW')}
        </div>
        <h1 style={{ fontSize: '2.625rem', fontWeight: 800, color: 'var(--txt)', margin: 0, lineHeight: 1.1 }}>
          {t('PRIVACY_PAGE_TITLE')}
        </h1>
        <p style={{ fontSize: 'var(--fs-label)', color: 'var(--txt3)', marginTop: 16, lineHeight: 1.7 }}>
          {t('PRIVACY_LAST_UPDATED')}
        </p>
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
          {t('PRIVACY_FOOTER_ACKNOWLEDGEMENT')}
        </p>
        <p style={{ marginTop: 12 }}>{t('PRIVACY_FOOTER_COPYRIGHT', { year: new Date().getFullYear() })}</p>
      </div>

    </div>
  );
}
