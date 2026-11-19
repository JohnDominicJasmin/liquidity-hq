'use client';
import { useEffect, useRef, useState } from 'react';
import { SECRETS, getDailySecret, Secret } from '@/lib/secrets';
import { useLabels } from '@/lib/labels';

export default function SOTD() {
  const { t } = useLabels();
  const [secret, setSecret] = useState<Secret>(getDailySecret);
  /* TWO LINES AND A "MORE" LINK (#1185, rule 25): the play's text is clamped to two lines; the link shows only when the text really is longer, measured after paint and on resize. */
  const [open, setOpen] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const measure = () => {
      if (open) return;
      setCanExpand(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [secret.n, open]);

  const newSecret = () => {
    const available = SECRETS.filter(s => s.n !== secret.n);
    setSecret(available[Math.floor(Math.random() * available.length)]);
    setOpen(false);
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
      <div ref={textRef} suppressHydrationWarning className={`sotd-text${open ? '' : ' sotd-text-clamped'}`} id="sotd-text">{secret.text}</div>
      {(canExpand || open) && (
        <button type="button" className="sotd-more" aria-expanded={open} aria-controls="sotd-text" onClick={() => setOpen(v => !v)}>
          {open ? t('CHAT_COLLAPSE') : t('ARENA_MORE_DETAILS')}
        </button>
      )}
      <div className="sotd-footer"><span data-testid="sotd-folklore-note" style={{ display: 'block' }}>{t('PLAYBOOK_FOLKLORE_NOTE')}</span>{t('SOTD_FOOTER')}</div>
    </div>
  );
}
