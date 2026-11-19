'use client';
import { useEffect, useState } from 'react';
import { useLabels } from '@/lib/labels';

/* SAYS SO WHEN THE CONNECTION DROPS (#1185, QA staging run 44074316335): after the network went away for 8 s, /markets and /news kept their old figures and said nothing, which reads as live data.
 * Mounted app-wide (AppShell), top-centre, in the same place and style as the amber "updated from another device" toast, so it cannot meet the Ask AI button or the tab bar. It is passive status
 * (role="status"), never moves focus, and leaves by itself the moment the browser reports the connection back. */
export default function OfflineNotice() {
  const { t } = useLabels();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(typeof navigator !== 'undefined' && navigator.onLine === false);
    sync();
    window.addEventListener('offline', sync);
    window.addEventListener('online', sync);
    return () => {
      window.removeEventListener('offline', sync);
      window.removeEventListener('online', sync);
    };
  }, []);

  /* THE LIVE REGION EXISTS, EMPTY, BEFORE THE MESSAGE (WCAG 4.1.3; QA a11y rule U5): a role="status" node created together with its text is not announced, so the container is always mounted and the amber box is rendered inside it. */
  return (
    <div role="status" className="offline-notice-region" data-testid="offline-notice-region">
      {offline && (
        <div className="st-save-toast conflict" data-testid="offline-notice">
          <span className="st-save-toast-text">{t('OFFLINE_NOTICE')}</span>
        </div>
      )}
    </div>
  );
}
