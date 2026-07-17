'use client';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0d0d0d', color: '#e5e7eb', fontFamily: 'Figtree, system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <h2 style={{ fontSize: 'var(--fs-section)', marginBottom: '0.5rem' }}>Something went wrong</h2>
          <p style={{ color: '#9ca3af', marginBottom: '1.5rem' }}>An unexpected error occurred.</p>
          <button
            onClick={reset}
            style={{ padding: '0.5rem 1.5rem', background: '#1a7aff', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontSize: 'var(--fs-card-title)' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
