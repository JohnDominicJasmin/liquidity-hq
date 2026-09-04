'use client';
import { Fragment, useState, useEffect } from 'react';
import MacroStrip from '@/components/MacroStrip';
import LoadingState from '@/components/LoadingState';
import Tip from '@/components/Tip';
import { COINS, BINANCE_SYMS, BYBIT_SYMS, COIN_LABELS, type CoinId } from '@/lib/marketStore';
import { withAlpha } from '@/lib/color';
import { tintPct } from '@/lib/correlationRamp';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';
import { useDesignMode } from '@/components/DesignModeProvider';
import CorrelationTerminal from '@/components/CorrelationTerminal';

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
   0.6 reads faint and 0.95+ pops.
 *
 * THE CURVE IS NOW SHARED WITH TERMINAL (#774). This function used to carry its
 * own copy - same rescale, same exponents, same floors, and caps of 92% and 96%
 * against lib/correlationRamp.ts's 56% and 50%. Only the caps differed, and
 * they are the whole defect: 1332 cells below 4.5:1 on production, worst 1.79,
 * and the failures were concentrated in the STRONGLY correlated cells, which
 * are the ones the screen exists to draw attention to.
 *
 * correlationRamp.ts exists because #570's caps were argued in prose and the
 * prose was wrong. Importing it rather than re-deriving a second set means the
 * tested constants govern both designs. */
function cellBg(r: number | null, diag: boolean): string {
  if (diag)    return 'var(--accent-bdr)';
  if (r == null) return 'rgba(255,255,255,0.03)';
  const a = tintPct(r) / 100;
  return r > 0
    ? `rgba(52,211,153,${a.toFixed(2)})`
    : `rgba(248,113,113,${a.toFixed(2)})`;
}

/* ALWAYS --txt ON A TINTED CELL (#774), never --txt3.
 *
 * The cap was only half of it, and this was the larger half. --txt3 on the
 * current design's green fails from 9% alpha in dark and red from 12% - so
 * every cell below |r| = 0.8 was failing almost as soon as it carried any tint
 * at all, which is most of the grid. Lowering the cap alone leaves --txt3 at
 * 1.57 at full strength; it is not a fix, it is a smaller failure.
 *
 * Terminal already reached this conclusion: CorrelationTerminal.tsx:77 says
 * "Text is always --txt now", from #570. The current design kept the shape
 * that issue removed - which is why terminal measures 0 failures on this route
 * and the design shipping today measures 1332.
 *
 * Measured with both changes, worst over the whole ramp on .card's --bg2:
 * dark 5.01, light 9.95.
 *
 * The null cell keeps --txt3 deliberately: it paints rgba(255,255,255,0.03),
 * essentially the bare card, and measures 4.84 dark / 7.67 light. It is not
 * part of this defect and #679's --txt-dash is a terminal-only concern. */
function cellColor(r: number | null, diag: boolean): string {
  /* THE DIAGONAL TOO, and it was found by rendering rather than by arithmetic
     (#774). After the two changes above, a 2500-cell sweep of the live grid
     put the worst cell at 3.88 in dark and 4.34 in light - and it was not a
     data cell at all. It was the diagonal: var(--accent) printed on
     var(--accent-bdr), which is #1a7aff at 22%. A signal colour on a wash of
     itself, the same shape as #738, and there is no --accent-fg token to
     reach for.

     50 cells, one per coin, and they were the ONLY cells still failing after
     the ramp fix - so claiming this route was fixed while leaving them would
     have been the "found a second defect after saying done" failure. --txt
     measures 12.87 on that ground in dark. The cell shows "-", so it loses
     nothing by not being blue; the accent-tinted background still marks the
     diagonal. */
  if (diag) return 'var(--txt)';
  if (r == null) return 'var(--txt3)';
  return 'var(--txt)';
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
    color: 'var(--fr-slight-long)', bg: 'rgba(212,180,131,0.06)',
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
  const mode = useDesignMode();
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

  if (mode === 'terminal') return <CorrelationTerminal />;

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
                            outline: isExact ? '1.5px solid var(--accent)' : undefined,
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
