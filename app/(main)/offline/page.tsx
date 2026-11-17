export default function Offline() {
  return (
    <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
      <h1 style={{ fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--txt)', marginBottom: 8, marginTop: 0 }}>You&apos;re offline</h1>
      <div style={{ fontSize: 'var(--fs-body)', color: 'var(--txt3)' }}>Reconnect to resume live data feeds.</div>
    </div>
  );
}
