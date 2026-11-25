'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useLabels } from '@/lib/labels';
import { tabTitle, tabTitleKey } from '@/lib/tabTitle';

/* The browser tab in the reader's language (#1185). English keeps the server title. The head is watched because Next writes its own
   title after a navigation, and the server title is put back when the language or page changes. Renders nothing. */
export default function TabTitle() {
  const { t, locale } = useLabels();
  const pathname = usePathname();

  useEffect(() => {
    const key = tabTitleKey(pathname);
    if (locale === 'en' || !key) return;
    const wanted = tabTitle(t(key));
    let served = '';
    const apply = () => {
      if (document.title === wanted) return;
      served = document.title;
      document.title = wanted;
    };
    apply();
    const watch = new MutationObserver(apply);
    watch.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      watch.disconnect();
      if (served && document.title === wanted) document.title = served;
    };
  }, [pathname, locale, t]);

  return null;
}
