'use client';
import { Fragment, useState, useEffect } from 'react';
import { COINS, BINANCE_SYMS, BYBIT_SYMS, COIN_LABELS, type CoinId } from '@/lib/marketStore';

/* ── constants ── */

const RANGES = [
  { key: '24h', label: '24h', interval: '1h',  limit: 25  },
  { key: '7d',  label: '7d',  interval: '1h',  limit: 169 },
  { key: '30d', label: '30d', interval: '4h',  limit: 181 },
] as const;
type RangeKey = typeof RANGES[number]['key'];

/* ── data fetching ── */
async function fetchCloses(id: CoinId, interval: string, limit: number): Promise<number[]> {
  const binSym = (BINANCE_SYMS as Record<string, string>)[id];
  const bbSym  = (BYBIT_SYMS  as Record<string, string>)[id];

  if (binSym) {
    try {
      const res  = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${binSym}&interval=${interval}&limit=${limit}`,
      );
      const data = await res.json() as Array<unknown[]>;
      return data.map(c => parseFloat(c[4] as string));
    } catch { /* fall through */ }
  }

  if (bbSym) {
    try {
      const bbInt = interval === '1h' ? '60' : '240';
      const res   = await fetch(
        `https://api.bybit.com/v5/market/kline?category=linear&symbol=${bbSym}&interval=${bbInt}&limit=${limit}`,
      );
      const data  = await res.json();
      return ((data?.result?.list ?? []) as string[][])
        .map(c => parseFloat(c[4]))
        .reverse();
    } catch { /* fall through */ }
  }

  return [];
}

/* ── maths ── */
function pctReturns(closes: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    r.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  return r;
}

function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 5) return null;
  const xs = a.slice(0, n), ys = b.slice(0, n);
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom < 1e-10) return null;
  return Math.max(-1, Math.min(1, num / denom));
}

/* ── colors ── */
/* Crypto correlations cluster in 0.5–1.0, so a linear alpha map renders a wall of
   identical green. Rescale 0.35→1.0 onto the full range with a power curve so
   0.6 reads faint and 0.95+ pops. */
function cellBg(r: number | null, diag: boolean): string {
  if (diag)    return 'rgba(167,139,250,0.22)';
  if (r == null) return 'rgba(255,255,255,0.03)';
  if (r > 0) {
    const t = Math.max(0, (r - 0.35) / 0.65);
    const a = 0.04 + Math.pow(t, 2.2) * 0.92;
    return `rgba(52,211,153,${a.toFixed(2)})`;
  }
  const a = 0.06 + Math.pow(Math.abs(r), 1.5) * 0.86;
  return `rgba(248,113,113,${a.toFixed(2)})`;
}

function cellColor(r: number | null, diag: boolean): string {
  if (diag) return '#c4b5fd';
  if (r == null) return '#333';
  return Math.abs(r) >= 0.8 ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)';
}

/* ── alt season signal ── */
interface AltSig { emoji: string; label: string; desc: string; color: string; bg: string; }
function altSignal(avg: number | null): AltSig {
  if (avg == null) return { emoji: '⏳', label: 'Loading…', desc: '', color: '#a0a0a0', bg: 'transparent' };
  if (avg < 0.30)  return {
    emoji: '🚀', label: 'Alt Season Conditions',
    color: '#34d399', bg: 'rgba(52,211,153,0.08)',
    desc: `BTC-alt avg correlation is ${avg.toFixed(2)} — very low. Altcoins are moving independently from BTC. This is when alts can outperform BTC significantly. Rotate into high-conviction alt setups.`,
  };
  if (avg < 0.55)  return {
    emoji: '⚡', label: 'Mixed Market',
    color: '#fbbf24', bg: 'rgba(251,191,36,0.07)',
    desc: `Moderate BTC-alt correlation (${avg.toFixed(2)}). Some alts following BTC, others moving on their own catalyst. Selective alt plays possible but watch BTC direction first.`,
  };
  if (avg < 0.75)  return {
    emoji: '📊', label: 'BTC Leading',
    color: '#d4b483', bg: 'rgba(212,180,131,0.06)',
    desc: `High BTC-alt correlation (${avg.toFixed(2)}). BTC is dragging most alts. Get BTC direction right before trading alts — individual setups matter less when correlation is this high.`,
  };
  return {
    emoji: '🔗', label: 'BTC Dominance — Alts Lockstep',
    color: '#f87171', bg: 'rgba(248,113,113,0.07)',
    desc: `Very high BTC-alt correlation (${avg.toFixed(2)}). Everything pumps and dumps with BTC. No independent alt edge right now — trade BTC or wait for correlation to break.`,
  };
}

