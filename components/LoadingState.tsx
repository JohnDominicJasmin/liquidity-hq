/** Shared loading placeholder (SYS-6 / item #16) - pages used to each
    hand-roll their own: /funding and /correlation had near-identical card
    styling but /upgrade used a completely different full-page div with a
    hardcoded grey (#888, ignores theme) instead of a token. One component,
    one visual language, still themed correctly in both modes. */
export default function LoadingState({ message, fullPage }: { message: string; fullPage?: boolean }) {
  if (fullPage) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '60vh', color: 'var(--txt3)', fontSize: 'var(--fs-label)',
      }}>
        {message}
      </div>
    );
  }
  return (
    <div className="card" style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--txt3)', fontSize: 'var(--fs-label)' }}>
      {message}
    </div>
  );
}
