import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function NotFound() {
  return (
    <div style={{
      minHeight: '60vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 14, padding: '2rem',
      textAlign: 'center',
    }}>
      
      <div style={{
        fontSize: 28, fontWeight: 800, color: 'var(--txt1, #e8e8e8)',
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        404 - Liquidity not found
      </div>
      <div style={{ fontSize: 13, color: 'var(--txt3, #808080)', maxWidth: 420, lineHeight: 1.6 }}>
        This page got stop-hunted. The level you&rsquo;re looking for doesn&rsquo;t exist -
        or it was swept and never came back.
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link href="/" style={{
          padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700,
          color: 'var(--accent)', background: 'var(--accent-bg)',
          border: '0.5px solid var(--accent-bdr)', textDecoration: 'none',
        }}>
          ← Dashboard
        </Link>
        <Link href="/liq" style={{
          padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700,
          color: '#34d399', background: 'rgba(52,211,153,0.08)',
          border: '0.5px solid rgba(52,211,153,0.3)', textDecoration: 'none',
        }}>
          Liquidation Map
        </Link>
      </div>
    </div>
  );
}