/* ── component ── */
export default function CorrelationHeatmap() {
  const [rets, setRets]         = useState<Partial<Record<CoinId, number[]>>>({});
  const [rangeKey, setRangeKey] = useState<RangeKey>('7d');
  const [loading, setLoading]   = useState(true);
  const [hovered, setHovered]   = useState<[number, number] | null>(null);

  const range = RANGES.find(r => r.key === rangeKey)!;

  /* fetch on range change */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRets({});
    (async () => {
      const result: Partial<Record<CoinId, number[]>> = {};
      await Promise.all(COINS.map(async id => {
        const closes = await fetchCloses(id, range.interval, range.limit);
        if (closes.length >= 5) result[id] = pctReturns(closes);
      }));
      if (!cancelled) { setRets(result); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [rangeKey]);

  /* 8×8 correlation matrix */
  const matrix: (number | null)[][] = COINS.map((a, i) =>
    COINS.map((b, j) => {
      if (i === j) return 1;
      const ra = rets[a], rb = rets[b];
      if (!ra || !rb) return null;
      return pearson(ra, rb);
    }),
  );

  /* alt season signal */
  const btcAlts = matrix[0].slice(1).filter((v): v is number => v !== null);
  const avgCorr = btcAlts.length ? btcAlts.reduce((a, b) => a + b, 0) / btcAlts.length : null;
  const sig     = altSignal(avgCorr);

  /* ranked pairs (upper triangle only) */
  const pairs: { a: CoinId; b: CoinId; r: number }[] = [];
  COINS.forEach((a, i) => COINS.forEach((b, j) => {
    if (j <= i) return;
    const r = matrix[i][j];
    if (r !== null) pairs.push({ a, b, r });
  }));
  const strongest = [...pairs].sort((a, b) => b.r - a.r).slice(0, 5);
  const weakest   = [...pairs].sort((a, b) => a.r - b.r).slice(0, 3);

  return (
    <div>

      {/* Header */}
      <div className="mb-header">
        <div className="mb-title">Correlation Heatmap</div>
        <div className="mb-subtitle">How coins move together · based on {range.label} price returns</div>
      </div>

      {/* Range */}
      <div className="frh-range-row">
        {RANGES.map(r => (
          <button
            key={r.key}
            className={`frh-range-btn${rangeKey === r.key ? ' on' : ''}`}
            onClick={() => setRangeKey(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="card" style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--txt3)', fontSize: 13 }}>
          Calculating correlations…
        </div>
      )}

      {!loading && (
        <>

          {/* Alt season signal */}
          <div className="card" style={{ marginBottom: 10, border: `0.5px solid ${sig.color}55`, background: sig.bg }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>{sig.emoji}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: sig.color, marginBottom: 4 }}>
                  {sig.label}
                  {avgCorr != null && (
                    <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--txt3)', marginLeft: 8 }}>
                      avg BTC-alt: {avgCorr.toFixed(2)}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--txt2)', lineHeight: 1.6 }}>{sig.desc}</div>
              </div>
            </div>
          </div>

          {/* Heatmap grid */}
          <div className="card" style={{ marginBottom: 10 }}>
            <div className="lbl" style={{ marginBottom: 10 }}>
              Price Return Correlation
              <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--txt3)', marginLeft: 8 }}>
                +1.00 = perfect sync · 0.00 = no relation · −1.00 = opposite
              </span>
            </div>
            <div className="corr-grid-outer">
            <div className="corr-grid-wrap">
              <div
                className="corr-grid"
                style={{
                  gridTemplateColumns: `40px repeat(${COINS.length}, 1fr)`,
                  minWidth: 40 + COINS.length * 34,
                }}
                onMouseLeave={() => setHovered(null)}
              >
                {/* Top-left empty corner */}
                <div />
                {/* Column headers */}
                {COINS.map((id, j) => (
                  <div
                    key={id}
                    className="corr-col-hdr"
                    style={{
                      color: hovered
                        ? hovered[1] === j ? 'var(--txt)' : 'var(--txt3)'
                        : undefined,
                      opacity: hovered && hovered[1] !== j ? 0.4 : 1,
                      transition: 'opacity 0.1s, color 0.1s',
                    }}
                  >
                    {COIN_LABELS[id]}
                  </div>
                ))}
                {/* Rows */}
                {COINS.map((a, i) => (
                  <Fragment key={a}>
                    <div
                      className="corr-row-hdr"
                      style={{
                        color: hovered
                          ? hovered[0] === i ? 'var(--txt)' : 'var(--txt3)'
                          : undefined,
                        opacity: hovered && hovered[0] !== i ? 0.4 : 1,
                        transition: 'opacity 0.1s, color 0.1s',
                      }}
                    >
                      {COIN_LABELS[a]}
                    </div>
                    {COINS.map((b, j) => {
                      const r      = matrix[i][j];
                      const diag   = i === j;
                      const inCross = hovered && (hovered[0] === i || hovered[1] === j);
                      const isExact = hovered && hovered[0] === i && hovered[1] === j;
                      return (
                        <div
                          key={b}
                          className="corr-cell"
                          style={{
                            background: cellBg(r, diag),
                            color: cellColor(r, diag),
                            opacity: hovered && !inCross ? 0.25 : 1,
                            outline: isExact ? '1.5px solid rgba(255,255,255,0.55)' : undefined,
                            outlineOffset: isExact ? '-1px' : undefined,
                            transition: 'opacity 0.1s',
                            cursor: diag ? 'default' : 'crosshair',
                          }}
                          title={diag ? COIN_LABELS[a] : `${COIN_LABELS[a]} / ${COIN_LABELS[b]}: ${r?.toFixed(2) ?? '—'}`}
                          onMouseEnter={() => setHovered([i, j])}
                        >
                          {diag ? '—' : r !== null ? r.toFixed(2) : '—'}
                        </div>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
            </div>
            <div className="corr-scroll-hint">swipe to see all coins →</div>
            <div className="corr-legend">
              <span style={{ color: '#34d399' }}>■ Green</span> = moves together &nbsp;·&nbsp;
              <span style={{ color: '#f87171' }}>■ Red</span> = moves opposite &nbsp;·&nbsp;
              Brighter = stronger relationship
            </div>
          </div>

          {/* Strongest pairs */}
          <div className="card" style={{ marginBottom: 10 }}>
            <div className="lbl">Most Correlated Pairs</div>
            {strongest.map(({ a, b, r }) => (
              <div key={`${a}-${b}`} className="corr-pair-row">
                <span className="corr-pair-coins">{COIN_LABELS[a]} / {COIN_LABELS[b]}</span>
                <div className="corr-pair-bar-wrap">
                  <div
                    className="corr-pair-bar"
                    style={{
                      width: `${Math.abs(r) * 100}%`,
                      background: r >= 0 ? 'rgba(52,211,153,0.55)' : 'rgba(248,113,113,0.55)',
                    }}
                  />
                </div>
                <span className="corr-pair-val" style={{ color: r >= 0 ? '#34d399' : '#f87171' }}>
                  {r >= 0 ? '+' : ''}{r.toFixed(2)}
                </span>
              </div>
            ))}
          </div>

          {/* Weakest pairs */}
          <div className="card" style={{ marginBottom: 10 }}>
            <div className="lbl">
              Least Correlated Pairs
              <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--txt3)', marginLeft: 6 }}>
                — potential diversification
              </span>
            </div>
            {weakest.map(({ a, b, r }) => (
              <div key={`${a}-${b}`} className="corr-pair-row">
                <span className="corr-pair-coins">{COIN_LABELS[a]} / {COIN_LABELS[b]}</span>
                <div className="corr-pair-bar-wrap">
                  <div
                    className="corr-pair-bar"
                    style={{
                      width: `${Math.abs(r) * 100}%`,
                      background: r >= 0 ? 'rgba(52,211,153,0.55)' : 'rgba(248,113,113,0.55)',
                    }}
                  />
                </div>
                <span className="corr-pair-val" style={{ color: r >= 0 ? '#34d399' : '#f87171' }}>
                  {r >= 0 ? '+' : ''}{r.toFixed(2)}
                </span>
              </div>
            ))}
          </div>

        </>
      )}

    </div>
  );
}
