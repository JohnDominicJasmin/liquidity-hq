'use client';
import { Fragment, useState, useEffect } from 'react';
import MacroStrip from '@/components/MacroStrip';
import LoadingState from '@/components/LoadingState';
import Tip from '@/components/Tip';
import { COINS, BINANCE_SYMS, BYBIT_SYMS, COIN_LABELS, type CoinId } from '@/lib/marketStore';
import { withAlpha } from '@/lib/color';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';

/* ── constants ── */

const RANGES = [
  { key: '24h', label: '24h', interval: '1h',  limit: 25  },
  { key: '7d',  label: '7d',  interval: '1h',  limit: 169 },
  { key: '30d', label: '30d', interval: '4h',  limit: 181 },
] as const;
type RangeKey = typeof RANGES[number]['key'];
const RANGE_LABEL_KEYS: Record<RangeKey, LabelKey> = {
  '24h': 'CORRELATION_RANGE_24H',
  '7d':  'CORRELATION_RANGE_7D',
  '30d': 'CORRELATION_RANGE_30D',
};

/* ── data fetching ── */
async function fetchCloses(id: CoinId, interval: string, limit: number): Promise<number[]> {
  const binSym = (BINANCE_SYMS as Record<string, string>)[id];
  const bbSym  = (BYBIT_SYMS  as Record<string, string>)[id];

  if (binSym) {
    try {
      const res  = await fetch(
        `/api/market/klines?source=binance&symbol=${binSym}&interval=${interval}&limit=${limit}`,
      );
      const data = await res.json() as Array<unknown[]>;
      return data.map(c => parseFloat(c[4] as string));
    } catch { /* fall through */ }
  }

  if (bbSym) {
    try {
      const bbInt = interval === '1h' ? '60' : '240';
      const res   = await fetch(
        `/api/market/klines?source=bybit&symbol=${bbSym}&interval=${bbInt}&limit=${limit}`,
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
  if (diag)    return 'rgba(var(--accent-rgb), 0.22)';
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
  if (diag) return 'var(--accent)';
  if (r == null) return 'var(--txt3)';
  return Math.abs(r) >= 0.8 ? 'var(--txt)' : 'var(--txt3)';
}

/* ── alt season signal ── */
interface AltSig { labelKey: LabelKey; descKey: LabelKey | null; avg: number | null; color: string; bg: string; }
function altSignal(avg: number | null): AltSig {
  if (avg == null) return { labelKey: 'CORRELATION_ALT_SIG_LOADING_LABEL', descKey: null, avg, color: 'var(--txt-dim)', bg: 'transparent' };
  if (avg < 0.30)  return {
    labelKey: 'CORRELATION_ALT_SIG_ALT_SEASON_LABEL',
    color: 'var(--green-2)', bg: 'rgba(52,211,153,0.08)',
    descKey: 'CORRELATION_ALT_SIG_ALT_SEASON_DESC', avg,
  };
  if (avg < 0.55)  return {
    labelKey: 'CORRELATION_ALT_SIG_MIXED_LABEL',
    color: 'var(--amber)', bg: 'rgba(251,191,36,0.07)',
    descKey: 'CORRELATION_ALT_SIG_MIXED_DESC', avg,
  };
  if (avg < 0.75)  return {
    labelKey: 'CORRELATION_ALT_SIG_BTC_LEADING_LABEL',
    color: '#d4b483', bg: 'rgba(212,180,131,0.06)',
    descKey: 'CORRELATION_ALT_SIG_BTC_LEADING_DESC', avg,
  };
  return {
    labelKey: 'CORRELATION_ALT_SIG_LOCKSTEP_LABEL',
    color: 'var(--red)', bg: 'rgba(248,113,113,0.07)',
    descKey: 'CORRELATION_ALT_SIG_LOCKSTEP_DESC', avg,
  };
}

/* ── component ── */
export default function CorrelationHeatmap() {
  const { t }                   = useLabels();
  const [rets, setRets]         = useState<Partial<Record<CoinId, number[]>>>({});
  const [rangeKey, setRangeKey] = useState<RangeKey>('7d');
  const [loading, setLoading]   = useState(true);
  const [hovered, setHovered]   = useState<[number, number] | null>(null);

  const range = RANGES.find(r => r.key === rangeKey)!;
  // The two values the fetch below actually depends on, pulled out so the
  // effect can name them instead of depending on `rangeKey` and relying on the
  // reader to know that RANGES maps one to the other.
  const { interval, limit } = range;

  /* fetch on range change */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRets({});
    (async () => {
      const result: Partial<Record<CoinId, number[]>> = {};
      await Promise.all(COINS.map(async id => {
        const closes = await fetchCloses(id, interval, limit);
        if (closes.length >= 5) result[id] = pctReturns(closes);
      }));
      if (!cancelled) { setRets(result); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [interval, limit]);

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

      {/* Macro correlations strip */}
      <MacroStrip />

      {/* Header */}
      <div className="mb-header">
        <h1 className="mb-title">{t('CORRELATION_PAGE_TITLE')}</h1>
        <div className="mb-subtitle">{t('CORRELATION_PAGE_SUBTITLE', { range: t(RANGE_LABEL_KEYS[range.key]) })}</div>
      </div>

      {/* Range */}
      <div className="frh-range-row">
        {RANGES.map(r => (
          <button
            key={r.key}
            className={`frh-range-btn${rangeKey === r.key ? ' on' : ''}`}
            onClick={() => setRangeKey(r.key)}
          >
            {t(RANGE_LABEL_KEYS[r.key])}
          </button>
        ))}
      </div>

      {loading && <LoadingState message={t('CORRELATION_LOADING_MESSAGE')} />}

      {!loading && (
        <>

          {/* Alt season signal */}
          <div className="card" style={{ marginBottom: 10, border: `0.5px solid ${withAlpha(sig.color, '55')}`, background: sig.bg }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div>
                <div style={{ fontSize: 'var(--fs-label)', fontWeight: 700, color: sig.color, marginBottom: 4 }}>
                  {t(sig.labelKey)}
                  {avgCorr != null && (
                    <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 400, color: 'var(--txt3)', marginLeft: 8 }}>
                      {t('CORRELATION_AVG_BTC_ALT_LABEL', { avg: avgCorr.toFixed(2) })}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.6 }}>{sig.descKey ? t(sig.descKey, { avg: sig.avg != null ? sig.avg.toFixed(2) : '' }) : ''}</div>
              </div>
            </div>
          </div>

          {/* Heatmap grid */}
          <div className="card" style={{ marginBottom: 10 }}>
            <div className="lbl" style={{ marginBottom: 10 }}>
              <Tip width={260} text={t('CORRELATION_MATRIX_TIP')}>{t('CORRELATION_MATRIX_LABEL')}</Tip>
              <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 400, color: 'var(--txt3)', marginLeft: 8 }}>
                {t('CORRELATION_MATRIX_SCALE_HINT')}
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
                          title={diag ? COIN_LABELS[a] : `${COIN_LABELS[a]} / ${COIN_LABELS[b]}: ${r?.toFixed(2) ?? '-'}`}
                          onMouseEnter={() => setHovered([i, j])}
                        >
                          {diag ? '-' : r !== null ? r.toFixed(2) : '-'}
                        </div>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
            </div>
            <div className="corr-scroll-hint">{t('CORRELATION_SCROLL_HINT')}</div>
            <div className="corr-legend">
              <span style={{ color: 'var(--green-2)' }}>{t('CORRELATION_LEGEND_GREEN_LABEL')}</span> = {t('CORRELATION_LEGEND_GREEN_DESC')} &nbsp;·&nbsp;
              <span style={{ color: 'var(--red)' }}>{t('CORRELATION_LEGEND_RED_LABEL')}</span> = {t('CORRELATION_LEGEND_RED_DESC')} &nbsp;·&nbsp;
              {t('CORRELATION_LEGEND_BRIGHTNESS_HINT')}
            </div>
          </div>

          {/* Strongest pairs */}
          <div className="card" style={{ marginBottom: 10 }}>
            <div className="lbl">{t('CORRELATION_STRONGEST_PAIRS_TITLE')}</div>
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
                <span className="corr-pair-val" style={{ color: r >= 0 ? 'var(--green-2)' : 'var(--red)' }}>
                  {r >= 0 ? '+' : ''}{r.toFixed(2)}
                </span>
              </div>
            ))}
          </div>

          {/* Weakest pairs */}
          <div className="card" style={{ marginBottom: 10 }}>
            <div className="lbl">
              {t('CORRELATION_WEAKEST_PAIRS_TITLE')}
              <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 400, color: 'var(--txt3)', marginLeft: 6 }}>
                {t('CORRELATION_WEAKEST_PAIRS_HINT')}
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
                <span className="corr-pair-val" style={{ color: r >= 0 ? 'var(--green-2)' : 'var(--red)' }}>
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
