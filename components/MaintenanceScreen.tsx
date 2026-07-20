export default function MaintenanceScreen() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', color: 'var(--txt)', fontFamily: 'Figtree, system-ui, sans-serif',
    }}>
      <div style={{ textAlign: 'center', padding: '2rem', maxWidth: 420 }}>
        <h2 style={{ fontSize: 'var(--fs-section)', marginBottom: '0.5rem' }}>Down for maintenance</h2>
        <p style={{ color: 'var(--txt2)' }}>
          LiquidityHQ is temporarily unavailable while we make some changes. Back shortly.
        </p>
      </div>
    </div>
  );
}
