'use client';
import { useGrokUsage } from '@/components/GrokUsageProvider';
import UsageRings from '@/components/UsageRings';
import { useLabels } from '@/lib/labels';
import { useDialogFocusTrap } from '@/lib/useDialogFocusTrap';

interface Props {
  open: boolean;
  onClose: () => void;
  /* QA #1245: the "View Usage" menu item that opens this modal unmounts in
   * the same click (closing its own dropdown), so useDialogFocusTrap's usual
   * document.activeElement capture finds nothing to return focus to on
   * close. The caller passes a control that survives - here, the avatar
   * button that owns the dropdown - as the trigger instead. */
  triggerEl?: HTMLElement | null;
}

export default function UsageModal({ open, onClose, triggerEl }: Props) {
  const { t } = useLabels();
  const { usage } = useGrokUsage();
  const dialogRef = useDialogFocusTrap<HTMLDivElement>(open, onClose, triggerEl);

  if (!open) return null;

  return (
    <>
      <div className="smod-backdrop" onClick={onClose} />
      {/* 460px fits all 6 rings on one row on desktop (6x56px + 5x12px gap +
          the body's own padding). At 400px the sixth ring - Tools - wrapped
          alone onto a second row and read as an afterthought rather than one
          of the budgets. Still collapses to the viewport on mobile, where
          wrapping is expected. */}
      <div ref={dialogRef} tabIndex={-1} className="smod-panel" data-testid="settings-modal" role="dialog" aria-modal="true" aria-label={t('USAGE_MODAL_TITLE')} style={{ maxHeight: 'none', width: 'min(460px, calc(100vw - 24px))' }}>
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
