'use client';
import { useMarket, COINS, CoinId, computeSqueezeScore } from '@/lib/marketStore';

type TFDir = 'FLUSH' | 'SQUEEZE' | 'NEUTRAL';

interface TFSignal {
  dir: TFDir;
  strength: number;
  rsi: number | null;
}

function computeTFSignal(
  rsi: number | null,
  fr: number | null,
  longRatio: number | null,
  shortRatio: number | null,
): TFSignal {
  if (rsi == null) return { dir: 'NEUTRAL', strength: 0, rsi: null };

  let flushScore = 0;
  let sqzScore   = 0;

  // RSI is the primary per-timeframe signal
  if      (rsi >= 75) flushScore += 55;
  else if (rsi >= 70) flushScore += 40;
  else if (rsi >= 65) flushScore += 22;
  else if (rsi >= 60) flushScore += 10;
  else if (rsi <= 25) sqzScore   += 55;
  else if (rsi <= 30) sqzScore   += 40;
  else if (rsi <= 35) sqzScore   += 22;
  else if (rsi <= 40) sqzScore   += 10;

  // FR confirms direction (not TF-specific but adds conviction)
  if (fr != null) {
    const pct = fr * 100;
    if      (pct >= 0.05)  flushScore += 25;
    else if (pct >= 0.02)  flushScore += 15;
    else if (pct >= 0.01)  flushScore += 7;
    else if (pct <= -0.03) sqzScore   += 25;
    else if (pct <= -0.015) sqzScore  += 15;
    else if (pct <= -0.005) sqzScore  += 7;
  }

  // L/S ratio confirms direction
  if (longRatio != null && shortRatio != null) {
    if      (longRatio  >= 0.65) flushScore += 20;
    else if (longRatio  >= 0.58) flushScore += 10;
    else if (shortRatio >= 0.65) sqzScore   += 20;
    else if (shortRatio >= 0.58) sqzScore   += 10;
  }

  const dominant = Math.max(flushScore, sqzScore);
  const dir: TFDir =
    flushScore > sqzScore && dominant >= 20 ? 'FLUSH' :
    sqzScore > flushScore && dominant >= 20 ? 'SQUEEZE' :
    'NEUTRAL';

  return { dir, strength: Math.min(100, dominant), rsi };
}

function cellColors(sig: TFSignal): { bg: string; text: string; border: string } {
  if (sig.dir === 'NEUTRAL') return { bg: 'transparent', text: '#444', border: 'transparent' };
  const isFlush = sig.dir === 'FLUSH';
  const base    = isFlush ? '#f87171' : '#34d399';
  const alpha   = sig.strength >= 70 ? '28' : sig.strength >= 40 ? '16' : '0c';
  return {
    bg:     base + alpha,
    text:   base,
    border: base + '33',
  };
}

const TF_LABELS = ['15 min', '1 Hour', '4 Hour', '1 Day'] as const;

