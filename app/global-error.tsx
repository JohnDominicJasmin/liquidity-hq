'use client';

import { useEffect, useState } from 'react';

/* This screen renders when the root layout has already failed, so there is no label provider: three lines, in the visitor's stored language (#1185). English when nothing is stored. */
const COPY: Record<string, { title: string; body: string; again: string; dir?: 'rtl' }> = {
  en: { title: 'Something went wrong', body: 'Try reloading the page. If this keeps happening, please try again in a few minutes.', again: 'Try again' },
  ko: { title: '문제가 발생했습니다', body: '페이지를 새로고침해 보세요. 계속 문제가 생기면 몇 분 후 다시 시도해 주세요.', again: '다시 시도' },
  zh: { title: '出了点问题', body: '请尝试重新加载页面。如果问题持续出现，请几分钟后再试。', again: '重试' },
  ru: { title: 'Что-то пошло не так', body: 'Попробуйте перезагрузить страницу. Если ошибка повторяется, повторите попытку через несколько минут.', again: 'Попробовать снова' },
  ar: { title: 'حدث خطأ ما', body: 'جرّب إعادة تحميل الصفحة. إذا استمر ذلك، فحاول مرة أخرى بعد بضع دقائق.', again: 'حاول مرة أخرى', dir: 'rtl' },
};

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [lang, setLang] = useState('en');
  useEffect(() => {
    try { const l = localStorage.getItem('lhq_lang_v1'); if (l && COPY[l]) setLang(l); } catch { /* storage blocked: English */ }
  }, []);
  const c = COPY[lang];

  useEffect(() => {
    /* Imported only when an error actually reaches this screen: a static import put the whole SDK in every page's first-load JavaScript (#2505, QA early-load fail). */
    import('@sentry/nextjs').then(S => S.captureException(error)).catch(() => { /* monitoring unavailable */ });
  }, [error]);

  return (
    <html lang={lang} dir={c.dir}>
      <body style={{ margin: 0, background: '#0d0d0d', color: '#e5e7eb', fontFamily: 'Figtree, system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <h2 style={{ fontSize: 'var(--fs-section)', marginBottom: '0.5rem' }}>{c.title}</h2>
          <p style={{ color: '#9ca3af', marginBottom: '1.5rem' }}>{c.body}</p>
          {/* #fff STAYS HERE, and it is the one exemption from #775.
              This screen renders when the root layout has already failed, so
              no stylesheet is guaranteed. If the tokens are missing,
              `var(--accent-solid)` resolves to nothing and the button falls
              back to transparent - on this file's own #0d0d0d body, where
              white text is the readable answer and var(--on-accent) would
              resolve to nothing at all, leaving the inherited colour.
              Everywhere else the token is strictly better; here the fallback
              behaviour is the whole point, which is also why eslint.config.mjs
              already allow-lists this file. Exempted by name in
              __tests__/onAccent.test.mts rather than silently skipped. */}
          <button
            onClick={reset}
            style={{ padding: '0.5rem 1.5rem', background: 'var(--accent-solid)', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontSize: 'var(--fs-card-title)' }}
          >
            {c.again}
          </button>
        </div>
      </body>
    </html>
  );
}
