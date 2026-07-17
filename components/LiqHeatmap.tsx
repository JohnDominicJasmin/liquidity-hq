'use client';
import type { LiqLevel } from '@/lib/marketStore';

function fmtK(price: number): string {
  if (price >= 1000) return '$' + (price / 1000).toFixed(1) + 'K';
  return '$' + price.toFixed(0);
}
function fmtAmt(amt: number): string {
  if (amt >= 1e9) return '$' + (amt / 1e9).toFixed(2) + 'B';
  if (amt >= 1e6) return '$' + (amt / 1e6).toFixed(0) + 'M';
  return '$' + amt.toFixed(0);
}

interface Props {
  levels: LiqLevel[];
  currentPrice: number;
}

export default function LiqHeatmap({ levels, currentPrice }: Props) {
  if (!levels.length || !currentPrice) return null;

  // Split relative to current price
  const above = [...levels]
    .filter(l => l.price > currentPrice)
    .sort((a, b) => a.price - b.price); // ascending (nearest first)
  const below = [...levels]
    .filter(l => l.price <= currentPrice)
    .sort((a, b) => b.price - a.price); // descending (nearest first)

  const maxAmt = Math.max(...levels.map(l => l.amount), 1);

  // Plain English insight
  const bigShort = above.reduce<LiqLevel | null>((m, l) => !m || l.amount > m.amount ? l : m, null);
  const bigLong  = below.reduce<LiqLevel | null>((m, l) => !m || l.amount > m.amount ? l : m, null);

  let insight = '';
  if (bigShort && bigLong) {
    const shortPct = ((bigShort.price - currentPrice) / currentPrice * 100).toFixed(1);
    const longPct  = ((currentPrice - bigLong.price)  / currentPrice * 100).toFixed(1);
    const shortBig = bigShort.amount > bigLong.amount;
    if (shortBig) {
      insight = `Biggest pool: ${fmtAmt(bigShort.amount)} in shorts at ${fmtK(bigShort.price)} (+${shortPct}% above) — whales likely push price up to sweep them.`;
    } else {
      insight = `Biggest pool: ${fmtAmt(bigLong.amount)} in longs at ${fmtK(bigLong.price)} (-${longPct}% below) — whales likely push price down to sweep them.`;
    }
  } else if (bigShort) {
    const pct = ((bigShort.price - currentPrice) / currentPrice * 100).toFixed(1);
    insight = `${fmtAmt(bigShort.amount)} in short liquidations at ${fmtK(bigShort.price)} (+${pct}% above) — bulls may spike toward it.`;
  } else if (bigLong) {
    const pct = ((currentPrice - bigLong.price) / currentPrice * 100).toFixed(1);
    insight = `${fmtAmt(bigLong.amount)} in long liquidations at ${fmtK(bigLong.price)} (-${pct}% below) — bears may push toward it.`;
  }

  const Row = ({ l, side }: { l: LiqLevel; side: 'above' | 'below' }) => {
    const pct  = side === 'above'
      ? ((l.price - currentPrice) / currentPrice * 100)
      : ((currentPrice - l.price)  / currentPrice * 100);
    const barW = Math.round((l.amount / maxAmt) * 100);
    // above = short liq = green (bulls squeeze up); below = long liq = red (bears dump)
    const color = side === 'above' ? '#34d399' : '#f87171';
    const bg    = side === 'above' ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)';

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: 'var(--txt3)', minWidth: 44, textAlign: 'right', flexShrink: 0 }}>
          {fmtK(l.price)}
        </span>
        <div style={{ flex: 1, height: 8, borderRadius: 3, background: 'var(--bg2)', overflow: 'hidden' }}>
          <div style={{ width: `${barW}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.3s' }} />
        </div>
        <span style={{ fontSize: 11, color, fontWeight: 700, minWidth: 36, flexShrink: 0 }}>
          {fmtAmt(l.amount)}
        </span>
        <span style={{
          fontSize: 11, color, background: bg, padding: '1px 5px', borderRadius: 10, flexShrink: 0,
        }}>
          {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
        </span>
      </div>
    );
  };

  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="lbl" style={{ margin: 0 }}>BTC Liquidation Clusters</div>
        <span style={{ fontSize: 10, color: 'var(--txt3)' }}>BTC only · Coinglass</span>
      </div>

      {/* Short liq clusters — above price */}
      {above.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#34d399', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4 }}>
            Short liquidations above — bulls target here
          </div>
          {above.map((l, i) => <Row key={i} l={l} side="above" />)}
        </>
      )}

      {/* Current price line */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        margin: '8px 0', padding: '5px 0',
        borderTop: '0.5px solid var(--bdr)', borderBottom: '0.5px solid var(--bdr)',
      }}>
        <span style={{ fontSize: 11, color: 'var(--txt3)', letterSpacing: '.05em', textTransform: 'uppercase' }}>Current</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--txt)', letterSpacing: '-0.3px' }}>
          {fmtK(currentPrice)}
        </span>
      </div>

      {/* Long liq clusters — below price */}
      {below.length > 0 && (
        <>
          {below.map((l, i) => <Row key={i} l={l} side="below" />)}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#f87171', letterSpacing: '.06em', textTransform: 'uppercase', marginTop: 4 }}>
            Long liquidations below — bears target here
          </div>
        </>
      )}

      {/* Plain English insight */}
      {insight && (
        <div style={{
          marginTop: 10, padding: '8px 10px', borderRadius: 8,
          background: 'var(--bg2)', border: '0.5px solid var(--bdr)',
          fontSize: 11, color: 'var(--txt2)', lineHeight: 1.55,
        }}>
          {insight}
        </div>
      )}
    </div>
  );
}
