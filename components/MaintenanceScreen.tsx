'use client';
import { useLabels } from '@/lib/labels';

export default function MaintenanceScreen() {
  const { t } = useLabels();
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', color: 'var(--txt)', fontFamily: 'Figtree, system-ui, sans-serif',
    }}>
      <div style={{ textAlign: 'center', padding: '2rem', maxWidth: 420 }}>
        <h2 style={{ fontSize: 'var(--fs-section)', marginBottom: '0.5rem' }}>{t('MAINTENANCE_TITLE')}</h2>
        <p style={{ color: 'var(--txt2)' }}>
          {t('MAINTENANCE_BODY')}
        </p>
      </div>
    </div>
  );
}
