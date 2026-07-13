export default function Offline() {
  return (
    <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--txt)', marginBottom: 8 }}>No connection</div>
      <div style={{ fontSize: 14, color: 'var(--txt3)' }}>Reconnect to resume live data feeds.</div>
    </div>
  );
}
