export default function Offline() {
  return (
    <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>📡</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#e8e8e8', marginBottom: 8 }}>No connection</div>
      <div style={{ fontSize: 14, color: '#606060' }}>Reconnect to resume live data feeds.</div>
    </div>
  );
}
