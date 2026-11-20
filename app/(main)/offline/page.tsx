'use client';
import { useLabels } from '@/lib/labels';

export default function Offline() {
  const { t } = useLabels();
  return (
    <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
      <h1 style={{ fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--txt)', marginBottom: 8, marginTop: 0 }}>{t('OFFLINE_PAGE_TITLE')}</h1>
      <div style={{ fontSize: 'var(--fs-body)', color: 'var(--txt3)' }}>{t('OFFLINE_PAGE_BODY')}</div>
    </div>
  );
}
