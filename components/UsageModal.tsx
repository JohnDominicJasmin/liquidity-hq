'use client';
import { useEffect, useCallback } from 'react';
import { useGrokUsage } from '@/components/GrokUsageProvider';
import UsageRings from '@/components/UsageRings';
import { useLabels } from '@/lib/labels';

interface Props { open: boolean; onClose: () => void; }

export default function UsageModal({ open, onClose }: Props) {
  const { t } = useLabels();
  const { usage } = useGrokUsage();

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, handleKey]);

  if (!open) return null;

  return (
    <>
      <div className="smod-backdrop" onClick={onClose} />
      <div className="smod-panel" role="dialog" aria-modal="true" aria-label={t('USAGE_MODAL_TITLE')} style={{ maxHeight: 'none', width: 'min(400px, calc(100vw - 24px))' }}>
        <div className="smod-header">
          <span className="smod-title">{t('USAGE_MODAL_TITLE')}</span>
          <button className="smod-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="smod-body">
          {usage
            ? <UsageRings usage={usage} />
            : <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}><span className="login-spinner-lg" /></div>}
        </div>
      </div>
    </>
  );
}
