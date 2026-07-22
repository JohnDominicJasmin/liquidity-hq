// Shared skeleton primitives. Generic on purpose - these back the shared
// LoadingState component (used as the loading fallback across ~26 pages), so
// they can't assume any one page's layout. Responsive by default (relative
// widths, grid auto-fit), so mobile gets the same skeleton with no extra work.

export function SkeletonBar({
  width = '100%', height = 14, radius, style,
}: { width?: string | number; height?: number; radius?: number; style?: React.CSSProperties }) {
  return (
    <div
      className="skel-bar"
      aria-hidden="true"
      style={{ width, height, borderRadius: radius, flexShrink: 0, ...style }}
    />
  );
}

// Full-page loading fallback: title bar, a row of stat-card placeholders, then
// list-row placeholders. Not pixel-matched to any specific page - a plausible
// generic shape for "some page with a header, some stats, some rows", which is
// what nearly every page in this app looks like.
export function SkeletonPage({ label }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" style={{ padding: '20px 16px 40px', maxWidth: 860, margin: '0 auto' }}>
      {label && <span className="sr-only">{label}</span>}
      <SkeletonBar width="42%" height={22} radius={7} style={{ marginBottom: 22 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{ background: 'var(--bg2)', border: '0.5px solid var(--bdr)', borderRadius: 'var(--radius-card, 12px)', padding: 16 }}>
            <SkeletonBar width="55%" height={10} radius={4} style={{ marginBottom: 12 }} />
            <SkeletonBar width="70%" height={20} radius={5} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[0, 1, 2, 3, 4].map(i => (
          <SkeletonBar key={i} height={44} radius={10} style={{ opacity: 1 - i * 0.1 }} />
        ))}
      </div>
    </div>
  );
}

// Inline loading fallback for a single card slot (the !fullPage LoadingState
// mode - a card, chart panel, or widget still fetching inside an already-loaded
// page). Sized to sit naturally where a "card" className block would.
export function SkeletonCard({ label }: { label?: string }) {
  return (
    <div className="card" role="status" aria-live="polite" style={{ padding: '16px' }}>
      {label && <span className="sr-only">{label}</span>}
      <SkeletonBar width="45%" height={11} radius={4} style={{ marginBottom: 12 }} />
      <SkeletonBar width="85%" height={12} radius={4} style={{ marginBottom: 8 }} />
      <SkeletonBar width="65%" height={12} radius={4} />
    </div>
  );
}
