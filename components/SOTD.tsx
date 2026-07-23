'use client';
import { useState } from 'react';
import { SECRETS, getDailySecret, Secret } from '@/lib/secrets';
import { useLabels } from '@/lib/labels';

export default function SOTD() {
  const { t } = useLabels();
  const [secret, setSecret] = useState<Secret>(getDailySecret);

  const newSecret = () => {
    const available = SECRETS.filter(s => s.n !== secret.n);
    setSecret(available[Math.floor(Math.random() * available.length)]);
  };

  return (
    <div className="sotd-wrap">
      <div className="sotd-label">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span className="sotd-static-badge" title={t('SOTD_STATIC_BADGE_TOOLTIP')}>
            📖 {t('SOTD_BADGE_LABEL')}
          </span>
          <span suppressHydrationWarning className="sotd-num-inline">{t('SOTD_NUM_LABEL', { n: String(secret.n), total: String(SECRETS.length) })}</span>
        </span>
        <button className="sotd-refresh" onClick={newSecret}>{t('SOTD_NEW_PLAY_BUTTON')}</button>
      </div>
      <div suppressHydrationWarning className="sotd-name">{secret.name}</div>
      <div suppressHydrationWarning className="sotd-text">{secret.text}</div>
      <div className="sotd-footer">{t('SOTD_FOOTER')}</div>
    </div>
  );
}
