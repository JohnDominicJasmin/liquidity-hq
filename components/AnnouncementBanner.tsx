'use client';
import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'lhq_dismissed_banner';

export default function AnnouncementBanner({ banner }: { banner: { text: string; link: string | null } | null }) {
  const [dismissed, setDismissed] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

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

  const visible = !!banner?.text && !dismissed;

  // Every other fixed/sticky top-of-viewport element (app-bar, news-ticker,
  // nav-drawer, breaking-alert, lp-nav) reads --banner-h to offset itself, so
  // this can never render underneath them (see the .announcement-banner rule
  // in globals.css). Measured, not a fixed pixel guess - the banner can wrap
  // to 2 lines on narrow screens.
  useEffect(() => {
    if (!visible) {
      document.documentElement.style.setProperty('--banner-h', '0px');
      return;
    }
    const el = ref.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--banner-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.setProperty('--banner-h', '0px');
    };
  }, [visible]);

  if (!visible) return null;

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, banner!.text); } catch {}
    setDismissed(true);
  }

  return (
    <div ref={ref} className="announcement-banner">
      <span className="announcement-banner-text">
        {banner!.link ? <a href={banner!.link}>{banner!.text}</a> : banner!.text}
      </span>
      <button className="announcement-banner-dismiss" onClick={dismiss} aria-label="Dismiss announcement">
        ×
      </button>
    </div>
  );
}