export default function MultiTFSqueezeView() {
  const { store } = useMarket();

  const rows = COINS.map(c => {
    const coin = store.coins[c];
    const fr   = coin?.fundingRate ?? null;
    const lr   = coin?.longRatio   ?? null;
    const sr   = coin?.shortRatio  ?? null;

    const tfs: TFSignal[] = [
      computeTFSignal(coin?.rsi14    ?? null, fr, lr, sr),
      computeTFSignal(coin?.rsi1h    ?? null, fr, lr, sr),
      computeTFSignal(coin?.rsi4h    ?? null, fr, lr, sr),
      computeTFSignal(coin?.rsiDaily ?? null, fr, lr, sr),
    ];

    const sq     = computeSqueezeScore(coin);
    const aligns = tfs.filter(t => t.dir !== 'NEUTRAL');
    const flushCount = tfs.filter(t => t.dir === 'FLUSH').length;
    const sqzCount   = tfs.filter(t => t.dir === 'SQUEEZE').length;
    const confluence = Math.max(flushCount, sqzCount); // 0-4 aligned TFs

    return { c, coin, tfs, sq, confluence, flushCount, sqzCount, aligns };
  }).sort((a, b) => {
    // Sort by highest confluence first, then by squeeze score
    if (b.confluence !== a.confluence) return b.confluence - a.confluence;
    return b.sq.score - a.sq.score;
  });

  const totalSqz   = rows.filter(r => r.sqzCount >= 2).length;
  const totalFlush = rows.filter(r => r.flushCount >= 2).length;

  return (
    <div style={{
      background: 'var(--bg1)', border: '0.5px solid var(--bdr)',
      borderRadius: 14, overflow: 'hidden', marginBottom: 12,
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px 10px',
        borderBottom: '0.5px solid var(--bdr)',
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.07em', textTransform: 'uppercase', flex: 1 }}>
          Multi-Timeframe Squeeze View
        </span>
        {totalSqz > 0 && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
            color: '#34d399', background: 'rgba(52,211,153,0.1)', border: '0.5px solid rgba(52,211,153,0.25)',
          }}>↑ {totalSqz} squeeze</span>
        )}
        {totalFlush > 0 && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
            color: '#f87171', background: 'rgba(248,113,113,0.1)', border: '0.5px solid rgba(248,113,113,0.25)',
          }}>↓ {totalFlush} flush</span>
        )}
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '68px repeat(4, 1fr) 52px',
        padding: '5px 12px',
        borderBottom: '0.5px solid rgba(255,255,255,0.05)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <span style={hdrStyle}>Coin</span>
        {TF_LABELS.map(tf => (
          <span key={tf} style={{ ...hdrStyle, textAlign: 'center' }}>{tf}</span>
        ))}
        <span style={{ ...hdrStyle, textAlign: 'right' }}>Score</span>
      </div>

      {/* Coin rows */}
      {rows.map(({ c, tfs, sq, flushCount, sqzCount }) => {
        const dominantDir = sqzCount >= 2 ? 'SQUEEZE' : flushCount >= 2 ? 'FLUSH' : 'NEUTRAL';
        const rowActive   = dominantDir !== 'NEUTRAL';
        return (
          <div
            key={c}
            style={{
              display: 'grid',
              gridTemplateColumns: '68px repeat(4, 1fr) 52px',
              alignItems: 'center',
              padding: '5px 12px',
              borderBottom: '0.5px solid rgba(255,255,255,0.04)',
              background: rowActive
                ? (dominantDir === 'SQUEEZE' ? 'rgba(52,211,153,0.03)' : 'rgba(248,113,113,0.03)')
                : 'transparent',
            }}
          >
            {/* Coin name */}
            <span style={{
              fontSize: 11, fontWeight: 700,
              color: rowActive
                ? (dominantDir === 'SQUEEZE' ? '#34d399' : '#f87171')
                : '#555',
              letterSpacing: '.03em',
            }}>
              {c.toUpperCase()}
            </span>

            {/* TF cells */}
            {tfs.map((sig, i) => {
              const cols = cellColors(sig);
              const icon = sig.dir === 'FLUSH' ? '↓' : sig.dir === 'SQUEEZE' ? '↑' : '—';
              return (
                <div key={i} style={{ display: 'flex', justifyContent: 'center' }}>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 2,
                    padding: '2px 6px', borderRadius: 5,
                    background: cols.bg,
                    border: sig.dir !== 'NEUTRAL' ? `0.5px solid ${cols.border}` : 'none',
                    minWidth: 36, justifyContent: 'center',
                  }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: cols.text, letterSpacing: '.01em' }}>
                      {icon}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 600, color: sig.rsi != null ? cols.text : '#333',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {sig.rsi != null ? Math.round(sig.rsi) : '—'}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Global squeeze score */}
            <span style={{
              fontSize: 11, fontWeight: 700, textAlign: 'right',
              color: sq.dir !== 'NEUTRAL' ? sq.color : '#333',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {sq.score > 0 ? sq.score : '—'}
            </span>
          </div>
        );
      })}

      {/* Footer legend */}
      <div style={{ padding: '6px 14px', borderTop: '0.5px solid rgba(255,255,255,0.05)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9, color: '#34d399' }}>↑ Squeeze = shorts overcrowded, bounce likely</span>
        <span style={{ fontSize: 9, color: '#f87171' }}>↓ Flush = longs overcrowded, drop likely</span>
        <span style={{ fontSize: 9, color: '#444' }}>RSI + Funding Rate + L/S ratio</span>
      </div>
    </div>
  );
}

const hdrStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 600, letterSpacing: '.07em',
  textTransform: 'uppercase', color: '#333',
};
