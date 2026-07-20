'use client';
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'lhq_dismissed_banner';

export default function AnnouncementBanner({ banner }: { banner: { text: string; link: string | null } | null }) {
  const [dismissed, setDismissed] = useState(true);

  // Keyed on the banner's own text, so a NEW banner always shows again even if
  // a previous one was dismissed - only re-showing the identical text stays hidden.
  useEffect(() => {
    if (!banner?.text) { setDismissed(true); return; }
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY) === banner.text);
    } catch {
      setDismissed(false);
    }
  }, [banner?.text]);

  if (!banner?.text || dismissed) return null;

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, banner!.text); } catch {}
    setDismissed(true);
  }

  const content = banner.link
    ? <a href={banner.link} style={{ color: 'inherit', textDecoration: 'underline' }}>{banner.text}</a>
    : banner.text;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
      padding: '8px 16px', background: 'var(--accent-bg)', borderBottom: '0.5px solid var(--accent-bdr)',
      color: 'var(--txt)', fontSize: 'var(--fs-label, 0.8rem)', textAlign: 'center',
    }}>
      <span>{content}</span>
      <button
        onClick={dismiss}
        aria-label="Dismiss announcement"
        style={{ background: 'none', border: 'none', color: 'var(--txt2)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: 0 }}
      >
        ×
      </button>
    </div>
  );
}
