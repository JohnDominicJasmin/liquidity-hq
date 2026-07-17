export default function Offline() {
  return (
    <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
      <div style={{ fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--txt)', marginBottom: 8 }}>No connection</div>
      <div style={{ fontSize: 'var(--fs-body)', color: 'var(--txt3)' }}>Reconnect to resume live data feeds.</div>
    </div>
  );
}
