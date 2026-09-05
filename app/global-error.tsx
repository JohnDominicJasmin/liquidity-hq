'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0d0d0d', color: '#e5e7eb', fontFamily: 'Figtree, system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <h2 style={{ fontSize: 'var(--fs-section)', marginBottom: '0.5rem' }}>Something went wrong</h2>
          <p style={{ color: '#9ca3af', marginBottom: '1.5rem' }}>An unexpected error occurred.</p>
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
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
